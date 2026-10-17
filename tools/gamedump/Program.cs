// GameDump —— 从 Terraria(TShock OTAPI) 运行时导出「合成表 + 物品属性」原始数据。
//
// 用法：GameDump <TR_SRC> <RECIPES_OUT.json> <ITEMS_OUT.json>
//
// 原理：初始化最小静态环境后直接调用游戏自身的 Terraria.Recipe.SetupRecipes()
//       与 Item.SetDefaults()，避免手工解析 C# 源码带来的偏差。
//       为什么不直接调用游戏的 tooltip 构建函数：它依赖语言包与玩家/NPC 状态，
//       因此在 Node 侧按 Main.MouseText_DrawItemTooltip_GetLinesInfo 的规则重排。
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Terraria;
using Terraria.ID;

internal static class Program
{
    private static void Main(string[] args)
    {
        var trSrc = args.Length > 0 ? args[0] : Environment.GetEnvironmentVariable("TR_SRC") ?? "";
        var recipesOut = args.Length > 1 ? args[1] : "/tmp/recipes-raw.json";
        var itemsOut = args.Length > 2 ? args[2] : "/tmp/items-raw.json";
        var groupsOut = args.Length > 3 ? args[3] : "/tmp/item-groups-raw.json";
        var prefixSetsOut = args.Length > 4 ? args[4] : "/tmp/prefix-sets-raw.json";

        Bootstrap();

        // 1) 配方组（从 Recipe.cs 源码解析后注册，绕过 Lang 初始化）
        var groups = ParseGroups(Path.Combine(trSrc, "Terraria", "Recipe.cs"));
        var ggType = typeof(Terraria.ID.RecipeGroups);
        foreach (var g in groups)
        {
            var rg = new RecipeGroup(() => g.Name, g.Items.ToArray()).Register();
            var f = ggType.GetField(g.Name, BindingFlags.Public | BindingFlags.Static);
            if (f != null) f.SetValue(null, rg);
        }

        // 2) ContentSamples.ItemsByType：SortDecraftingEntries 需要
        for (int i = 0; i < ItemID.Count; i++)
        {
            var it = new Item();
            try { it.SetDefaults(i); } catch { }
            Terraria.ID.ContentSamples.ItemsByType[i] = it;
        }

        // 3) 跑游戏自己的配方构建
        Recipe.SetupRecipes();

        // 4) 物品 -> 放置物 映射
        var itemTile = new Dictionary<int, int>();
        var itemWall = new Dictionary<int, int>();
        var tileToItems = new Dictionary<int, List<int>>();
        for (int i = 1; i < ItemID.Count; i++)
        {
            var it = new Item();
            try { it.SetDefaults(i); } catch { }
            itemTile[i] = it.createTile;
            itemWall[i] = it.createWall;
            if (it.createTile >= 0)
            {
                if (!tileToItems.TryGetValue(it.createTile, out var lst)) tileToItems[it.createTile] = lst = new List<int>();
                lst.Add(i);
            }
        }

        DumpRecipes(recipesOut, groups, itemTile, itemWall, tileToItems);
        DumpItems(itemsOut);
        DumpItemGroups(groupsOut);
        DumpPrefixSets(prefixSetsOut);
    }

    // ── 可滚词缀集合 ────────────────────────────────────
    // 直接调用游戏自身的 Item.GetRollablePrefixes()（武器/饰品各不相同），
    // 把相同的数组去重成 sets，每条物品记一个下标（-1 = 不可上词缀，如盔甲）。
    private static void DumpPrefixSets(string outPath)
    {
        var sets = new List<int[]>();
        var index = new Dictionary<string, int>();
        var items = new Dictionary<int, int>();
        for (int type = 1; type < ItemID.Count; type++)
        {
            var it = new Item();
            try { it.SetDefaults(type); } catch { }
            int[] rollable = null;
            try { rollable = it.GetRollablePrefixes(); } catch { }
            if (rollable == null || rollable.Length == 0) continue;
            var key = string.Join(",", rollable);
            if (!index.TryGetValue(key, out var idx))
            {
                idx = sets.Count;
                sets.Add(rollable);
                index[key] = idx;
            }
            items[type] = idx;
        }
        var payload = new { gameVersion = AssemblyVersion(), setCount = sets.Count, itemCount = items.Count, sets, items };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[prefix-sets] {items.Count} items, {sets.Count} sets -> {outPath}");
    }

    private static void Bootstrap()
    {
        Terraria.Program.SavePath = Path.Combine(Path.GetTempPath(), "gamedump-save");
        Directory.CreateDirectory(Terraria.Program.SavePath);
        if (Terraria.Main.rand == null) Terraria.Main.rand = new Terraria.Utilities.UnifiedRandom();
        if (Terraria.Main.player == null) Terraria.Main.player = new Terraria.Player[1];
        if (Terraria.Main.player[0] == null) Terraria.Main.player[0] = new Terraria.Player();
        Terraria.Main.recipe = new Recipe[Recipe.maxRecipes];
        for (int i = 0; i < Recipe.maxRecipes; i++) Terraria.Main.recipe[i] = new Recipe();
    }

    // ── 配方 ────────────────────────────────────────────────
    private static void DumpRecipes(string outPath, List<GroupDef> groups,
        Dictionary<int, int> itemTile, Dictionary<int, int> itemWall, Dictionary<int, List<int>> tileToItems)
    {
        var recipes = new List<object>();
        for (int i = 0; i < Recipe.numRecipes; i++)
        {
            var r = Terraria.Main.recipe[i];
            if (r == null || r.createItem.type == 0) continue;
            var req = new List<object>();
            for (int j = 0; j < Recipe.maxRequirements; j++)
            {
                var it = r.requiredItem[j];
                if (it == null || it.type == 0 || it.stack <= 0) break;
                req.Add(new { id = it.type, stack = it.stack, group = GroupId(r, it.type) });
            }
            var stations = r.requiredTile >= 0 && tileToItems.TryGetValue(r.requiredTile, out var st) ? st.ToArray() : Array.Empty<int>();
            var shimmer = new List<object>();
            if (r.customShimmerResults != null)
                foreach (var s in r.customShimmerResults) shimmer.Add(new { id = s.type, stack = s.stack });
            recipes.Add(new
            {
                create = new { id = r.createItem.type, stack = r.createItem.stack, tile = r.createItem.createTile, wall = r.createItem.createWall },
                req,
                tile = r.requiredTile,
                stations,
                needHoney = r.needHoney, needWater = r.needWater, needLava = r.needLava,
                needSnow = r.needSnowBiome, needGraveyard = r.needGraveyardBiome,
                needTorchGodsFavor = r.needTorchGodsFavor, needMechdusa = r.needMechdusa,
                crimson = r.crimson, corruption = r.corruption, notDecraftable = r.notDecraftable,
                shimmer,
            });
        }
        var payload = new
        {
            gameVersion = AssemblyVersion(),
            itemCount = ItemID.Count,
            recipeCount = recipes.Count,
            groups = groups.Select(g => new { g.Name, g.Key, g.Items }).ToArray(),
            itemTile,
            itemWall,
            recipes,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[recipes] version={payload.gameVersion} items={payload.itemCount} recipes={payload.recipeCount} groups={groups.Count}");
    }

    // ── 物品属性 ─────────────────────────────────────────────
    private static void DumpItems(string outPath)
    {
        // 钩爪：与 Main.cs 初始化一致（projectile.aiStyle == 7）
        var projHook = new bool[ProjectileID.Count];
        for (int i = 1; i < ProjectileID.Count; i++)
        {
            try { var p = new Projectile(); p.SetDefaults(i); if (p.aiStyle == 7) projHook[i] = true; } catch { }
        }

        var items = new Dictionary<int, object>();
        // 微光转换：源物品 → 目标物品（-1 = 无）。
        var shimmerTo = ItemID.Sets.ShimmerTransformToItem;
        for (int type = 1; type < ItemID.Count; type++)
        {
            var it = new Item();
            try { it.SetDefaults(type); } catch { }

            bool wireable = it.createTile > -1 &&
                (TileID.Sets.Wiring.IsATrigger[it.createTile] || TileID.Sets.Wiring.IsAMechanism[it.createTile]) &
                (it.createTile != 105 || ItemID.Sets.IsWireableStatue[it.type]);
            bool whip = it.shoot >= 0 && it.shoot < ProjectileID.Sets.IsAWhip.Length && ProjectileID.Sets.IsAWhip[it.shoot];
            bool hook = it.shoot >= 0 && it.shoot < projHook.Length && projHook[it.shoot];

            string key = null;
            try { key = ItemID.Search.GetName(type); } catch { }
            items[type] = new
            {
                key,
                damage = it.damage,
                crit = it.crit,
                knockBack = it.knockBack,
                useAnimation = it.useAnimation,
                useStyle = it.useStyle,
                autoReuse = it.autoReuse,
                melee = it.melee, ranged = it.ranged, magic = it.magic, summon = it.summon, sentry = it.sentry,
                noMelee = it.noMelee,
                defense = it.defense,
                pick = it.pick, axe = it.axe, hammer = it.hammer, tileBoost = it.tileBoost,
                fishingPole = it.fishingPole, bait = it.bait,
                mana = it.mana, healLife = it.healLife, healMana = it.healMana, lifeRegen = it.lifeRegen, manaIncrease = it.manaIncrease,
                buffType = it.buffType, buffTime = it.buffTime, mountType = it.mountType,
                mountCart = it.mountType > 0 && it.mountType < MountID.Sets.Cart.Length && MountID.Sets.Cart[it.mountType],
                rare = it.rare, value = it.value,
                ammo = it.ammo, useAmmo = it.useAmmo, notAmmo = it.notAmmo,
                consumable = it.consumable, chlorophyteExtractinatorConsumable = it.chlorophyteExtractinatorConsumable,
                material = it.material, accessory = it.accessory, vanity = it.vanity, social = it.social,
                hasVanityEffects = it.hasVanityEffects, questItem = it.questItem, expert = it.expert, expertOnly = it.expertOnly,
                createTile = it.createTile, createWall = it.createWall, placeStyle = it.placeStyle,
                placeTileOnAltUse = type < ItemID.Sets.PlaceTileOnAltUse.Length && ItemID.Sets.PlaceTileOnAltUse[type],
                shoot = it.shoot, shootSpeed = it.shootSpeed,
                shimmerTo = type < shimmerTo.Length ? shimmerTo[type] : -1,
                headSlot = it.headSlot, bodySlot = it.bodySlot, legSlot = it.legSlot,
                tileWand = it.tileWand,
                tooltipDamageMultiplier = type < ItemID.Sets.ToolTipDamageMultiplier.Length ? ItemID.Sets.ToolTipDamageMultiplier[type] : 1f,
                wireable, whip, hook,
                container = it.createTile == 21 || it.createTile == 467,
                wireTrigger = it.createTile == 441 || it.createTile == 468,
            };
        }
        var payload = new { gameVersion = AssemblyVersion(), itemCount = items.Count, items };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[items] count={items.Count}");
    }

    // ── 创意菜单的分组 / 页签 ─────────────────────────────────
    // 导入游戏自身的分组：
    //   ContentSamples.CreativeHelper.GetItemGroup（ItemGroup 枚举 + 组内顺序）
    //   ContentSamples.ItemCreativeSortingId（ByCreativeSortingId 排序用）
    // 以及创意菜单真实的分类页签（ItemFilters，与 UICreativeInfiniteItemsDisplay 同一套过滤器）。
    private static void DumpItemGroups(string outPath)
    {
        // 物块 / 家具的划分依赖 Main.tileSolid / tileFrameImportant，先补上（见下）。
        TryInitTileData();

        // 让游戏把每个物品归组并算好组内顺序（ItemCreativeSortingId 即由它填充）
        Terraria.ID.ContentSamples.CreativeHelper.SetCreativeMenuOrder();

        // 与 UICreativeInfiniteItemsDisplay 完全相同的页签顺序
        var baseFilters = new List<Terraria.GameContent.Creative.IItemEntryFilter>
        {
            new Terraria.GameContent.Creative.ItemFilters.Weapon(),
            new Terraria.GameContent.Creative.ItemFilters.Armor(),
            new Terraria.GameContent.Creative.ItemFilters.Vanity(),
            new Terraria.GameContent.Creative.ItemFilters.BuildingBlock(),
            new Terraria.GameContent.Creative.ItemFilters.Furniture(),
            new Terraria.GameContent.Creative.ItemFilters.Accessories(),
            new Terraria.GameContent.Creative.ItemFilters.MiscAccessories(),
            new Terraria.GameContent.Creative.ItemFilters.Consumables(),
            new Terraria.GameContent.Creative.ItemFilters.Tools(),
            new Terraria.GameContent.Creative.ItemFilters.Materials(),
        };
        var allFilters = new List<Terraria.GameContent.Creative.IItemEntryFilter>(baseFilters);
        allFilters.Add(new Terraria.GameContent.Creative.ItemFilters.MiscFallback(baseFilters));

        var tabs = new List<object>();
        foreach (var f in allFilters) tabs.Add(new { key = f.GetDisplayNameKey() });

        var items = new Dictionary<int, object>();
        for (int type = 1; type < ItemID.Count; type++)
        {
            var it = new Item();
            try { it.SetDefaults(type); } catch { }
            var group = Terraria.ID.ContentSamples.CreativeHelper.GetItemGroup(it, out int order);
            var fits = new List<int>();
            for (int i = 0; i < allFilters.Count; i++)
                if (allFilters[i].FitsFilter(it)) fits.Add(i);
            items[type] = new { g = group.ToString(), gv = (int)group, o = order, t = fits };
        }

        var payload = new
        {
            gameVersion = AssemblyVersion(),
            itemCount = items.Count,
            tabs,
            items,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[groups] items={items.Count} tabs={tabs.Count} -> {outPath}");
    }

    // 创意菜单分组 / 页签依赖 Main.tileSolid / tileFrameImportant（物块、家具的划分）。
    // 反编译源码里这两个数组由 Main.Initialize_TileAndNPCData1/2 填充，
    // 必须在最小环境下按顺序（Data1 → Data2）先行调用，否则物块/家具会全部归错。
    private static void TryInitTileData()
    {
        foreach (var name in new[] { "Initialize_TileAndNPCData1", "Initialize_TileAndNPCData2" })
        {
            var mi = typeof(Main).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Static);
            if (mi == null)
            {
                Console.WriteLine($"[groups] 警告：找不到 {name}，物块/家具分组可能不准确");
                continue;
            }
            try { mi.Invoke(null, null); }
            catch (Exception e)
            {
                Console.WriteLine($"[groups] 警告：{name} 调用失败：{e.InnerException?.Message ?? e.Message}");
            }
        }
        if (!Terraria.Main.tileSolid.Any(x => x) || !Terraria.Main.tileFrameImportant.Any(x => x))
            Console.WriteLine("[groups] 警告：tileSolid/tileFrameImportant 仍为空，物块/家具分组可能不准确");
    }

    private static string AssemblyVersion()
    {
        try { return typeof(Item).Assembly.GetName().Version.ToString(); } catch { return "unknown"; }
    }

    private static int? GroupId(Recipe r, int type)
    {
        foreach (var gid in r.acceptedGroups)
        {
            if (gid < 0) break;
            var g = RecipeGroup.recipeGroups[gid];
            if (g.ValidItems.Contains(type)) return gid;
        }
        return null;
    }

    private sealed class GroupDef { public string Name; public string Key; public List<int> Items = new List<int>(); }

    private static List<GroupDef> ParseGroups(string recipeCsPath)
    {
        var list = new List<GroupDef>();
        if (!File.Exists(recipeCsPath)) return list;
        var text = File.ReadAllText(recipeCsPath);
        var re = new Regex("RecipeGroups\\.(\\w+)\\s*=\\s*new RecipeGroup\\(\\s*(?:\"([^\"]*)\"|Lang\\.misc\\[(\\d+)\\]\\.Key|Lang\\.GetNPCNameValue\\((\\d+)\\))([^;]*?)\\)\\s*\\.Register\\(\\);");
        foreach (Match m in re.Matches(text))
        {
            var g = new GroupDef { Name = m.Groups[1].Value };
            g.Key = m.Groups[2].Success ? m.Groups[2].Value
                  : m.Groups[3].Success ? "Lang.misc[" + m.Groups[3].Value + "]"
                  : "NPCName(" + m.Groups[4].Value + ")";
            foreach (Match n in Regex.Matches(m.Groups[5].Value, "\\d+")) g.Items.Add(int.Parse(n.Value));
            list.Add(g);
        }
        return list;
    }
}
