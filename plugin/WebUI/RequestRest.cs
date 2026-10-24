using System;
using Rests;

namespace WebUI
{
    /// <summary>
    /// 物资申请的 REST 端点（玩家 / 服主网页审核）。
    ///
    /// 全部使用 <see cref="SecureRestCommand"/>：调用方必须持有有效 token，
    /// 身份只取 <see cref="SecureRest.TokenData.Username"/>，不信任任何前端传名。
    /// 提交需要 <c>webui.request.use</c>；审核 / 补发需要 <c>webui.request.review</c>。
    /// </summary>
    internal static class RequestRest
    {
        /// <summary>GET /webui/requests?status=：我的申请。</summary>
        public static object ListMine(RestRequestArgs args)
        {
            return RequisitionStore.ListMine(args.TokenData, args.Parameters["status"]);
        }

        /// <summary>GET /webui/requests/create?items=&amp;reason=&amp;note=：提交申请。</summary>
        public static object Create(RestRequestArgs args)
        {
            return RequisitionStore.Create(
                args.TokenData,
                args.Parameters["items"],
                args.Parameters["reason"],
                args.Parameters["note"]);
        }

        /// <summary>GET /webui/requests/cancel?id=：撤回自己的待审申请。</summary>
        public static object Cancel(RestRequestArgs args)
        {
            return RequisitionStore.Cancel(args.TokenData, ParseId(args.Parameters["id"]));
        }

        /// <summary>GET /webui/requests/all?status=：审核列表。</summary>
        public static object ListAll(RestRequestArgs args)
        {
            return RequisitionStore.ListAll(args.Parameters["status"]);
        }

        /// <summary>GET /webui/requests/review?id=&amp;decision=approve|deny&amp;reason=：审核。</summary>
        public static object Review(RestRequestArgs args)
        {
            return RequisitionStore.Review(
                args.TokenData,
                ParseId(args.Parameters["id"]),
                args.Parameters["decision"],
                args.Parameters["reason"],
                false);
        }

        /// <summary>GET /webui/requests/deliver?id=：补发已批准未发放的申请。</summary>
        public static object Deliver(RestRequestArgs args)
        {
            return RequisitionStore.Deliver(args.TokenData, ParseId(args.Parameters["id"]), false);
        }

        private static int ParseId(string raw)
        {
            int id;
            int.TryParse((raw ?? "").Trim(), out id);
            return id;
        }
    }
}
