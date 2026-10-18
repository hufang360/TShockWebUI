using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Rests;

namespace WebUI
{
    /// <summary>
    /// 供 Go 后端调用的 REST 端点。
    ///
    /// <c>/webui/auth/*</c> 使用普通 <see cref="RestCommand"/>（不需要 token），
    /// 因为调用方在登录前还没有 token；真正的安全边界是「在线玩家在游戏内确认」，
    /// 另外可用共享 Secret 限制调用来源。
    ///
    /// <c>/webui/batch</c> 使用 <see cref="SecureRestCommand"/>，需要调用者自己的 REST token
    /// （与 rawcmd 相同），以用户本人在 TShock 中的权限逐条执行。
    ///
    /// 约定：<c>/webui/auth/*</c> 的业务状态一律放在 JSON 的 <c>code</c> 字段，HTTP 状态保持 200；
    /// <c>/webui/batch</c> 则沿用 TShock 的 401/403 语义（它需要 token）。
    /// </summary>
    internal static class WebAuthRest
    {
        public static object Request(RestRequestArgs args)
        {
            if (!CheckSecret(args, out var forbidden)) return forbidden;
            return Plugin.Store.Begin(args.Parameters["name"], args.Parameters["ip"]);
        }

        public static object Poll(RestRequestArgs args)
        {
            if (!CheckSecret(args, out var forbidden)) return forbidden;
            var wait = 0;
            int.TryParse(args.Parameters["wait"] ?? "", out wait);
            if (wait < 0) wait = 0;
            if (wait > 25) wait = 25; // 长轮询上限：别把 REST 线程占太久
            return Plugin.Store.Poll(args.Parameters["ticket"], wait);
        }

        public static object Cancel(RestRequestArgs args)
        {
            if (!CheckSecret(args, out var forbidden)) return forbidden;
            return Plugin.Store.Cancel(args.Parameters["ticket"]);
        }

        /// <summary>
        /// TShock 建令牌限流的只读快照（调用者自己 IP）。后端在密码登录前调用：
        /// 桶满就可直接判「限流」，避免 TShock 那句与「密码错」相同的 403（见 <see cref="RestLimit"/>）。
        /// </summary>
        public static object RateLimit(RestRequestArgs args)
        {
            if (!CheckSecret(args, out var forbidden)) return forbidden;
            return RestLimit.Snapshot(CallerIp(args));
        }

        /// <summary>
        /// 协议握手：版本号 + 协议号 + 能力清单。供后端判断插件是否安装 / 版本是否兼容 / 某能力是否可用。
        /// 不需要 token（登录前就要能探测），需要 secret 时同样校验。
        /// </summary>
        public static object Meta(RestRequestArgs args)
        {
            if (!CheckSecret(args, out var forbidden)) return forbidden;
            return WebUI.Meta.Describe();
        }

        /// <summary>
        /// 取调用方的来源 IP（= TShock 限流桶的 key）。
        /// 用反射读 <c>RestRequestArgs.Context.RemoteEndPoint.Address</c>：
        /// 这两个类型来自 TShock 附带的 HttpServer.dll，插件没有引用该程序集，
        /// 为了不与 TShock 包版本耦合，这里不在编译期引用它们。
        /// </summary>
        private static string CallerIp(RestRequestArgs args)
        {
            try
            {
                var ctx = args.GetType().GetProperty("Context")?.GetValue(args);
                if (ctx == null) return "";
                var endpoint = ctx.GetType().GetProperty("RemoteEndPoint")?.GetValue(ctx);
                if (endpoint == null) return "";
                var address = endpoint.GetType().GetProperty("Address")?.GetValue(endpoint);
                return address?.ToString() ?? "";
            }
            catch
            {
                return "";
            }
        }

        /// <summary>批量执行：需要有效 token（SecureRestCommand 已校验）。</summary>
        public static object Batch(RestRequestArgs args)
        {
            var raw = args.Parameters["cmds"];
            if (string.IsNullOrWhiteSpace(raw))
                return new RestObject("400") { { "error", "缺少 cmds 参数" } };

            List<string> cmds;
            try
            {
                cmds = JsonConvert.DeserializeObject<List<string>>(raw);
            }
            catch
            {
                return new RestObject("400") { { "error", "cmds 不是合法的 JSON 数组" } };
            }
            if (cmds == null) cmds = new List<string>();
            if (cmds.Count > BatchExecutor.MaxCommands)
                return new RestObject("400") { { "error", $"一次最多执行 {BatchExecutor.MaxCommands} 条指令" } };

            var mode = (args.Parameters["mode"] ?? "server").Trim().ToLowerInvariant();
            return BatchExecutor.Run(args.TokenData, cmds, mode);
        }

        // ---------- 只读信息 / 会话管理（SecureRestCommand，任意有效 token） ----------

        public static object Commands(RestRequestArgs args) => Extras.CommandsCatalog(args.TokenData);

        public static object Me(RestRequestArgs args) => Extras.Me(args.TokenData);

        public static object Data(RestRequestArgs args) => Extras.Data(args);

        public static object ServerInfo(RestRequestArgs args) => Extras.ServerInfo();

        public static object Events(RestRequestArgs args)
        {
            // tail=N：取最新 N 条（升序），用于「打开网页先看最近 N 条」。
            var tailRaw = (args.Parameters["tail"] ?? "").Trim();
            if (tailRaw.Length > 0)
            {
                int tail;
                int.TryParse(tailRaw, out tail);
                return EventLog.Tail(tail);
            }
            long since = 0;
            long.TryParse(args.Parameters["since"] ?? "", out since);
            var limit = 0;
            int.TryParse(args.Parameters["limit"] ?? "", out limit);
            return EventLog.Since(since, limit);
        }

        /// <summary>网页发言：任意有效 token；带 [WebUI] 前缀广播，并记入事件流（type=webui）。</summary>
        public static object Chat(RestRequestArgs args) => Extras.SendChat(args.TokenData, args.Parameters["text"]);

        public static object Sessions(RestRequestArgs args)
        {
            var list = Plugin.Sessions?.ListFor(args.TokenData.Username, args.Parameters["token"]) ?? new List<Dictionary<string, object>>();
            return new RestObject("200") { { "sessions", list } };
        }

        public static object Revoke(RestRequestArgs args)
        {
            var id = (args.Parameters["id"] ?? "").Trim();
            var all = string.Equals(args.Parameters["all"] ?? "", "true", StringComparison.OrdinalIgnoreCase)
                      || args.Parameters["all"] == "1";
            if (!all && id.Length == 0)
                return new RestObject("400") { { "error", "缺少 id 或 all=true" } };
            var n = Plugin.Sessions?.Revoke(args.TokenData.Username, id, all, args.Parameters["token"]) ?? 0;
            return new RestObject("200") { { "revoked", n } };
        }

        private static bool CheckSecret(RestRequestArgs args, out object forbidden)
        {
            forbidden = null;
            var secret = Plugin.Config?.Secret ?? "";
            if (secret.Length == 0) return true;

            if (string.Equals(args.Parameters["secret"] ?? "", secret, System.StringComparison.Ordinal))
                return true;

            forbidden = new RestObject("403") { { "code", "forbidden" }, { "error", "secret 不匹配" } };
            return false;
        }
    }
}
