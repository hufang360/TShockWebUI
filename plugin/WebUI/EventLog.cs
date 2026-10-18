using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Rests;
using Terraria;
using TShockAPI;

namespace WebUI
{
    /// <summary>
    /// 服务器动态（进服 / 退服 / Boss 击杀 / 聊天）的事件存储。
    ///
    /// - **内存**：保留最近 <see cref="Capacity"/> 条，供 <see cref="Since"/>（增量轮询）
    ///   与 <see cref="Tail"/>（取最新 N 条）使用；
    /// - **落盘**：默认按天追加到 <c>tshock/WebUI/events/events-YYYY-MM-DD.jsonl</c>，
    ///   重启后从磁盘恢复尾部，事件因此**不会因 TShock 重启而清空**；
    /// - 写盘在**后台线程**完成（游戏主线程只入队），不阻塞 TPS；
    /// - 保留策略：<c>HistoryDays</c> 天 / <c>HistoryMaxMB</c> 上限，启动与每日自动裁剪。
    ///
    /// 旧行为（纯内存环形缓冲）在 <c>PersistEvents=false</c> 时保留。
    /// </summary>
    internal static class EventLog
    {
        /// <summary>内存中保留的最近事件条数（也决定 tail 的上限）。</summary>
        public const int Capacity = 2000;

        /// <summary>单条事件文本的最大长度（聊天等长文本会被截断）。</summary>
        public const int MaxTextLength = 200;

        /// <summary>取最新事件时的默认条数。</summary>
        public const int DefaultTail = 100;

        private static readonly object Lock = new object();
        private static readonly LinkedList<Dictionary<string, object>> Buffer =
            new LinkedList<Dictionary<string, object>>();
        private static long _seq;

        // ---------- 持久化 ----------
        private static WebAuthConfig _cfg;
        private static string _dir;
        private static BlockingCollection<string> _queue;
        private static Thread _writer;
        private static volatile bool _running;
        private static string _currentDay;   // 当前写入的日期（yyyy-MM-dd，UTC）
        private static StreamWriter _current;

        /// <summary>由插件在 Initialize 时调用：建目录、恢复尾部、裁剪、启动写线程。</summary>
        public static void Init(WebAuthConfig cfg)
        {
            _cfg = cfg;
            _dir = System.IO.Path.Combine(TShock.SavePath, "WebUI", "events");
            try
            {
                Directory.CreateDirectory(_dir);
                LoadTail();
                Prune();
            }
            catch (Exception ex)
            {
                TShock.Log.ConsoleError("[WebUI] 事件历史初始化失败（将继续以内存模式运行）：" + ex);
                return;
            }

            if (_cfg != null && !_cfg.PersistEvents) return;

            _queue = new BlockingCollection<string>(new ConcurrentQueue<string>(), 20000);
            _running = true;
            _writer = new Thread(WriterLoop) { IsBackground = true, Name = "WebUI-EventLog" };
            _writer.Start();
        }

        /// <summary>由插件在 Dispose 时调用：停止线程并 flush。</summary>
        public static void Shutdown()
        {
            _running = false;
            try { _queue?.CompleteAdding(); } catch { /* ignore */ }
            try { _writer?.Join(2000); } catch { /* ignore */ }
            TryFlush();
            try { _current?.Dispose(); } catch { /* ignore */ }
            _current = null;
        }

        public static void Add(string type, string text)
        {
            Add(type, text, null);
        }

        /// <summary>
        /// 追加一条事件。可选的 <paramref name="source"/> 用于「同类型但来源不同」的事件
        /// （如聊天：<c>type=chat</c> + <c>source=game|webui</c>），前端据此区分渲染。
        /// </summary>
        public static void Add(string type, string text, string source)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            if (text.Length > MaxTextLength) text = text.Substring(0, MaxTextLength) + "…";

            Dictionary<string, object> item;
            lock (Lock)
            {
                item = new Dictionary<string, object>
                {
                    { "seq", ++_seq },
                    { "type", type },
                    { "text", text },
                    { "time", DateTime.UtcNow.ToString("o") },
                };
                if (!string.IsNullOrWhiteSpace(source)) item["source"] = source;
                Buffer.AddLast(item);
                while (Buffer.Count > Capacity) Buffer.RemoveFirst();
            }
            Persist(item);
        }

        /// <summary>返回 seq 大于 since 的事件（最多 limit 条），以及当前最大 seq。</summary>
        public static RestObject Since(long since, int limit)
        {
            if (limit <= 0 || limit > Capacity) limit = Capacity;
            lock (Lock)
            {
                var events = Buffer.Where(e => (long)e["seq"] > since).Take(limit).ToList();
                return new RestObject("200")
                {
                    { "events", events },
                    { "lastSeq", _seq },
                };
            }
        }

        /// <summary>返回**最新** limit 条事件（升序），用于「打开网页时先看最近 N 条」。</summary>
        public static RestObject Tail(int limit)
        {
            if (limit <= 0) limit = DefaultTail;
            if (limit > Capacity) limit = Capacity;
            lock (Lock)
            {
                var events = Buffer.Skip(Math.Max(0, Buffer.Count - limit)).ToList();
                return new RestObject("200")
                {
                    { "events", events },
                    { "firstSeq", events.Count > 0 ? events[0]["seq"] : 0 },
                    { "lastSeq", _seq },
                };
            }
        }

        public static void Clear()
        {
            lock (Lock)
            {
                Buffer.Clear();
            }
        }

        /// <summary>Boss 击杀的可读名（用于事件文本）。</summary>
        public static string NpcName(int netId)
        {
            try
            {
                var name = Lang.GetNPCNameValue(netId);
                return string.IsNullOrWhiteSpace(name) ? $"NPC#{netId}" : name;
            }
            catch
            {
                return $"NPC#{netId}";
            }
        }

        // ---------- 持久化实现 ----------

        private static bool ShouldPersist(string type)
        {
            if (_cfg != null && !_cfg.PersistEvents) return false;
            if (type == "chat" && _cfg != null && !_cfg.PersistChat) return false;
            return true;
        }

        private static void Persist(Dictionary<string, object> item)
        {
            if (!_running) return;
            var type = item.TryGetValue("type", out var t) ? t as string : null;
            if (!ShouldPersist(type)) return;
            try
            {
                _queue?.TryAdd(JsonConvert.SerializeObject(item));
            }
            catch (Exception ex)
            {
                TShock.Log.ConsoleError("[WebUI] 事件入队失败：" + ex.Message);
            }
        }

        private static void WriterLoop()
        {
            while (_running || (_queue != null && !_queue.IsCompleted))
            {
                string line;
                if (_queue != null && _queue.TryTake(out line, 500))
                {
                    try
                    {
                        EnsureWriter();
                        _current.WriteLine(line);
                    }
                    catch (Exception ex)
                    {
                        TShock.Log.ConsoleError("[WebUI] 事件写盘失败：" + ex.Message);
                    }
                }
                else
                {
                    TryFlush();
                }
            }
            TryFlush();
        }

        private static void EnsureWriter()
        {
            var day = DateTime.UtcNow.ToString("yyyy-MM-dd");
            if (_current != null && _currentDay == day) return;
            try { _current?.Dispose(); } catch { /* ignore */ }
            _currentDay = day;
            var path = System.IO.Path.Combine(_dir, $"events-{day}.jsonl");
            var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read);
            _current = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = false };
        }

        private static void TryFlush()
        {
            if (_current == null) return;
            try { _current.Flush(); }
            catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 事件 flush 失败：" + ex.Message); }
        }

        private static void LoadTail()
        {
            if (!Directory.Exists(_dir)) return;
            var files = Directory.GetFiles(_dir, "events-*.jsonl");
            Array.Sort(files);           // 文件名按日期升序
            var loaded = new List<Dictionary<string, object>>();
            for (var i = files.Length - 1; i >= 0 && loaded.Count < Capacity; i--)
            {
                var lines = File.ReadAllLines(files[i]);
                for (var j = lines.Length - 1; j >= 0 && loaded.Count < Capacity; j--)
                {
                    var line = lines[j];
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        var item = JsonConvert.DeserializeObject<Dictionary<string, object>>(line);
                        if (item != null && item.ContainsKey("seq")) loaded.Add(item);
                    }
                    catch { /* 跳过坏行 */ }
                }
            }
            loaded.Reverse();            // 恢复为升序（最旧 → 最新）
            lock (Lock)
            {
                Buffer.Clear();
                foreach (var item in loaded)
                {
                    Buffer.AddLast(item);
                    if (item.TryGetValue("seq", out var s) && s is long seq && seq > _seq) _seq = seq;
                }
            }
        }

        private static void Prune()
        {
            if (!Directory.Exists(_dir)) return;
            var files = Directory.GetFiles(_dir, "events-*.jsonl");
            Array.Sort(files);           // 升序：最旧在前

            var days = _cfg?.HistoryDays ?? 7;
            if (days > 0)
            {
                var cutoff = DateTime.UtcNow.Date.AddDays(-days);
                foreach (var f in files)
                {
                    var name = System.IO.Path.GetFileNameWithoutExtension(f); // events-yyyy-MM-dd
                    if (name.Length < "events-".Length + 10) continue;
                    if (DateTime.TryParse(name.Substring("events-".Length), out var d) && d < cutoff)
                    {
                        TryDelete(f);
                    }
                }
            }

            var maxMB = _cfg?.HistoryMaxMB ?? 50;
            if (maxMB <= 0) return;
            var limitBytes = (long)maxMB * 1024 * 1024;
            var ordered = Directory.GetFiles(_dir, "events-*.jsonl");
            Array.Sort(ordered);
            long total = 0;
            foreach (var f in ordered)
            {
                try { total += new FileInfo(f).Length; } catch { /* ignore */ }
            }
            foreach (var f in ordered)
            {
                if (total <= limitBytes) break;
                long size = 0;
                try { size = new FileInfo(f).Length; } catch { /* ignore */ }
                if (TryDelete(f)) total -= size;
            }
        }

        private static bool TryDelete(string path)
        {
            try
            {
                File.Delete(path);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
