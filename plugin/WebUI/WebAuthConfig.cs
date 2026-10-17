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
