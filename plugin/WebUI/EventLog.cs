using System;
using System.Collections.Generic;
using System.Linq;
using Rests;
using Terraria;

namespace WebUI
{
    /// <summary>
    /// 服务器动态（进服 / 退服 / Boss 击杀）的内存环形缓冲，供 WebUI 轮询展示。
    /// 只为「让首页活起来」服务，不落盘、重启即清空，保留最近 <see cref="Capacity"/> 条。
    /// </summary>
    internal static class EventLog
    {
        public const int Capacity = 200;

        /// <summary>单条事件文本的最大长度（聊天等长文本会被截断）。</summary>
        public const int MaxTextLength = 200;

        private static readonly object Lock = new object();
        private static readonly LinkedList<Dictionary<string, object>> Buffer =
            new LinkedList<Dictionary<string, object>>();
        private static long _seq;

        public static void Add(string type, string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            if (text.Length > MaxTextLength) text = text.Substring(0, MaxTextLength) + "…";
            lock (Lock)
            {
                Buffer.AddLast(new Dictionary<string, object>
                {
                    { "seq", ++_seq },
                    { "type", type },
                    { "text", text },
                    { "time", DateTime.UtcNow.ToString("o") },
                });
                while (Buffer.Count > Capacity) Buffer.RemoveFirst();
            }
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
    }
}
