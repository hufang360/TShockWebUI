using System;
using System.Collections.Generic;
using System.Linq;
using Rests;
using Terraria;
using Terraria.ID;
using Terraria.Localization;
using TShockAPI;

namespace WebUI
{
    /// <summary>
    /// 只读信息接口：运行时指令目录、当前用户档案、补全数据源、服务器增强状态。
    ///
    /// 全部需要有效 token（<see cref="SecureRestCommand"/> 但不额外要求权限），
    /// 返回内容与玩家在游戏内能看到的相当，不做提权：
    ///   - 指令目录 = `/help` 能看到的东西；
    ///   - 区域 / 传送点按用户组权限过滤（缺权限返回空列表）；
    ///   - 用户档案只返回调用者自己的组与权限；
    ///   - 服务器状态是世界公开属性。
    /// </summary>
    internal static class Extras
    {
        // ---------- /webui/commands ----------

        /// <summary>
        /// 运行时指令目录（供网页端补全）。**按调用者用户组过滤**：
        /// 带权限的指令（如 <c>/web limit</c>）只有用户组真能跑才下发，
        /// 普通玩家拿不到（与 TShock <c>/help</c> 的可见性一致，对应 Command.CanRun）。
        /// </summary>
        public static object CommandsCatalog(SecureRest.TokenData token)
        {
            var group = string.IsNullOrEmpty(token.UserGroupName) ? null : TShock.Groups.GetGroupByName(token.UserGroupName);
            bool CanRun(Command cmd)
            {
                if (cmd.Permissions == null || cmd.Permissions.Count < 1) return true;
                if (group == null) return false;
                foreach (var permission in cmd.Permissions)
                    if (group.HasPermission(permission)) return true;
                return false;
            }

            var list = new List<Dictionary<string, object>>();
            foreach (var cmd in Commands.ChatCommands)
            {
                if (!CanRun(cmd)) continue;
                var item = new Dictionary<string, object>
                {
                    { "name", cmd.Name },
                    { "aliases", cmd.Names.Where(n => n != cmd.Name).ToList() },
                    { "permissions", cmd.Permissions != null ? new List<string>(cmd.Permissions) : new List<string>() },
                    { "allowServer", cmd.AllowServer },
                    { "help", cmd.HelpText ?? "" },
                };
                if (cmd.HelpDesc != null && cmd.HelpDesc.Length > 0)
                    item["helpDesc"] = cmd.HelpDesc.ToList();
                list.Add(item);
            }
            list.Sort((a, b) => string.CompareOrdinal((string)a["name"], (string)b["name"]));
            return new RestObject("200") { { "commands", list } };
        }

        // ---------- /webui/me ----------

        public static object Me(SecureRest.TokenData token)
        {
            var group = TShock.Groups.GetGroupByName(token.UserGroupName);
            var perms = group != null ? group.TotalPermissions : new List<string>();
            return new RestObject("200")
            {
                { "username", token.Username },
                { "group", token.UserGroupName },
                { "permissions", perms },
                { "canUseApi", group != null && group.HasPermission(RestPermissions.restapi) },
                { "canRunCommands", group != null && group.HasPermission(RestPermissions.restrawcommand) },
            };
        }

        // ---------- /webui/data?type= ----------

        public static object Data(RestRequestArgs args)
        {
            var type = (args.Parameters["type"] ?? "").Trim().ToLowerInvariant();
            var group = TShock.Groups.GetGroupByName(args.TokenData.UserGroupName);
            bool Has(string perm) => group != null && group.HasPermission(perm);

            switch (type)
            {
                case "regions":
                    if (!Has("tshock.region")) return Empty("regions");
                    return new RestObject("200")
                    {
                        { "regions", TShock.Regions.Regions
                            .Where(r => r.WorldID == Main.worldID.ToString())
                            .Select(r => r.Name)
                            .Where(n => !string.IsNullOrWhiteSpace(n))
                            .Distinct()
                            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                            .ToList() },
                    };

                case "warps":
                    if (!Has("tshock.warp")) return Empty("warps");
                    return new RestObject("200")
                    {
                        { "warps", TShock.Warps.Warps
                            .Where(w => !w.IsPrivate)
                            .Select(w => w.Name)
                            .Where(n => !string.IsNullOrWhiteSpace(n))
                            .Distinct()
                            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                            .ToList() },
                    };

                case "npcs":
                    var npcs = new List<Dictionary<string, object>>();
                    for (int i = 1; i < NPCID.Count; i++)
                    {
                        var name = Lang.GetNPCNameValue(i);
                        if (!string.IsNullOrWhiteSpace(name) && name != "Unnamed")
                            npcs.Add(new Dictionary<string, object> { { "id", i }, { "name", name } });
                    }
                    return new RestObject("200") { { "npcs", npcs } };

                case "buffs":
                    var buffs = new List<Dictionary<string, object>>();
                    for (int i = 1; i < BuffID.Count; i++)
                    {
                        var name = Lang.GetBuffName(i);
                        if (!string.IsNullOrWhiteSpace(name))
                            buffs.Add(new Dictionary<string, object> { { "id", i }, { "name", name } });
                    }
                    return new RestObject("200") { { "buffs", buffs } };

                default:
                    return new RestObject("400") { { "error", "未知 type（regions/warps/npcs/buffs）" } };
            }
        }

        private static RestObject Empty(string key)
        {
            // 缺权限：返回空列表而不是报错，前端表现为「没有候选」。
            return new RestObject("200") { { key, new List<string>() } };
        }

        // ---------- /webui/chat ----------

        /// <summary>单条网页发言的最大长度（与 EventLog.MaxTextLength 一致）。</summary>
        public const int MaxChatLength = 200;

        /// <summary>网页发言的默认前缀；实际用插件配置 <c>ChatPrefix</c>（留空时回退此值）。</summary>
        public const string DefaultChatPrefix = "[WebUI]";

        private static readonly object ChatLock = new object();
        private static readonly Dictionary<string, List<DateTime>> ChatTimes = new Dictionary<string, List<DateTime>>();

        /// <summary>
        /// 把网页端提交的文本广播到游戏内聊天。
        ///
        /// 不伪造身份：消息统一带 <see cref="ChatPrefix"/> 前缀，并标明「哪个账号说的」；
        /// 广播不走 <c>PlayerHooks.PlayerChat</c>（避免被当成真实玩家聊天重复采集），
        /// 而是手工以 <c>type=webui</c> 记入事件流，前端可与 <c>chat</c> 区分渲染。
        /// </summary>
        public static object SendChat(SecureRest.TokenData token, string raw)
        {
            if (Plugin.Config == null || !Plugin.Config.AllowWebChat)
                return new RestObject("403") { { "error", "服务器已关闭网页发言" } };

            var text = (raw ?? "").Trim();
            if (text.Length == 0)
                return new RestObject("400") { { "error", "发言内容不能为空" } };
            if (text.Length > MaxChatLength)
                return new RestObject("400") { { "error", $"单条最多 {MaxChatLength} 个字符" } };

            var account = token.Username ?? "";
            if (!AllowChatRate(account))
                return new RestObject("429") { { "error", "发言过于频繁，请稍后再试" } };

            // 不绕过 TShock 禁言：目标账号在线且处于 mute 状态时拒绝（离线无法判定，允许）。
            var online = FindOnlinePlayer(account);
            if (online != null && online.mute)
                return new RestObject("403") { { "error", "你已被禁言，无法发言" } };

            var name = online != null && !string.IsNullOrWhiteSpace(online.Name) ? online.Name : account;
            if (string.IsNullOrWhiteSpace(name)) name = "WebUI";
            var prefix = Plugin.Config?.ChatPrefix;
            if (string.IsNullOrWhiteSpace(prefix)) prefix = DefaultChatPrefix;
            var line = $"{prefix} {name}: {text}";
            var id = Guid.NewGuid().ToString("N").Substring(0, 12);
            var time = DateTime.UtcNow.ToString("o");

            // 切回主线程再广播，避免从 REST 线程写网络缓冲。
            Plugin.RunOnMainThread(() =>
            {
                try { TSPlayer.All.SendMessage(line, 135, 206, 250); }
                catch (Exception ex) { TShock.Log.ConsoleError("[WebUI] 发送网页发言失败：" + ex); }
            });
            // 统一为 type=chat + source=webui：前端只处理一种聊天类型，按来源区分渲染。
            EventLog.Add("chat", line, "webui");

            return new RestObject("200")
            {
                { "name", name },
                { "text", text },
                { "line", line },
                { "id", id },
                { "time", time },
                { "source", "webui" },
            };
        }

        /// <summary>取账号对应的在线玩家（用游戏内角色名），离线时返回 null。</summary>
        private static TSPlayer FindOnlinePlayer(string account)
        {
            if (string.IsNullOrWhiteSpace(account)) return null;
            foreach (var p in TShock.Players)
            {
                if (p != null && p.Active && p.Account != null &&
                    string.Equals(p.Account.Name, account, StringComparison.OrdinalIgnoreCase))
                    return p;
            }
            return null;
        }

        /// <summary>每账号每分钟发言上限（<c>MaxWebChatPerMinute</c>，0 = 不限）。</summary>
        private static bool AllowChatRate(string account)
        {
            var limit = Plugin.Config?.MaxWebChatPerMinute ?? 0;
            if (limit <= 0) return true;
            var key = string.IsNullOrEmpty(account) ? "?" : account;
            var now = DateTime.UtcNow;
            lock (ChatLock)
            {
                if (!ChatTimes.TryGetValue(key, out var times))
                    ChatTimes[key] = times = new List<DateTime>();
                times.RemoveAll(t => (now - t).TotalSeconds >= 60);
                if (times.Count >= limit) return false;
                times.Add(now);
                return true;
            }
        }

        // ---------- /webui/serverinfo ----------

        public static object ServerInfo()
        {
            int activePlayers = TShock.Players.Count(p => p != null && p.Active);
            int activeNpcs = Main.npc.Count(n => n != null && n.active);

            return new RestObject("200")
            {
                { "name", Main.worldName },
                { "worldId", Main.worldID },
                { "difficulty", Main.GameMode },       // 0 普通 / 1 专家 / 2 大师 / 3 旅行
                { "hardMode", Main.hardMode },
                { "dayTime", Main.dayTime },
                { "time", Main.time },                 // 0..54000（4:30 起算）
                { "bloodMoon", Main.bloodMoon },
                { "eclipse", Main.eclipse },
                { "invasionType", Main.invasionType }, // 0 无；>0 入侵类型
                { "invasionSize", Main.invasionSize },
                { "raining", Main.raining },
                { "slimeRain", Main.slimeRain },
                { "players", activePlayers },
                { "npcCount", activeNpcs },
                { "maxNpc", Main.maxNPCs },
                { "bosses", new Dictionary<string, bool>
                    {
                        { "kingSlime", NPC.downedSlimeKing },
                        { "eyeOfCthulhu", NPC.downedBoss1 },
                        { "eaterOfWorldsOrBrain", NPC.downedBoss2 },
                        { "skeletron", NPC.downedBoss3 },
                        { "queenBee", NPC.downedQueenBee },
                        { "wallOfFlesh", Main.hardMode },
                        { "destroyer", NPC.downedMechBoss1 },
                        { "twins", NPC.downedMechBoss2 },
                        { "skeletronPrime", NPC.downedMechBoss3 },
                        { "plantera", NPC.downedPlantBoss },
                        { "golem", NPC.downedGolemBoss },
                        { "dukeFishron", NPC.downedFishron },
                        { "empressOfLight", NPC.downedEmpressOfLight },
                        { "queenSlime", NPC.downedQueenSlime },
                        { "lunaticCultist", NPC.downedAncientCultist },
                        { "moonLord", NPC.downedMoonlord },
                        { "deerclops", NPC.downedDeerclops },
                    } },
            };
        }
    }
}
