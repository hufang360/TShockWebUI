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

            // 普通玩家：只开放「授权登录」确认（/web auth|deny），无权限要求、仅限游戏内。
            Commands.ChatCommands.Add(new Command(WebAuthCommand, "webui", "web")
            {
                AllowServer = false,
                HelpText = "网页端登录：/web auth <验证码> 同意；/web deny <验证码> 拒绝",
            });

            // 高级指令：改 TShock REST 建令牌限流。单独注册、挂 tshock.rest.cfg，
            // 普通玩家既不会在 /help 看到它，也跑不了（TShock 按 Command.CanRun 校验）。
            Commands.ChatCommands.Add(new Command(RestPermissions.restcfg, WebAdminCommand, "webadmin", "weblimit")
            {
                AllowServer = true,
                HelpText = "WebUI 管理：/weblimit 查看、/weblimit <上限|unlimited|default> 放宽 REST 建令牌限流",
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
                // 建令牌限流快照（只读、调用者自己 IP）；后端用它精确判定是否被限流。
                TShock.RestApi.Register(new RestCommand("/webui/restlimit", WebAuthRest.RateLimit));
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
                TShock.Log.ConsoleInfo("[WebUI] REST 端点已注册：/webui/auth/*、/webui/restlimit、/webui/batch、/webui/{commands,me,data,serverinfo,events}");
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
                WebAuthHelp(args);
                return;
            }

            var sub = args.Parameters[0].ToLowerInvariant();
            switch (sub)
            {
                case "auth":
                case "login":
                case "同意":
                    if (!RequireInGamePlayer(args)) return;
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
                    if (!RequireInGamePlayer(args)) return;
                    if (args.Parameters.Count < 2)
                    {
                        args.Player.SendInfoMessage("用法：/web deny <验证码>");
                        return;
                    }
                    args.Player.SendInfoMessage(Store.Resolve(args.Parameters[1], args.Player.Name, true));
                    return;

                default:
                    WebAuthHelp(args);
                    return;
            }
        }

        private static void WebAuthHelp(CommandArgs args)
        {
            args.Player?.SendInfoMessage("用法：/web auth <验证码> 同意登录；/web deny <验证码> 拒绝。");
        }

        /// <summary>auth / deny 必须由本人游戏内执行（控制台顶替不了玩家确认）。</summary>
        private static bool RequireInGamePlayer(CommandArgs args)
        {
            if (args.Player != null && args.Player.RealPlayer) return true;
            args.Player?.SendErrorMessage("该操作必须在游戏内由玩家本人执行。");
            return false;
        }

        /// <summary>
        /// /weblimit：查看或放宽 TShock 的建令牌限流（<c>RESTMaximumRequestsPerInterval</c>）。
        /// 命令本身挂 <c>tshock.rest.cfg</c>（普通玩家不可见/不可执行）；改的是 TShock 的 config.json。
        /// 背景：该限流会把 403 伪装成「账号或密码错误」，放宽后玩家不再莫名登录失败。
        /// </summary>
        private void WebAdminCommand(CommandArgs args)
        {
            var player = args.Player;
            var settings = TShock.Config.Settings;

            if (args.Parameters.Count == 0)
            {
                player.SendInfoMessage($"TShock REST 建令牌限流：上限 {settings.RESTMaximumRequestsPerInterval}，" +
                                       $"每 {settings.RESTRequestBucketDecreaseIntervalMinutes} 分钟恢复 1 个。");
                player.SendInfoMessage("用法：/weblimit <上限>（≥1）；/weblimit unlimited 基本不限；/weblimit default 恢复默认 5。");
                return;
            }

            var arg = (args.Parameters[0] ?? "").Trim().ToLowerInvariant();
            int value;
            if (arg == "default" || arg == "重置")
                value = RestLimit.DefaultLimit;
            else if (arg == "unlimited" || arg == "off" || arg == "无限")
                value = RestLimit.Unlimited;
            else if (!int.TryParse(arg, out value) || value < 1)
            {
                player.SendErrorMessage("上限必须是 ≥1 的整数（或用 unlimited / default）。");
                return;
            }

            settings.RESTMaximumRequestsPerInterval = value;
            try
            {
                TShock.Config.Write(System.IO.Path.Combine(TShock.SavePath, "config.json"));
            }
            catch (Exception ex)
            {
                player.SendErrorMessage("写入 config.json 失败：" + ex.Message);
                return;
            }

            var who = string.IsNullOrEmpty(player?.Name) ? "Console" : player.Name;
            TShock.Log.ConsoleInfo($"[WebUI] RESTMaximumRequestsPerInterval 已由 {who} 设为 {value}。");
            player.SendSuccessMessage($"已把 REST 建令牌上限设为 {value}（每 {settings.RESTRequestBucketDecreaseIntervalMinutes} 分钟恢复 1 个），并写入 config.json。");
        }
    }
}
