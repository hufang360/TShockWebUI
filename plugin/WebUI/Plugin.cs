using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using Rests;
using Terraria;
using TerrariaApi.Server;
using TShockAPI;
using TShockAPI.Hooks;

namespace WebUI
{
    /// <summary>
    /// TShockWebUI 的「在线授权」信使插件。
    ///
    /// 工作方式：
    ///   1. 网页端（经 Go 后端）调用 /webui/auth/request?name=&amp;secret= 发起登录请求；
    ///   2. 插件确认该玩家在线且已登录 TShock 账号，生成 6 位验证码并发游戏内消息；
    ///   3. 玩家发送 /webauth &lt;code&gt; 同意或 /webauth deny &lt;code&gt; 拒绝；
    ///   4. 后端轮询 /webui/auth/poll 取回状态；批准时插件为其铸造一个 TShock REST token。
    ///
    /// token 使用 TShock 自己的 <c>SecureRest.Tokens</c> 表（公开可写），权限与密码登录完全一致，
    /// 不提权；后端拿到后按普通会话处理。
    /// </summary>
    [ApiVersion(2, 1)]
    public class Plugin : TerrariaPlugin
    {
        public override string Name => "WebUI";
        public override string Author => "TShockWebUI";
        public override string Description => "为 TShockWebUI 提供「在线授权」登录：在线玩家在游戏内确认后发放 REST token。";
        public override Version Version => Assembly.GetExecutingAssembly().GetName().Version;

        internal static WebAuthConfig Config;
        internal static AuthStore Store;
        internal static SessionRegistry Sessions;

        private static Plugin _instance;
        private readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
        private int _sweepTicks;

        public Plugin(Main game) : base(game)
        {
        }

        public override void Initialize()
        {
            _instance = this;
            Config = WebAuthConfig.Load();
            Store = new AuthStore(Config);
            Sessions = new SessionRegistry();

            Commands.ChatCommands.Add(new Command(WebAuthCommand, "webui", "web")
            {
                AllowServer = false,
                HelpText = "网页端：/web auth <验证码> 同意登录；/web deny <验证码> 拒绝",
            });

            ServerApi.Hooks.GameUpdate.Register(this, OnGameUpdate);
            // 服务器动态（首页事件流）。
            ServerApi.Hooks.ServerJoin.Register(this, OnServerJoin);
            ServerApi.Hooks.ServerLeave.Register(this, OnServerLeave);
            ServerApi.Hooks.NpcKilled.Register(this, OnNpcKilled);
            // 直接回复 y / n 确认授权（可关）。
            ServerApi.Hooks.ServerChat.Register(this, OnServerChat);
            // 服务器动态：记录玩家聊天（走 TShock 的 PlayerChat，仅真实聊天、不含指令）。
            PlayerHooks.PlayerChat += OnPlayerChat;

            if (TShock.RestApi != null)
            {
                TShock.RestApi.Register(new RestCommand("/webui/auth/request", WebAuthRest.Request));
                TShock.RestApi.Register(new RestCommand("/webui/auth/poll", WebAuthRest.Poll));
                TShock.RestApi.Register(new RestCommand("/webui/auth/cancel", WebAuthRest.Cancel));
                // 批量执行需 token（用户本人），与 rawcmd 同权限；逐个指令仍走 TShock 权限检查。
                TShock.RestApi.Register(new SecureRestCommand("/webui/batch", WebAuthRest.Batch, RestPermissions.restrawcommand));
                // 只读信息 / 会话管理：只要有效 token（不额外要求权限）。
                TShock.RestApi.Register(new SecureRestCommand("/webui/commands", WebAuthRest.Commands));
                TShock.RestApi.Register(new SecureRestCommand("/webui/me", WebAuthRest.Me));
                TShock.RestApi.Register(new SecureRestCommand("/webui/data", WebAuthRest.Data));
                TShock.RestApi.Register(new SecureRestCommand("/webui/serverinfo", WebAuthRest.ServerInfo));
                TShock.RestApi.Register(new SecureRestCommand("/webui/events", WebAuthRest.Events));
                TShock.RestApi.Register(new SecureRestCommand("/webui/auth/sessions", WebAuthRest.Sessions));
                TShock.RestApi.Register(new SecureRestCommand("/webui/auth/revoke", WebAuthRest.Revoke));
                TShock.Log.ConsoleInfo("[WebUI] REST 端点已注册：/webui/auth/*、/webui/batch、/webui/{commands,me,data,serverinfo,events}");
            }
            else
            {
                TShock.Log.ConsoleError("[WebUI] TShock REST 未启用（RestApiEnabled=false），在线授权不可用。");
            }

            if (string.IsNullOrEmpty(Config.Secret))
                TShock.Log.ConsoleWarn("[WebUI] 未设置 Secret（tshock/WebUI/config.json）：请确保 REST 端口 7878 不对公网暴露，或设置 Secret 并在后端配置 TSWUI_AUTH_SECRET。");
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                ServerApi.Hooks.GameUpdate.Deregister(this, OnGameUpdate);
                ServerApi.Hooks.ServerJoin.Deregister(this, OnServerJoin);
                ServerApi.Hooks.ServerLeave.Deregister(this, OnServerLeave);
                ServerApi.Hooks.NpcKilled.Deregister(this, OnNpcKilled);
                ServerApi.Hooks.ServerChat.Deregister(this, OnServerChat);
                PlayerHooks.PlayerChat -= OnPlayerChat;
            }
            base.Dispose(disposing);
        }

        // ---------- 主线程任务队列 ----------

        private void OnGameUpdate(EventArgs args)
        {
            while (_mainThread.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 主线程任务异常：" + ex); }
            }

            // 每 ~5 秒清理一次过期票据 / 过期 token（60 tick ≈ 1 秒）。
            if (++_sweepTicks >= 300)
            {
                _sweepTicks = 0;
                try { Store?.Sweep(); }
                catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 清理异常：" + ex); }
                try { Sessions?.SweepExpired(); }
                catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 清理 token 异常：" + ex); }
            }
        }

        // ---------- 事件 / 聊天钩子 ----------

        private void OnServerJoin(JoinEventArgs e)
        {
            var name = Main.player[e.Who]?.name;
            if (string.IsNullOrWhiteSpace(name)) name = TShock.Players[e.Who]?.Name;
            EventLog.Add("join", $"{name ?? "玩家"} 加入了服务器");
        }

        private void OnServerLeave(LeaveEventArgs e)
        {
            var name = TShock.Players[e.Who]?.Name;
            if (string.IsNullOrWhiteSpace(name)) name = Main.player[e.Who]?.name;
            EventLog.Add("leave", $"{name ?? "玩家"} 离开了服务器");
        }

        private void OnNpcKilled(NpcKilledEventArgs e)
        {
            if (e?.npc == null || !e.npc.boss) return;
            EventLog.Add("boss", $"Boss「{EventLog.NpcName(e.npc.netID)}」被击败");
        }

        /// <summary>
        /// 记录普通聊天到「服务器动态」。PlayerChat 只在真正的聊天时触发
        /// （已过权限 / 禁言 / 长度校验，且不含以 / 开头的指令）。
        /// </summary>
        private void OnPlayerChat(PlayerChatEventArgs e)
        {
            if (Config == null || !Config.RecordChat || e?.Player == null) return;
            var text = (e.RawText ?? "").Trim();
            if (text.Length == 0) return;
            EventLog.Add("chat", $"{e.Player.Name}: {text}");
        }

        private void OnServerChat(ServerChatEventArgs e)
        {
            if (Config == null || !Config.AllowChatConfirm) return;
            var text = (e.Text ?? "").Trim().ToLowerInvariant();
            if (text != "y" && text != "n" && text != "yes" && text != "no") return;
            var player = TShock.Players[e.Who];
            if (player == null) return;
            var msg = Store?.TryResolveByPlayer(player.Name, text == "n" || text == "no");
            if (msg == null) return; // 没有待确认请求 → 不拦截聊天
            e.Handled = true;
            player.SendInfoMessage(msg);
        }

        internal static void RunOnMainThread(Action action)
        {
            if (_instance != null) _instance._mainThread.Enqueue(action);
        }

        // ---------- 玩家工具 ----------

        internal static TSPlayer FindPlayer(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            foreach (var p in TShock.Players)
            {
                if (p != null && p.Active && string.Equals(p.Name, name.Trim(), StringComparison.OrdinalIgnoreCase))
                    return p;
            }
            return null;
        }

        /// <summary>发送游戏内消息（会切回主线程，避免从 REST 线程写网络缓冲）。</summary>
        internal static void NotifyPlayer(string playerName, string message)
        {
            RunOnMainThread(() =>
            {
                var p = FindPlayer(playerName);
                p?.SendMessage(message, 255, 220, 120);
            });
        }

        // ---------- token 铸造 / 销毁 ----------

        /// <summary>
        /// 往 TShock 的 REST token 表里加一条 token（与 /v2/token/create 结果同构）。
        /// SecureRest.Tokens 的 getter 是 public，可直接写入；用本地锁串行化。
        /// </summary>
        internal static string MintToken(string accountName, string groupName)
        {
            var tokens = TShock.RestApi?.Tokens;
            if (tokens == null || string.IsNullOrEmpty(accountName) || string.IsNullOrEmpty(groupName))
                return null;

            string token;
            do
            {
                var bytes = new byte[32];
                using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
                token = string.Concat(bytes.Select(b => b.ToString("X2")));
            } while (tokens.ContainsKey(token));

            tokens.Add(token, new SecureRest.TokenData { Username = accountName, UserGroupName = groupName });
            Sessions?.Register(token, accountName, groupName, Config?.TokenTTLMinutes ?? 0);
            return token;
        }

        internal static void DestroyToken(string token)
        {
            if (string.IsNullOrEmpty(token)) return;
            try
            {
                TShock.RestApi?.Tokens.Remove(token);
                Sessions?.Forget(token);
            }
            catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 删除 token 失败：" + ex.Message); }
        }

        // ---------- /webui（/web）指令 ----------

        private void WebAuthCommand(CommandArgs args)
        {
            if (args.Parameters.Count == 0)
            {
                args.Player.SendInfoMessage("用法：/web auth <验证码> 同意登录；/web deny <验证码> 拒绝。");
                return;
            }

            var sub = args.Parameters[0].ToLowerInvariant();
            switch (sub)
            {
                case "auth":
                case "login":
                case "同意":
                    if (args.Parameters.Count < 2)
                    {
                        args.Player.SendInfoMessage("用法：/web auth <验证码>");
                        return;
                    }
                    args.Player.SendInfoMessage(Store.Resolve(args.Parameters[1], args.Player.Name, false));
                    return;

                case "deny":
                case "reject":
                case "拒绝":
                    if (args.Parameters.Count < 2)
                    {
                        args.Player.SendInfoMessage("用法：/web deny <验证码>");
                        return;
                    }
                    args.Player.SendInfoMessage(Store.Resolve(args.Parameters[1], args.Player.Name, true));
                    return;

                default:
                    args.Player.SendInfoMessage("用法：/web auth <验证码> 同意登录；/web deny <验证码> 拒绝。");
                    return;
            }
        }
    }
}
