using System;
using System.IO;
using Newtonsoft.Json;
using TShockAPI;

namespace WebUI
{
    /// <summary>
    /// 插件配置，落在 <c>tshock/WebUI/config.json</c>。首次启动自动生成（含目录）。
    /// </summary>
    public class WebAuthConfig
    {
        /// <summary>
        /// 与 WebUI 后端共享的密钥（后端环境变量 TSWUI_AUTH_SECRET）。
        /// 非空时，REST 端点要求 <c>secret</c> 参数一致；留空表示不校验
        /// （仅建议在 REST 端口不对外暴露时使用）。
        /// </summary>
        public string Secret = "";

        /// <summary>一次授权请求的有效期（秒）。后端会在此时间内轮询。</summary>
        public int TimeoutSeconds = 60;

        /// <summary>同一玩家每分钟最多发起的授权请求数（防刷屏）。</summary>
        public int MaxRequestsPerMinute = 5;

        /// <summary>
        /// 同一玩家两次「新建票据」之间的冷却（秒）：新建票据会发游戏内消息，
        /// 冷却期内重复请求只复用已有票据 / 直接拒绝，不再刷屏。
        /// </summary>
        public int PlayerCooldownSeconds = 60;

        /// <summary>玩家拒绝 / 票据过期后，再次发起请求的额外冷却（秒）。</summary>
        public int DeniedCooldownSeconds = 300;

        /// <summary>
        /// 服务器整体每分钟最多发起的授权请求数（防有人逐个骚扰在线玩家）。
        /// 0 = 不限。
        /// </summary>
        public int MaxRequestsPerMinuteGlobal = 10;

        /// <summary>
        /// 同一来源 IP 每分钟最多发起的授权请求数。0 = 不限。
        /// 依赖后端传入 ip 参数；未传时此项不生效。
        /// </summary>
        public int MaxRequestsPerMinutePerIp = 3;

        /// <summary>同时存在的未完成票据上限（防内存增长）。0 = 不限。</summary>
        public int MaxPendingTickets = 64;

        /// <summary>
        /// 本插件铸造的 web token 有效期（分钟）。0 = 不过期（跟随后端会话 / 手动退出）。
        /// 到期后自动从 TShock 的 REST token 表移除。
        /// </summary>
        public int TokenTTLMinutes = 0;

        /// <summary>
        /// 是否允许经 /webui/batch?mode=player 执行 <c>AllowServer=false</c> 的指令
        /// （用真实在线玩家身份，权限不多一分）。默认关闭：这会把「只能在游戏内做的事」搬到网页。
        /// </summary>
        public bool AllowInGameOnlyCommands = false;

        /// <summary>是否允许玩家直接回复 y / n 确认（无需输入 /web auth 验证码）。</summary>
        public bool AllowChatConfirm = true;

        /// <summary>
        /// 是否把玩家聊天记入「服务器动态」（事件流 type=chat）。
        /// 只记普通聊天，不含指令；默认开。关掉即完全不采集聊天内容。
        /// </summary>
        public bool RecordChat = true;

        /// <summary>
        /// 是否允许网页端（/webui/chat）把文本发到游戏内聊天。
        /// 消息会带 <c>[WebUI]</c> 前缀、与「真实在线玩家」明确区分，默认开。
        /// </summary>
        public bool AllowWebChat = true;

        /// <summary>同一账号每分钟最多经网页发送的聊天条数（防刷屏）。0 = 不限。</summary>
        public int MaxWebChatPerMinute = 20;

        /// <summary>
        /// 网页发言在游戏内/事件流里的前缀（默认 <c>[WebUI]</c>）。
        /// 用于把「网页发言」与真实在线玩家聊天明确区分；可改成自己服里更醒目的标记。
        /// </summary>
        public string ChatPrefix = "[WebUI]";

        /// <summary>
        /// 是否把「服务器动态」事件写入磁盘（<c>tshock/WebUI/events/</c>）。
        /// 默认开：重启 TShock 后历史仍在；关掉则只保留内存（重启即清空）。
        /// </summary>
        public bool PersistEvents = true;

        /// <summary>
        /// 是否把玩家聊天也写入事件历史文件。默认**关**（保护隐私）：
        /// 关掉时 join/leave/boss 照常落盘，聊天只在内存里（<see cref="RecordChat"/> 为总开关）。
        /// </summary>
        public bool PersistChat = false;

        /// <summary>事件历史保留天数（默认 7；&lt;=0 表示不按天清理）。</summary>
        public int HistoryDays = 7;

        // ---------- 物资申请（/webui/requests*、/web req） ----------

        /// <summary>是否启用物资申请（默认开）。关闭后不再接受新申请，已存在的仍可审核 / 查看。</summary>
        public bool RequestsEnabled = true;

        /// <summary>一次申请最多几种物品（默认 10；&lt;=0 回退 10）。</summary>
        public int RequestMaxItems = 10;

        /// <summary>每种物品最多几组（默认 10；按物品 maxStack 计算；&lt;=0 回退 10）。</summary>
        public int RequestMaxStacksPerLine = 10;

        /// <summary>单条申请的总组数上限（默认 30；&lt;=0 回退 30）。</summary>
        public int RequestMaxTotalStacks = 30;

        /// <summary>每个账号最多同时存在的待审核申请数（默认 3；&lt;=0 不限）。</summary>
        public int RequestMaxPendingPerPlayer = 3;

        /// <summary>每个账号每天最多提交的申请数（默认 10；&lt;=0 不限）。</summary>
        public int RequestMaxPerDayPerPlayer = 10;

        /// <summary>同一账号两次提交的最小间隔（秒，默认 10；&lt;=0 不限）。</summary>
        public int RequestMinIntervalSeconds = 10;

        /// <summary>全服待审核申请上限（默认 200；&lt;=0 不限）。</summary>
        public int RequestMaxPendingTotal = 200;

        /// <summary>已结束的申请保留天数（默认 30；&lt;=0 不按天清理）。</summary>
        public int RequestHistoryDays = 30;

        /// <summary>审核通过后是否自动发放（在线直接给，离线下次登录给；默认开）。
        /// 关掉后只标记「已批准」，服主用 /web req give 或网页「补发」发放。</summary>
        public bool RequestAutoDeliver = true;

        /// <summary>新申请时是否给在线审核人发游戏内提示（默认开）。</summary>
        public bool RequestNotifyReviewers = true;

        /// <summary>事件历史目录总大小上限 MB（默认 50；&lt;=0 表示不按大小清理）。</summary>
        public int HistoryMaxMB = 50;

        /// <summary>配置文件路径（便于日志提示）。</summary>
        [JsonIgnore]
        public string Path;

        public static WebAuthConfig Load()
        {
            var path = System.IO.Path.Combine(TShock.SavePath, "WebUI", "config.json");
            try
            {
                if (File.Exists(path))
                {
                    var cfg = JsonConvert.DeserializeObject<WebAuthConfig>(File.ReadAllText(path)) ?? new WebAuthConfig();
                    cfg.Path = path;
                    return cfg.Normalize();
                }
            }
            catch (Exception ex)
            {
                TShock.Log.ConsoleError("[WebUI] 读取配置失败，使用默认值：" + ex.Message);
            }

            var fresh = new WebAuthConfig { Path = path };
            fresh.Save();
            return fresh;
        }

        public WebAuthConfig Normalize()
        {
            if (TimeoutSeconds < 10 || TimeoutSeconds > 600) TimeoutSeconds = 60;
            if (MaxRequestsPerMinute < 1) MaxRequestsPerMinute = 1;
            if (PlayerCooldownSeconds < 0) PlayerCooldownSeconds = 0;
            if (DeniedCooldownSeconds < 0) DeniedCooldownSeconds = 0;
            if (MaxRequestsPerMinuteGlobal < 0) MaxRequestsPerMinuteGlobal = 0;
            if (MaxRequestsPerMinutePerIp < 0) MaxRequestsPerMinutePerIp = 0;
            if (MaxPendingTickets < 0) MaxPendingTickets = 0;
            if (TokenTTLMinutes < 0) TokenTTLMinutes = 0;
            if (MaxWebChatPerMinute < 0) MaxWebChatPerMinute = 0;
            if (HistoryDays < 0) HistoryDays = 0;
            if (HistoryMaxMB < 0) HistoryMaxMB = 0;
            if (RequestMaxItems <= 0) RequestMaxItems = 10;
            if (RequestMaxStacksPerLine <= 0) RequestMaxStacksPerLine = 10;
            if (RequestMaxTotalStacks <= 0) RequestMaxTotalStacks = 30;
            if (RequestMaxPendingPerPlayer < 0) RequestMaxPendingPerPlayer = 0;
            if (RequestMaxPerDayPerPlayer < 0) RequestMaxPerDayPerPlayer = 0;
            if (RequestMinIntervalSeconds < 0) RequestMinIntervalSeconds = 0;
            if (RequestMaxPendingTotal < 0) RequestMaxPendingTotal = 0;
            if (RequestHistoryDays < 0) RequestHistoryDays = 0;
            if (string.IsNullOrWhiteSpace(ChatPrefix)) ChatPrefix = "[WebUI]";
            if (Secret == null) Secret = "";
            return this;
        }

        public void Save()
        {
            try
            {
                if (!string.IsNullOrEmpty(Path))
                {
                    var dir = System.IO.Path.GetDirectoryName(Path);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    File.WriteAllText(Path, JsonConvert.SerializeObject(this, Formatting.Indented));
                }
            }
            catch (Exception ex)
            {
                TShock.Log.ConsoleError("[WebUI] 写入配置失败：" + ex.Message);
            }
        }
    }
}
