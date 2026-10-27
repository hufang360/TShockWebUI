using System;
using System.Collections.Generic;
using System.Reflection;
using Rests;

namespace WebUI
{
    /// <summary>
    /// 插件与后端之间的「协议握手」：版本号 + 协议号 + 能力清单。
    ///
    /// 后端（WebUI Go）用 /webui/meta 的结果来判断：
    ///   - 插件是否安装（能否取到 meta）；
    ///   - 版本 / 协议是否兼容；
    ///   - 某个能力（端点）是否可用。
    /// 不匹配时后端给出可定位的错误码（plugin_outdated / plugin_protocol_mismatch），
    /// 而不是笼统的「未安装插件」。
    ///
    /// 约定：**破坏性改动**（改了既有字段 / 语义）才 +1 <see cref="Protocol"/>；
    /// 只新增端点 / 字段时，把能力加进 <see cref="Capabilities"/> 即可，不动协议号。
    /// </summary>
    internal static class Meta
    {
        /// <summary>当前插件实现的协议号。</summary>
        public const int Protocol = 1;

        /// <summary>仍能兼容的最旧后端协议号：后端协议落在 [MinProtocol, Protocol] 即兼容。</summary>
        public const int MinProtocol = 1;

        /// <summary>插件版本（来自 csproj 的 &lt;Version&gt;）。</summary>
        public static string Version =>
            Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";

        /// <summary>本插件提供的 REST 能力清单（与 Go 端 tshock.Cap* 常量一一对应）。</summary>
        public static string[] Capabilities()
        {
            var caps = new List<string>
            {
                "auth",        // /webui/auth/*（在线授权 + 会话自助）
                "restlimit",   // /webui/restlimit
                "batch",       // /webui/batch
                "commands",    // /webui/commands
                "me",          // /webui/me
                "data",        // /webui/data
                "serverinfo",  // /webui/serverinfo
                "events",      // /webui/events
                "events_history", // /webui/events?tail=N（磁盘历史 + 取最新 N 条）
                "events_instance", // /webui/events 返回 instance（同地址换服时后端据此作废缓存）
                "sessions",    // /webui/auth/sessions + /webui/auth/revoke
                "chat",        // /webui/chat
                "requests",    // /webui/requests*（物资申请：玩家提交 / 查看 / 撤回）
                "requests_review", // /webui/requests/{all,review,deliver}（服主审核 / 补发）
            };
            caps.Sort(StringComparer.Ordinal);
            return caps.ToArray();
        }

        public static object Describe()
        {
            return new RestObject("200")
            {
                { "name", "WebUI" },
                { "version", Version },
                { "protocol", Protocol },
                { "minProtocol", MinProtocol },
                { "capabilities", Capabilities() },
            };
        }
    }
}
