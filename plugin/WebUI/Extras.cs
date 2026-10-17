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
        /// 带权限的指令（如高级指令 <c>/weblimit</c>）只有用户组真能跑才下发，
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
