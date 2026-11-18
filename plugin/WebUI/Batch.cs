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
    ///     只在开启 Tier B（<c>AllowInGameOnlyCommands</c>）或指令在 <c>InGameOnlyAllowlist</c> 内时可用，
    ///     且要求该玩家在线。
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
            // 空名单 + 总开关关 = 一条也不放行。
            var all = Plugin.Config != null && Plugin.Config.AllowInGameOnlyCommands;
            var allowlist = NormalizeAllowlist(Plugin.Config == null ? null : Plugin.Config.InGameOnlyAllowlist);
            if (!all && allowlist.Count == 0)
                return new RestObject("200") { { "code", "disabled" }, { "error", "服务器未开启「游戏内指令」执行" } };

            var online = TShock.Players.FirstOrDefault(p =>
                p != null && p.Active && p.Account != null &&
                string.Equals(p.Account.Name, token.Username, StringComparison.OrdinalIgnoreCase));
            if (online == null)
                return new RestObject("200") { { "code", "player_offline" }, { "error", "该玩家不在线，无法执行仅限游戏内的指令" } };

            var results = new List<Dictionary<string, object>>(cmds.Count);
            foreach (var raw in cmds)
            {
                // 名单校验在**执行前**：即使总开关开了，也只放行名单内的（名单空则不额外限制）。
                if (!all && !IsAllowed(CommandName(raw), allowlist))
                {
                    results.Add(new Dictionary<string, object>
                    {
                        { "cmd", raw },
                        { "output", new List<string> { "该指令不在服务器放行的游戏内指令名单中" } },
                    });
                    continue;
                }

                // 每次新建，避免上一条指令的输出/状态串到下一条。
                var executor = new PlayerExecutor(online.Index, group);
                Execute(executor, raw);
                // spawnboss / spawnmob 这类指令把提示广播给全服（TSPlayer.All），执行者收不到文字；
                // 补一句说明，免得网页上看起来像“什么也没发生”。
                if (executor.Output.Count == 0)
                    executor.Output.Add("已执行；该指令的提示已广播到游戏内聊天");
                results.Add(new Dictionary<string, object> { { "cmd", raw }, { "output", executor.Output } });
            }
            return new RestObject("200") { { "results", results } };
        }

        /// <summary>名单归一：去空白 / 前导斜杠、转小写。</summary>
        private static HashSet<string> NormalizeAllowlist(List<string> names)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (names == null) return set;
            foreach (var name in names)
            {
                var v = (name ?? "").Trim().TrimStart('/', '.');
                if (v.Length > 0) set.Add(v);
            }
            return set;
        }

        /// <summary>取出指令的第一个 token（不含前缀 / 参数，转小写——TShock 的指令名 / 别名都是小写）。</summary>
        private static string CommandName(string raw)
        {
            var text = (raw ?? "").Trim().TrimStart('/', '.');
            var idx = text.IndexOfAny(new[] { ' ', '\t' });
            return (idx < 0 ? text : text.Substring(0, idx)).ToLowerInvariant();
        }

        /// <summary>名单是否命中：输入可能是别名，先用 TShock 的指令目录归一成规范名再比。</summary>
        private static bool IsAllowed(string name, HashSet<string> allowlist)
        {
            if (allowlist.Count == 0 || string.IsNullOrEmpty(name)) return false;
            if (allowlist.Contains(name)) return true;
            var cmd = Commands.ChatCommands.FirstOrDefault(c => c.HasAlias(name));
            return cmd != null && cmd.Names.Any(n => allowlist.Contains(n));
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
