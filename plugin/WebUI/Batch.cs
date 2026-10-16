using System;
using System.Collections.Generic;
using System.Linq;
using Rests;
using TShockAPI;

namespace WebUI
{
    /// <summary>
    /// 批量执行指令。
    ///
    /// 两种模式：
    ///   - <c>server</c>（默认）：为每条指令新建一个 <see cref="TSRestPlayer"/>（用户组取自 token），
    ///     与 <c>/v3/server/rawcmd</c> 完全同构；`AllowServer=false` 会被 TShock 拒绝。
    ///   - <c>player</c>：用**真实在线玩家**身份（<see cref="PlayerExecutor"/>）执行，
    ///     因此 <c>AllowServer=false</c> 的指令也能跑；权限仍是 token 所属组，不多一分。
    ///     仅在配置 <c>AllowInGameOnlyCommands=true</c> 时可用，且要求该玩家在线。
    ///
    /// 端点本身由 <see cref="SecureRestCommand"/> 要求 `tshock.rest.command` 权限。
    /// </summary>
    internal static class BatchExecutor
    {
        /// <summary>一次请求最多执行的指令数，防止滥用。</summary>
        public const int MaxCommands = 64;

        public static object Run(SecureRest.TokenData token, List<string> cmds, string mode)
        {
            var group = TShock.Groups.GetGroupByName(token.UserGroupName);
            if (group == null)
                return new RestObject("403") { { "code", "no_permission" }, { "error", "用户组不存在" } };

            if (string.Equals(mode, "player", StringComparison.OrdinalIgnoreCase))
                return RunAsPlayer(token, group, cmds);

            return RunAsServer(token, group, cmds);
        }

        private static object RunAsServer(SecureRest.TokenData token, Group group, List<string> cmds)
        {
            var results = new List<Dictionary<string, object>>(cmds.Count);
            foreach (var raw in cmds)
            {
                var player = new TSRestPlayer(token.Username, group);
                Execute(player, raw);
                results.Add(new Dictionary<string, object> { { "cmd", raw }, { "output", player.GetCommandOutput() } });
            }
            return new RestObject("200") { { "results", results } };
        }

        private static object RunAsPlayer(SecureRest.TokenData token, Group group, List<string> cmds)
        {
            if (Plugin.Config == null || !Plugin.Config.AllowInGameOnlyCommands)
                return new RestObject("200") { { "code", "disabled" }, { "error", "服务器未开启「游戏内指令」执行" } };

            var online = TShock.Players.FirstOrDefault(p =>
                p != null && p.Active && p.Account != null &&
                string.Equals(p.Account.Name, token.Username, StringComparison.OrdinalIgnoreCase));
            if (online == null)
                return new RestObject("200") { { "code", "player_offline" }, { "error", "该玩家不在线，无法执行仅限游戏内的指令" } };

            var results = new List<Dictionary<string, object>>(cmds.Count);
            foreach (var raw in cmds)
            {
                // 每次新建，避免上一条指令的输出/状态串到下一条。
                var executor = new PlayerExecutor(online.Index, group);
                Execute(executor, raw);
                results.Add(new Dictionary<string, object> { { "cmd", raw }, { "output", executor.Output } });
            }
            return new RestObject("200") { { "results", results } };
        }

        private static void Execute(TSPlayer player, string raw)
        {
            var text = (raw ?? "").Trim();
            try
            {
                if (text.Length == 0 || !text.StartsWith("/"))
                    player.SendErrorMessage("无效指令：" + raw);
                else
                    Commands.HandleCommand(player, text);
            }
            catch (Exception ex)
            {
                player.SendErrorMessage("执行异常：" + ex.Message);
            }
        }
    }
}
