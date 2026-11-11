using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using Microsoft.Xna.Framework;
using Rests;
using Terraria;
using Terraria.Chat;
using Terraria.GameContent.Events;
using Terraria.ID;
using Terraria.Localization;
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
        public override string Description => "TShockWebUI 的信使插件：在线授权登录 + 批量执行 / 只读信息 / 事件流 / 会话管理 / 网页发言 / 物资申请。";
        public override Version Version => Assembly.GetExecutingAssembly().GetName().Version;

        internal static WebAuthConfig Config;
        internal static AuthStore Store;
        internal static SessionRegistry Sessions;

        /// <summary>REST 端点是否已成功注册（用于启动报告，避免在 Initialize 里刷屏）。</summary>
        private static bool _restRegistered;
        /// <summary>启动报告是否已输出（GamePostInitialize / 首个 GameUpdate 只打一次）。</summary>
        private bool _startupAnnounced;

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
            // 服务器动态历史：建目录、恢复磁盘尾部、启动后台写线程。
            EventLog.Init(Config);
            // 物资申请：加载 tshock/WebUI/requests.json。
            RequisitionStore.Init(Config);

            // 统一入口：/webui（简写 /web），功能指令为二级子命令。
            // 权限（TShock 为 OR 语义，这里列三个，具体子命令在 handler 内再细分）：
            //   webui.use            玩家：/web auth、/web deny
            //   webui.admin          管理：/web limit（另需 tshock.rest.cfg）
            //   webui.request.review 审核：/web req（物资申请审核 / 补发）
            Commands.ChatCommands.Add(new Command(
                new List<string> { WebUiPermissions.Use, WebUiPermissions.Admin, WebUiPermissions.RequestReview },
                WebCommand, "webui", "web")
            {
                // 控制台可跑 /web init、/web limit；auth / deny 在 handler 内要求游戏内本人。
                AllowServer = true,
                HelpText = "网页端信使插件：/web init | /web auth <验证码> | /web deny <验证码> | /web limit <上限|unlimited|default> | /web req <list|show|ok|no|give>",
            });

            ServerApi.Hooks.GameUpdate.Register(this, OnGameUpdate);
            // 启动报告推迟到世界加载完成之后（否则会被加载世界的输出冲掉）。
            ServerApi.Hooks.GamePostInitialize.Register(this, OnGamePostInitialize);
            // 服务器动态（首页事件流）。
            ServerApi.Hooks.ServerJoin.Register(this, OnServerJoin);
            ServerApi.Hooks.ServerLeave.Register(this, OnServerLeave);
            ServerApi.Hooks.NpcKilled.Register(this, OnNpcKilled);
            // NPC 生成：仅用于确认「旅商到达」公告（其它城镇 NPC 不记）。
            ServerApi.Hooks.NpcSpawn.Register(this, OnNpcSpawn);
            // Boss / 事件「召唤 / 苏醒 / 入侵」等世界公告（服务器动态）。
            ServerApi.Hooks.ServerBroadcast.Register(this, OnServerBroadcast);
            // 陨石 / 困难模式。
            ServerApi.Hooks.WorldMeteorDrop.Register(this, OnMeteorDrop);
            ServerApi.Hooks.WorldStartHardMode.Register(this, OnStartHardMode);
            // 直接回复 y / n 确认授权（可关）。
            ServerApi.Hooks.ServerChat.Register(this, OnServerChat);
            // 服务器动态：记录玩家聊天（走 TShock 的 PlayerChat，仅真实聊天、不含指令）。
            PlayerHooks.PlayerChat += OnPlayerChat;
            // 物资申请：玩家登录后补发离线期间批准的申请，并补发结果提醒。
            PlayerHooks.PlayerPostLogin += OnPlayerPostLogin;

            if (TShock.RestApi != null)
            {
                // 全部声明 DoLog=false：TShock 的 LogRest 会把请求 URI（含参数）写进日志，
                // 而本插件的端点带 secret / 聊天内容 / 申请物品等敏感参数，不应入日志。
                TShock.RestApi.Register(new RestCommand("/webui/auth/request", WebAuthRest.Request) { DoLog = false });
                TShock.RestApi.Register(new RestCommand("/webui/auth/poll", WebAuthRest.Poll) { DoLog = false });
                TShock.RestApi.Register(new RestCommand("/webui/auth/cancel", WebAuthRest.Cancel) { DoLog = false });
                // 建令牌限流快照（只读、调用者自己 IP）；后端用它精确判定是否被限流。
                TShock.RestApi.Register(new RestCommand("/webui/restlimit", WebAuthRest.RateLimit) { DoLog = false });
                // 协议握手（版本 / 协议号 / 能力清单）：后端据此区分未安装、版本过旧与协议不匹配。
                TShock.RestApi.Register(new RestCommand("/webui/meta", WebAuthRest.Meta) { DoLog = false });
                // 批量执行需 token（用户本人），与 rawcmd 同权限；逐个指令仍走 TShock 权限检查。
                TShock.RestApi.Register(new SecureRestCommand("/webui/batch", WebAuthRest.Batch, RestPermissions.restrawcommand) { DoLog = false });
                // 只读信息 / 会话管理：只要有效 token（不额外要求权限）。
                TShock.RestApi.Register(new SecureRestCommand("/webui/commands", WebAuthRest.Commands) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/me", WebAuthRest.Me) { DoLog = false });
                // 游戏内 /group 后刷新 token 的用户组快照（只读调用者自己的组，不提权）。
                TShock.RestApi.Register(new SecureRestCommand("/webui/me/refresh", WebAuthRest.RefreshMe) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/data", WebAuthRest.Data) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/serverinfo", WebAuthRest.ServerInfo) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/events", WebAuthRest.Events) { DoLog = false });
                // 网页发言：任意有效 token；消息带 [WebUI] 前缀，与真实玩家聊天区分（不提权、不伪造身份）。
                TShock.RestApi.Register(new SecureRestCommand("/webui/chat", WebAuthRest.Chat) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/auth/sessions", WebAuthRest.Sessions) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/auth/revoke", WebAuthRest.Revoke) { DoLog = false });
                // 物资申请：玩家提交 / 查看 / 撤回（webui.request.use）；服主审核 / 补发（webui.request.review）。
                TShock.RestApi.Register(new SecureRestCommand("/webui/requests", RequestRest.ListMine, WebUiPermissions.RequestUse) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/requests/create", RequestRest.Create, WebUiPermissions.RequestUse) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/requests/cancel", RequestRest.Cancel, WebUiPermissions.RequestUse) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/requests/all", RequestRest.ListAll, WebUiPermissions.RequestReview) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/requests/review", RequestRest.Review, WebUiPermissions.RequestReview) { DoLog = false });
                TShock.RestApi.Register(new SecureRestCommand("/webui/requests/deliver", RequestRest.Deliver, WebUiPermissions.RequestReview) { DoLog = false });
                _restRegistered = true;
            }
        }

        /// <summary>
        /// 启动完成的「体检报告」：在这里而不是 <see cref="Initialize"/> 里输出。
        /// 原因：插件初始化发生在世界加载之前，那时的输出会被「正在加载世界数据」「正在侦听端口」等行冲掉，
        /// 服主根本看不到；而 <c>GamePostInitialize</c> 发生在世界加载完、端口已监听之后（TShock 自己的
        /// UUID / 登录提醒也打在这里），此时控制台已经安静下来。
        /// </summary>
        private void AnnounceStartup()
        {
            if (_startupAnnounced) return;
            _startupAnnounced = true;

            if (_restRegistered)
                TShock.Log.ConsoleInfo("[WebUI] REST 端点已注册：/webui/meta、/webui/auth/*、/webui/restlimit、/webui/batch、/webui/{commands,me,me/refresh,data,serverinfo,events,chat}、/webui/requests*");
            else
                TShock.Log.ConsoleError("[WebUI] TShock REST 未启用（RestApiEnabled=false），在线授权不可用；在游戏内 / 控制台执行 /web init 可自动打开。");

            if (string.IsNullOrEmpty(Config.Secret))
                TShock.Log.ConsoleWarn("[WebUI] 未设置 Secret（tshock/WebUI/config.json）：请确保 REST 端口 7878 不对公网暴露，或设置 Secret 并在后端配置 TSWUI_AUTH_SECRET。");

            // 权限 / 初始化体检：只在真有问题时才提，不刷屏。
            var missing = new List<string>();
            if (!AnyGroupHasPermission(WebUiPermissions.Use)) missing.Add(WebUiPermissions.Use);
            if (!AnyGroupHasPermission(WebUiPermissions.RequestUse)) missing.Add(WebUiPermissions.RequestUse);
            if (!AnyGroupHasPermission(WebUiPermissions.Admin)) missing.Add(WebUiPermissions.Admin);
            if (!AnyGroupHasPermission(WebUiPermissions.RequestReview)) missing.Add(WebUiPermissions.RequestReview);

            if (missing.Count > 0)
                TShock.Log.ConsoleWarn($"[WebUI] 没有任何用户组拥有：{string.Join("、", missing)}。玩家侧需要的权限可用 /web init 一键补到默认组（管理类需手动授予）。");
        }

        private static bool AnyGroupHasPermission(string permission)
        {
            try
            {
                foreach (var g in TShock.Groups)
                {
                    if (g != null && g.HasPermission(permission)) return true;
                }
            }
            catch { /* 忽略：仅日志提醒 */ }
            return false;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                ServerApi.Hooks.GameUpdate.Deregister(this, OnGameUpdate);
                ServerApi.Hooks.GamePostInitialize.Deregister(this, OnGamePostInitialize);
                ServerApi.Hooks.ServerJoin.Deregister(this, OnServerJoin);
                ServerApi.Hooks.ServerLeave.Deregister(this, OnServerLeave);
                ServerApi.Hooks.NpcKilled.Deregister(this, OnNpcKilled);
                ServerApi.Hooks.NpcSpawn.Deregister(this, OnNpcSpawn);
                ServerApi.Hooks.ServerBroadcast.Deregister(this, OnServerBroadcast);
                ServerApi.Hooks.WorldMeteorDrop.Deregister(this, OnMeteorDrop);
                ServerApi.Hooks.WorldStartHardMode.Deregister(this, OnStartHardMode);
                ServerApi.Hooks.ServerChat.Deregister(this, OnServerChat);
                PlayerHooks.PlayerChat -= OnPlayerChat;
                PlayerHooks.PlayerPostLogin -= OnPlayerPostLogin;
                // 停止事件写盘线程并 flush。
                EventLog.Shutdown();
                // 物资申请：最后一次变更落盘。
                RequisitionStore.Shutdown();
            }
            base.Dispose(disposing);
        }

        // ---------- 主线程任务队列 ----------

        /// <summary>
        /// 世界加载 / 端口监听都已完成（TShock 自己也在这里打 UUID、登录提醒）。
        /// 在这里输出启动报告，服主一眼能看到。
        /// </summary>
        private void OnGamePostInitialize(EventArgs args)
        {
            try { AnnounceStartup(); }
            catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 启动报告输出失败：" + ex.Message); }
        }

        private void OnGameUpdate(EventArgs args)
        {
            // 保底：万一 GamePostInitialize 没触发（或插件加载得更晚），第一个 tick 时补打。
            if (!_startupAnnounced) OnGamePostInitialize(args);
            while (_mainThread.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 主线程任务异常：" + ex); }
            }

            // 事件结束 / 天气变化：按状态对比补记（开始已由世界公告记录，这里只补“结束/天气”）。
            try { CheckWorldEvents(); }
            catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 世界事件检查异常：" + ex); }

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
            // 公网服务器会有爬虫 / 扫描器连进来又被踢掉：拿不到名字的连接不算玩家行为，不记。
            if (string.IsNullOrWhiteSpace(name)) return;
            EventLog.Add("join", $"{name} 加入了服务器");
        }

        private void OnServerLeave(LeaveEventArgs e)
        {
            var name = TShock.Players[e.Who]?.Name;
            if (string.IsNullOrWhiteSpace(name)) name = Main.player[e.Who]?.name;
            if (string.IsNullOrWhiteSpace(name)) return;
            EventLog.Add("leave", $"{name} 离开了服务器");
        }

        /// <summary>物资申请：玩家登录后补发离线期间批准的申请，并补发结果提醒。</summary>
        private void OnPlayerPostLogin(PlayerPostLoginEventArgs e)
        {
            try { RequisitionStore.OnPlayerPostLogin(e.Player); }
            catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 登录补发物资申请异常：" + ex); }
        }

        private void OnNpcKilled(NpcKilledEventArgs e)
        {
            if (e?.npc == null || !e.npc.boss) return;
            EventLog.Add("boss", $"Boss「{EventLog.NpcName(e.npc.netID)}」被击败");
        }

        /// <summary>
        /// 记录「Boss / 事件」世界公告与「旅商到达」。
        ///
        /// 数据源：OTAPI 的 <see cref="ServerApi.Hooks.ServerBroadcast"/>（拦截
        /// <c>ChatHelper.BroadcastChatMessage</c>）。只保留：
        ///   - 本地化文案（<c>NetworkText._mode == LocalizationKey</c>）——排除玩家聊天 / 插件消息（都是 Literal）；
        ///   - 颜色为 <c>ChatColors.BossOrEvent</c> / <c>ChatColors.World</c> → <c>announce</c>；
        ///   - 颜色为 <c>ChatColors.NPCTravel</c> 且刚刚（几秒内）生成过旅商 → <c>npc</c>（其它城镇 NPC 到达 / 离开不记，避免刷屏）；
        ///   - 跳过「已被击败」类公告（击杀已由 <see cref="OnNpcKilled"/> 记成 boss 事件，避免重复）。
        /// 文案取游戏本地化后的原文，与游戏内聊天完全一致。
        /// </summary>
        private void OnServerBroadcast(ServerBroadcastEventArgs e)
        {
            if (e?.Message == null) return;
            var key = LocalizationKey(e.Message);
            if (key == null) return;
            var type = AnnouncementType(e.Color);
            if (type == null) return;
            if (key.StartsWith("Announcement.HasBeenDefeated", StringComparison.Ordinal)) return;

            string text;
            try { text = e.Message.ToString(); }
            catch { return; }
            if (string.IsNullOrWhiteSpace(text)) return;
            EventLog.Add(type, text.Trim());
        }

        /// <summary>按游戏公告色分类：announce（Boss/事件/世界）；其它返回 null。</summary>
        private static string AnnouncementType(Color color)
        {
            if (color == ChatColors.BossOrEvent || color == ChatColors.World) return "announce";
            return null;
        }

        // ---------- 旅商到达 ----------

        /// <summary>
        /// 旅商（NPC 368）到达**始终记录**：直接靠 <see cref="ServerApi.Hooks.NpcSpawn"/>，
        /// 不依赖公告（公告可能因颜色 / 文案变化而漏掉）。
        /// `Main.gameMenu` 时（世界加载阶段回放存档 NPC）不记，避免重启时误报。
        /// 其它城镇 NPC 的到达 / 离开与 NPC 死亡都不记（避免 Boss 战时批量伤亡刷屏）。
        /// </summary>
        private static void OnNpcSpawn(NpcSpawnEventArgs e)
        {
            if (Main.gameMenu) return;
            try
            {
                var npc = Main.npc[e.NpcId];
                if (npc != null && npc.active && npc.type == NPCID.TravellingMerchant)
                    EventLog.Add("npc", "旅商已到达");
            }
            catch { /* 忽略 */ }
        }

        // ---------- 陨石 / 困难模式 ----------

        private static void OnMeteorDrop(MeteorDropEventArgs e)
        {
            EventLog.Add("announce", "一颗陨石坠落了");
        }

        private static void OnStartHardMode(EventArgs e)
        {
            EventLog.Add("announce", "世界进入困难模式：圣光与暗影的远古之灵被释放");
        }

        // ---------- 事件结束 / 天气（状态对比） ----------

        private static bool _prevBloodMoon, _prevEclipse, _prevPumpkinMoon, _prevSnowMoon;
        private static bool _prevSlimeRain, _prevRaining, _prevSandstorm, _prevInvasion;
        private static bool _worldEventsInit;

        /// <summary>
        /// 对比世界状态变化，补记「事件结束」与天气（下雨 / 沙尘暴）——
        /// 这些没有世界公告（或公告颜色不在采集范围），所以用状态对比。
        /// 开局不广播已有状态（只在运行中发生“变化”时记）。
        /// </summary>
        private static void CheckWorldEvents()
        {
            // 世界未加载（主菜单）时不初始化，避免把“世界加载时的既有状态”当成一次变化。
            if (Main.gameMenu) return;

            bool blood = Main.bloodMoon;
            bool eclipse = Main.eclipse;
            bool pumpkin = Main.pumpkinMoon;
            bool snow = Main.snowMoon;
            bool slime = Main.slimeRain;
            bool rain = Main.raining;
            bool sand = Sandstorm.Happening;
            bool invasion = Main.invasionType > 0;

            if (!_worldEventsInit)
            {
                _worldEventsInit = true;
                _prevBloodMoon = blood; _prevEclipse = eclipse; _prevPumpkinMoon = pumpkin;
                _prevSnowMoon = snow; _prevSlimeRain = slime; _prevRaining = rain;
                _prevSandstorm = sand; _prevInvasion = invasion;
                return;
            }

            if (_prevBloodMoon && !blood) EventLog.Add("announce", "血月结束了");
            if (_prevEclipse && !eclipse) EventLog.Add("announce", "日食结束了");
            if (_prevInvasion && !invasion) EventLog.Add("announce", "入侵结束了");
            if (_prevPumpkinMoon && !pumpkin) EventLog.Add("announce", "南瓜月结束了");
            if (_prevSnowMoon && !snow) EventLog.Add("announce", "霜月结束了");
            if (_prevSlimeRain && !slime) EventLog.Add("announce", "史莱姆雨停了");
            if (!_prevRaining && rain) EventLog.Add("announce", "下雨了");
            if (_prevRaining && !rain) EventLog.Add("announce", "雨停了");
            if (!_prevSandstorm && sand) EventLog.Add("announce", "沙尘暴来了");
            if (_prevSandstorm && !sand) EventLog.Add("announce", "沙尘暴结束了");

            _prevBloodMoon = blood; _prevEclipse = eclipse; _prevPumpkinMoon = pumpkin;
            _prevSnowMoon = snow; _prevSlimeRain = slime; _prevRaining = rain;
            _prevSandstorm = sand; _prevInvasion = invasion;
        }

        // NetworkText 的 _mode / _text 是私有字段（OTAPI）；键能区分「游戏公告」与「玩家聊天」。
        private static readonly FieldInfo NetworkTextModeField =
            typeof(NetworkText).GetField("_mode", BindingFlags.Instance | BindingFlags.NonPublic);
        private static readonly FieldInfo NetworkTextTextField =
            typeof(NetworkText).GetField("_text", BindingFlags.Instance | BindingFlags.NonPublic);

        /// <summary>若是本地化键文案则返回其键（如 Announcement.HasAwoken）；否则返回 null。</summary>
        private static string LocalizationKey(NetworkText text)
        {
            if (text == null || NetworkTextModeField == null) return null;
            try
            {
                var mode = NetworkTextModeField.GetValue(text)?.ToString();
                if (mode != "LocalizationKey") return null;
                return NetworkTextTextField?.GetValue(text) as string;
            }
            catch
            {
                return null;
            }
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
            EventLog.Add("chat", $"{e.Player.Name}: {text}", "game");
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

        /// <summary>
        /// 把 token 的用户组对齐到账号当前所在组（游戏内 /group 之后由 /webui/me/refresh 触发）。
        /// SecureRest.TokenData 是 struct（字典里存值），所以要整条替换，而不是改字段；
        /// TShock 自己的 rawcmd 权限判定每次请求都读这份数据。
        /// 返回 false 表示这个 token 不在 <c>Tokens</c> 里（如服务器预置的 <c>ApplicationRestTokens</c>）。
        /// </summary>
        internal static bool RenewTokenGroup(string token, string groupName)
        {
            if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(groupName)) return false;
            var tokens = TShock.RestApi?.Tokens;
            if (tokens == null || !tokens.TryGetValue(token, out var data)) return false;
            data.UserGroupName = groupName;
            tokens[token] = data;
            Sessions?.UpdateGroup(token, groupName);
            return true;
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

        // ---------- /webui（/web）指令：功能指令为二级子命令 ----------

        private void WebCommand(CommandArgs args)
        {
            if (args.Parameters.Count == 0)
            {
                WebHelp(args);
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

                case "limit":
                case "restlimit":
                    // 改的是 TShock 的 config.json：保留 tshock.rest.cfg 要求，另加 webui.admin。
                    if (!HasAll(args.Player, WebUiPermissions.Admin, RestPermissions.restcfg))
                    {
                        args.Player?.SendErrorMessage("需要 webui.admin（且 tshock.rest.cfg）权限。");
                        return;
                    }
                    WebLimit(args, args.Parameters.Skip(1).ToList());
                    return;

                case "init":
                case "初始化":
                    // 同样会写 TShock 的 config.json（REST 开关 / 限流 / 日志）+ 改默认组权限。
                    if (!HasAll(args.Player, WebUiPermissions.Admin, RestPermissions.restcfg))
                    {
                        args.Player?.SendErrorMessage("需要 webui.admin（且 tshock.rest.cfg）权限。");
                        return;
                    }
                    WebInit(args);
                    return;

                case "req":
                case "request":
                case "申请":
                    WebReq(args, args.Parameters.Skip(1).ToList());
                    return;

                default:
                    WebHelp(args);
                    return;
            }
        }

        private static void WebHelp(CommandArgs args)
        {
            args.Player?.SendInfoMessage("网页端信使插件（/webui，简写 /web）：");
            args.Player?.SendInfoMessage("  /web init  一键初始化：打开 REST / 限流 / 给默认组补权限（需 webui.admin + tshock.rest.cfg）");
            args.Player?.SendInfoMessage("  /web auth <验证码>  同意网页登录（需 webui.use）");
            args.Player?.SendInfoMessage("  /web deny <验证码>  拒绝网页登录");
            args.Player?.SendInfoMessage("  /web limit <上限|unlimited|default>  放宽 REST 建令牌限流（需 webui.admin + tshock.rest.cfg）");
            args.Player?.SendInfoMessage("  /web req list|show|ok|no|give  物资申请审核（需 webui.request.review）");
        }

        /// <summary>
        /// /web req：物资申请审核（服主 / 管理组）。
        ///   /web req list [pending|approved|all]
        ///   /web req show <id>
        ///   /web req ok <id>
        ///   /web req no <id> [原因]
        ///   /web req give <id>
        /// </summary>
        private static void WebReq(CommandArgs args, List<string> rest)
        {
            if (!HasAll(args.Player, WebUiPermissions.RequestReview))
            {
                args.Player?.SendErrorMessage($"需要 {WebUiPermissions.RequestReview} 权限。");
                return;
            }

            if (rest.Count == 0 || rest[0].Equals("help", StringComparison.OrdinalIgnoreCase))
            {
                args.Player?.SendInfoMessage("物资申请审核：");
                args.Player?.SendInfoMessage("  /web req list [pending|approved|all]  列表（默认 pending）");
                args.Player?.SendInfoMessage("  /web req show <id>  详情");
                args.Player?.SendInfoMessage("  /web req ok <id>  通过并发放（在线立即给 / 离线下次登录）");
                args.Player?.SendInfoMessage("  /web req no <id> [原因]  拒绝");
                args.Player?.SendInfoMessage("  /web req give <id>  补发已批准未发放的申请");
                return;
            }

            var action = (rest[0] ?? "").ToLowerInvariant();
            var idArg = rest.Count > 1 ? rest[1] : "";
            if (action != "list" && !int.TryParse(idArg, out _))
            {
                args.Player?.SendErrorMessage("用法：/web req <list|show|ok|no|give> [id]");
                return;
            }

            switch (action)
            {
                case "list":
                    SendLines(args.Player, RequisitionStore.CommandList(idArg));
                    return;

                case "show":
                    SendLines(args.Player, RequisitionStore.CommandShow(int.Parse(idArg)));
                    return;

                case "ok":
                case "approve":
                {
                    var result = RequisitionStore.ReviewFromCommand(args.Player, int.Parse(idArg), "approve", "") as RestObject;
                    Report(args.Player, result, int.Parse(idArg));
                    return;
                }

                case "no":
                case "deny":
                {
                    var reason = rest.Count > 2 ? string.Join(" ", rest.Skip(2)) : "";
                    var result = RequisitionStore.ReviewFromCommand(args.Player, int.Parse(idArg), "deny", reason) as RestObject;
                    Report(args.Player, result, int.Parse(idArg));
                    return;
                }

                case "give":
                case "deliver":
                {
                    var result = RequisitionStore.DeliverFromCommand(args.Player, int.Parse(idArg)) as RestObject;
                    Report(args.Player, result, int.Parse(idArg));
                    return;
                }

                default:
                    args.Player?.SendErrorMessage("未知子命令；用 /web req help 查看用法。");
                    return;
            }
        }

        private static void Report(TSPlayer player, RestObject result, int id)
        {
            if (result == null) return;
            if (result.ContainsKey("error"))
            {
                player?.SendErrorMessage((result["error"] ?? "").ToString());
                return;
            }
            SendLines(player, RequisitionStore.CommandShow(id));
        }

        private static void SendLines(TSPlayer player, string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            foreach (var line in text.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries))
                player?.SendInfoMessage(line);
        }

        /// <summary>权限判断：玩家需同时具备全部权限；控制台 / 服务端玩家按 TShock 权限（superadmin）通过。</summary>
        private static bool HasAll(TSPlayer player, params string[] permissions)
        {
            if (player == null) return true;
            foreach (var p in permissions)
            {
                if (!player.HasPermission(p)) return false;
            }
            return true;
        }

        /// <summary>auth / deny 必须由本人游戏内执行（控制台顶替不了玩家确认）。</summary>
        private static bool RequireInGamePlayer(CommandArgs args)
        {
            if (args.Player != null && args.Player.RealPlayer) return true;
            args.Player?.SendErrorMessage("该操作必须在游戏内由玩家本人执行。");
            return false;
        }

        /// <summary>
        /// /web limit：查看或放宽 TShock 的建令牌限流（<c>RESTMaximumRequestsPerInterval</c>）。
        /// 权限：webui.admin + tshock.rest.cfg；改的是 TShock 的 config.json。
        /// 背景：该限流会把 403 伪装成「账号或密码错误」，放宽后玩家不再莫名登录失败。
        /// </summary>
        private void WebLimit(CommandArgs args, List<string> rest)
        {
            var player = args.Player;
            var settings = TShock.Config.Settings;

            if (rest.Count == 0)
            {
                player.SendInfoMessage($"TShock REST 建令牌限流：上限 {settings.RESTMaximumRequestsPerInterval}，" +
                                       $"每 {settings.RESTRequestBucketDecreaseIntervalMinutes} 分钟恢复 1 个。");
                player.SendInfoMessage("用法：/web limit <上限>（≥1）；/web limit unlimited 基本不限；/web limit default 恢复默认 5。");
                return;
            }

            var arg = (rest[0] ?? "").Trim().ToLowerInvariant();
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

        // ---------- /web init ----------

        /// <summary><see cref="WebInit"/> 写入的建令牌上限（TShock 默认 5，太小：晚高峰会莫名登录失败）。</summary>
        internal const int InitRestLimit = 50;

        /// <summary><see cref="WebInit"/> 写入的限流桶恢复间隔（分钟）。</summary>
        internal const int InitRestIntervalMinutes = 10;

        /// <summary>
        /// <see cref="WebInit"/> 给默认注册组补的权限。
        /// 只给「网页端能登录 / 能执行 / 能提交申请」所需的 4 个；
        /// 管理类（<c>webui.admin</c>、<c>webui.request.review</c>、<c>tshock.rest.cfg</c>）**不自动给**。
        /// </summary>
        internal static readonly string[] InitDefaultGroupPermissions =
        {
            RestPermissions.restapi,        // tshock.rest.useapi：建 token
            RestPermissions.restrawcommand, // tshock.rest.command：rawcmd（网页批量执行）
            WebUiPermissions.Use,           // webui.use：/web auth 确认登录
            WebUiPermissions.RequestUse,    // webui.request.use：物资申请
        };

        /// <summary>
        /// /web init：新人服主一键初始化（幂等，重复执行没有副作用）。
        ///   1. TShock 配置：RestApiEnabled=true、LogRest=true、限流 50 / 每 10 分钟恢复 1 → 写 config.json；
        ///   2. 默认注册组补上 <see cref="InitDefaultGroupPermissions"/> 四个权限。
        /// 只往上调、不往下调：已有更大的建令牌上限保持原值。
        /// 权限：webui.admin + tshock.rest.cfg（会写 TShock 的 config.json）。
        /// </summary>
        private void WebInit(CommandArgs args)
        {
            var player = args.Player;
            var settings = TShock.Config.Settings;
            var done = new List<string>();
            var kept = new List<string>();

            // ---- 1. TShock 的 REST 配置 ----
            var configChanged = false;

            if (!settings.RestApiEnabled)
            {
                settings.RestApiEnabled = true;
                configChanged = true;
                done.Add("RestApiEnabled = true：开启 REST 接口（需重启 TShock 才生效）");
            }

            if (!settings.LogRest)
            {
                settings.LogRest = true;
                configChanged = true;
                done.Add("LogRest = true：REST 调用记入 TShock 日志（插件自己的端点已声明不记，避免 secret / 聊天进日志）");
            }

            if (settings.RESTMaximumRequestsPerInterval < InitRestLimit)
            {
                var old = settings.RESTMaximumRequestsPerInterval;
                settings.RESTMaximumRequestsPerInterval = InitRestLimit;
                configChanged = true;
                done.Add($"RESTMaximumRequestsPerInterval = {InitRestLimit}（原 {old}）：建令牌上限，够晚高峰一次开服");
            }
            else if (settings.RESTMaximumRequestsPerInterval > InitRestLimit)
            {
                kept.Add($"RESTMaximumRequestsPerInterval 保持 {settings.RESTMaximumRequestsPerInterval}（不往下调）");
            }

            if (settings.RESTRequestBucketDecreaseIntervalMinutes != InitRestIntervalMinutes)
            {
                var old = settings.RESTRequestBucketDecreaseIntervalMinutes;
                settings.RESTRequestBucketDecreaseIntervalMinutes = InitRestIntervalMinutes;
                configChanged = true;
                done.Add($"RESTRequestBucketDecreaseIntervalMinutes = {InitRestIntervalMinutes}（原 {old}）：每 {InitRestIntervalMinutes} 分钟恢复 1 个令牌额度");
            }

            if (configChanged)
            {
                try
                {
                    TShock.Config.Write(System.IO.Path.Combine(TShock.SavePath, "config.json"));
                    done.Add("以上配置已写入 TShock 的 config.json");
                }
                catch (Exception ex)
                {
                    player?.SendErrorMessage("写入 TShock config.json 失败：" + ex.Message);
                    return;
                }
            }

            // ---- 2. 默认注册组的权限 ----
            var preferred = (settings.DefaultRegistrationGroupName ?? "").Trim();
            var group = preferred.Length > 0 ? TShock.Groups.GetGroupByName(preferred) : null;
            if (group == null) group = TShock.Groups.GetGroupByName("default");

            if (group == null)
            {
                player?.SendErrorMessage($"找不到默认注册组（{(preferred.Length > 0 ? preferred : "default")}），权限未改动；请用 /group addperm 手动授予：" + string.Join(" ", InitDefaultGroupPermissions));
            }
            else
            {
                var missing = InitDefaultGroupPermissions.Where(p => !group.TotalPermissions.Contains(p)).ToList();
                if (missing.Count == 0)
                {
                    kept.Add($"{group.Name} 组已具备全部所需权限");
                }
                else
                {
                    try
                    {
                        TShock.Groups.AddPermissions(group.Name, missing);
                        done.Add($"{group.Name} 组 + {string.Join(" ", missing)}");
                    }
                    catch (Exception ex)
                    {
                        player?.SendErrorMessage($"给 {group.Name} 组添加权限失败：{ex.Message}");
                    }
                }
            }

            // ---- 3. 汇报 ----
            var who = string.IsNullOrEmpty(player?.Name) ? "Console" : player.Name;
            TShock.Log.ConsoleInfo($"[WebUI] /web init 已由 {who} 执行：改动 {done.Count} 项。");

            if (done.Count == 0)
                player?.SendSuccessMessage("[WebUI] 初始化检查完毕：已经是推荐配置，没有改动。");
            else
            {
                player?.SendSuccessMessage($"[WebUI] 初始化完成，共改动 {done.Count} 项：");
                foreach (var line in done) player?.SendInfoMessage("  " + line);
            }

            foreach (var line in kept) player?.SendInfoMessage("  · " + line);

            player?.SendInfoMessage("下一步：插件 Secret 与后端 TSWUI_AUTH_SECRET 保持一致；刚打开 REST 的需重启 TShock。");
        }
    }

    /// <summary>
    /// 信使插件指令的权限节点（TShock 动态权限字符串，需服主用 /group addperm 授予）。
    ///   - <see cref="Use"/>：玩家级（/web auth、/web deny）；
    ///   - <see cref="Admin"/>：管理级（/web limit；另需 tshock.rest.cfg）。
    /// </summary>
    internal static class WebUiPermissions
    {
        public const string Use = "webui.use";
        public const string Admin = "webui.admin";
        /// <summary>提交 / 查看 / 撤回自己的物资申请。</summary>
        public const string RequestUse = "webui.request.use";
        /// <summary>审核 / 补发物资申请（游戏内 /web req 与网页审核）。</summary>
        public const string RequestReview = "webui.request.review";
    }
}
