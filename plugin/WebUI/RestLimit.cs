using System;
using Rests;
using TShockAPI;

namespace WebUI
{
    /// <summary>
    /// TShock 建令牌限流的只读快照。
    ///
    /// 背景：TShock 的 <c>/v2/token/create</c> 对「来源 IP」计数（<c>Rest.tokenBucket</c>，public），
    /// 达到 <c>RESTMaximumRequestsPerInterval</c> 后返回 403，且**与「密码错误 / 缺 useapi」同文案**
    /// （见 <c>SecureRest.cs:117-125</c>）。后端没法从 403 反推，只能问插件。
    ///
    /// 本端点由后端在密码登录前调用：桶已满就直接判「限流」，不必再打 TShock。
    /// 只返回**调用者自己 IP** 的计数，不暴露其它来源，也不需要 token。
    /// </summary>
    internal static class RestLimit
    {
        /// <summary>TShock 该字段的默认值（<c>TShockConfig.cs:650</c>）。</summary>
        internal const int DefaultLimit = 5;

        /// <summary>把 <c>unlimited</c> 映射到的上限：足够大，等价于不限。</summary>
        internal const int Unlimited = 1000000;

        public static RestObject Snapshot(string callerIp)
        {
            var settings = TShock.Config?.Settings;
            var limit = settings?.RESTMaximumRequestsPerInterval ?? 0;
            var interval = settings?.RESTRequestBucketDecreaseIntervalMinutes ?? 1;

            var bucket = 0;
            try
            {
                var table = TShock.RestApi?.tokenBucket;
                if (table != null && !string.IsNullOrEmpty(callerIp))
                    table.TryGetValue(callerIp, out bucket);
            }
            catch (Exception ex)
            {
                TShock.Log.ConsoleError("[WebUI] 读取 REST 限流桶失败：" + ex.Message);
            }

            return new RestObject("200")
            {
                { "code", "ok" },
                { "limit", limit },
                { "bucket", bucket },
                { "intervalMinutes", interval },
            };
        }
    }
}
