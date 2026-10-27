// GameDump —— 从 Terraria(TShock OTAPI) 运行时导出「合成表 + 物品属性」原始数据。
//
// 用法：GameDump <TR_SRC> <RECIPES_OUT.json> <ITEMS_OUT.json> [...]
//       GameDump --tile-styles <TILE_STYLES_OUT.json>   // 只导出图格样式（子 ID）
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
        // 轻量模式：只导出「图格样式（子 ID）」。
        //   dotnet GameDump.dll --tile-styles /tmp/tile-styles.json
        if (args.Length > 0 && args[0] == "--tile-styles")
        {
            Bootstrap();
            DumpTileStyles(args.Length > 1 ? args[1] : "/tmp/tile-styles.json");
            return;
        }

        // 轻量模式：导出「每件物品的 maxStack + 不允许出现在背包里的物品」。
        //   dotnet GameDump.dll --item-limits /tmp/item-limits.json
        // 用途：`.plr` 编辑器的数量校验 —— 游戏加载存档时 `Item.FixAgainstExploit()`
        // 会把超限数量截到 maxStack、把 ItemsThatShouldNotBeInInventory 直接变空气。
        if (args.Length > 0 && args[0] == "--item-limits")
        {
            Bootstrap();
            DumpItemLimits(args.Length > 1 ? args[1] : "/tmp/item-limits.json");
            return;
        }

        var trSrc = args.Length > 0 ? args[0] : Environment.GetEnvironmentVariable("TR_SRC") ?? "";
        var recipesOut = args.Length > 1 ? args[1] : "/tmp/recipes-raw.json";
        var itemsOut = args.Length > 2 ? args[2] : "/tmp/items-raw.json";
        var groupsOut = args.Length > 3 ? args[3] : "/tmp/item-groups-raw.json";
        var prefixSetsOut = args.Length > 4 ? args[4] : "/tmp/prefix-sets-raw.json";
        var dropsOut = args.Length > 5 ? args[5] : "/tmp/item-drops-raw.json";

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

        // 3.5) 图格摆放尺寸（家具 / 多格）。
        var tileDims = DumpTileDims(out var tileFrameImportant);

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

        DumpRecipes(recipesOut, groups, itemTile, itemWall, tileToItems, tileDims, tileFrameImportant);
        DumpItems(itemsOut);
        DumpItemGroups(groupsOut);
        DumpPrefixSets(prefixSetsOut);
        DumpItemDrops(dropsOut);
    }

    // ── 可开启物品的掉落（木匣等）─────────────────────────
    // 木匣 / 宝藏袋的掉落是 Player.OpenFishingCrate / OpenBossBag 里的**命令式 switch**，
    // 没有数据表可读；这里用**运行时模拟**（Monte Carlo）测出「物品 / 数量范围 / 概率」。
    // 概率是实测值（meta.trials 次），不是源码里的精确分数——UI 会标注来源。
    private static void DumpItemDrops(string outPath)
    {
        const int trials = 1000000;
        // 只做木匣（fishing crate）：掉落与专家/大师无关，只受 IsFishingCrateHardmode 影响。
        var crates = new List<int>();
        for (int i = 1; i < ItemID.Count; i++) if (ItemID.Sets.IsFishingCrate[i]) crates.Add(i);

        var player = new Player();
        var result = new Dictionary<int, object>();
        foreach (int crate in crates)
        {
            // 固定种子：可重复生成（不同 crate 用同一序列也无所谓，互不相关）。
            Terraria.Main.rand = new Terraria.Utilities.UnifiedRandom(19880617);
            var hit = new Dictionary<int, int>();          // type -> 出现该物品的 trial 数（至少 1 个）
            var minStack = new Dictionary<int, int>();
            var maxStack = new Dictionary<int, int>();
            for (int t = 0; t < trials; t++)
            {
                for (int i = 0; i < player.inventory.Length; i++) player.inventory[i] = new Item();
                try { player.OpenFishingCrate(crate); } catch { }
                var got = new HashSet<int>();
                for (int i = 0; i < player.inventory.Length; i++)
                {
                    var it = player.inventory[i];
                    if (it == null || it.IsAir || it.type <= 0) continue;
                    got.Add(it.type);
                    minStack[it.type] = Math.Min(minStack.GetValueOrDefault(it.type, int.MaxValue), it.stack);
                    maxStack[it.type] = Math.Max(maxStack.GetValueOrDefault(it.type, 0), it.stack);
                }
                foreach (var type in got) hit[type] = hit.GetValueOrDefault(type) + 1;
            }
            var list = hit
                .Select(kv => new
                {
                    id = kv.Key,
                    chance = Math.Round((double)kv.Value / trials, 6),
                    minStack = minStack[kv.Key],
                    maxStack = maxStack[kv.Key],
                })
                .OrderByDescending(x => x.chance)
                .ThenBy(x => x.id)
                .ToArray();
            result[crate] = list;
            Console.WriteLine($"[drops] {crate} {ItemID.Search.GetName(crate)}: {list.Length} kinds");
        }

        var payload = new
        {
            meta = new
            {
                gameVersion = AssemblyVersion(),
                trials,
                source = "Monte Carlo Player.OpenFishingCrate() @ OTAPI " + AssemblyVersion(),
                generatedBy = "tools/gamedump/Program.cs",
                note = "木匣掉落为实测概率（trials 次模拟）：chance = 开出至少 1 个的概率，minStack/maxStack 为观察到的数量范围",
            },
            items = result,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[drops] {crates.Count} crates -> {outPath}");
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

    // ── 物品数量上限（.plr 编辑器校验用）────────────────────
    // 直接读游戏自己的 `Item.maxStack`（默认 CommonMaxStack = 9999，武器/工具等由 SetDefaults 覆盖成 1/100…），
    // 以及 `ItemID.Sets.ItemsThatShouldNotBeInInventory`（加载时会被 TurnToAir 的 id 集合）。
    private static void DumpItemLimits(string outPath)
    {
        var maxStack = new Dictionary<int, int>();
        for (int type = 1; type < ItemID.Count; type++)
        {
            var it = new Item();
            try { it.SetDefaults(type); } catch { }
            maxStack[type] = it.maxStack;
        }
        var noInventory = new List<int>();
        for (int type = 1; type < ItemID.Count; type++)
        {
            if (ItemID.Sets.ItemsThatShouldNotBeInInventory[type]) noInventory.Add(type);
        }
        var payload = new
        {
            meta = new
            {
                gameVersion = AssemblyVersion(),
                itemCount = maxStack.Count,
                source = "Item.maxStack + ItemID.Sets.ItemsThatShouldNotBeInInventory @ OTAPI " + AssemblyVersion(),
                generatedBy = "tools/gamedump/Program.cs DumpItemLimits",
                note = "maxStack 为游戏自身的堆叠上限；noInventory 里的 id 在加载存档时会被 FixAgainstExploit 变成空气",
            },
            maxStack,
            noInventory,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[limits] {maxStack.Count} items, {noInventory.Count} blocked -> {outPath}");
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
        // 模拟开木匣会走 Player.GetItem → PopupText.NewText（需要客户端 UI，会 NRE）；
        // Main.showItemText=false 让 NewText 直接返回 -1（与服务器一致）。
        Terraria.Main.showItemText = false;

        // 读存档时的 `Item.netDefaults(type)` 依赖 `ContentSamples.ItemsByType`（游戏里有专函数初始化）。
        // 无头环境不会跑 ContentSamples.Initialize()（它要造全部 NPC/物品样本），这里手工铺一遍，
        // 否则 `Player.LoadPlayer` 会在第一个物品上抛异常、只留下 loadStatus=UnknownError。
        if (Terraria.ID.ContentSamples.ItemsByType.Count == 0)
        {
            for (int i = -65; i < ItemID.Count; i++)
            {
                var it = new Item();
                try { it.SetDefaults(i); } catch { }
                Terraria.ID.ContentSamples.ItemsByType[i] = it;
            }
        }
    }

    // ── 配方 ────────────────────────────────────────────────
    private static void DumpRecipes(string outPath, List<GroupDef> groups,
        Dictionary<int, int> itemTile, Dictionary<int, int> itemWall, Dictionary<int, List<int>> tileToItems,
        Dictionary<int, int[]> tileDims, List<int> tileFrameImportant)
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
            tileDims,
            tileFrameImportant,
            recipes,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[recipes] version={payload.gameVersion} items={payload.itemCount} recipes={payload.recipeCount} groups={groups.Count}");
    }

    // ── 图格摆放尺寸 ─────────────────────────────────────────
    // 简单方块（Dirt/Stone 等）没有 TileObjectData，摆放尺寸即 1×1，不记录；
    // 家具 / 多格图格（门、桌子、床、雕像……）取游戏自身的 TileObjectData.Width×Height。
    // 有多个 style 时取 style 0 作代表（绝大多数图格各 style 同尺寸）。
    // 另有极少数 frame-important 但无固定尺寸的图格（树、陷阱、铁轨……），
    // 单独导出 tileFrameImportant 列表，前端据此显示「无固定尺寸」而不是误报 1×1。
    // 数据来自运行期的 Terraria.ObjectData.TileObjectData / Main.tileFrameImportant，不手工枚举。
    private static Dictionary<int, int[]> DumpTileDims(out List<int> frameImportant)
    {
        frameImportant = new List<int>();
        var dims = new Dictionary<int, int[]>();
        // Main.tileFrameImportant 由 Initialize_TileAndNPCData1/2 填充（幂等）。
        TryInitTileData();
        try
        {
            Terraria.ObjectData.TileObjectData.Initialize();
        }
        catch (Exception e)
        {
            Console.WriteLine($"[recipes] 警告：TileObjectData 初始化失败：{e.InnerException?.Message ?? e.Message}");
            return dims;
        }
        for (int t = 0; t < TileID.Count; t++)
        {
            if (Terraria.Main.tileFrameImportant[t]) frameImportant.Add(t);
            try
            {
                var od = Terraria.ObjectData.TileObjectData.GetTileData(t, 0);
                if (od != null) dims[t] = new[] { od.Width, od.Height };
            }
            catch { }
        }
        Console.WriteLine($"[recipes] 图格尺寸 {dims.Count} 条，frameImportant {frameImportant.Count} 条");
        return dims;
    }

    // ── 图格样式（子 ID）─────────────────────────────────────
    // 家具 / 宝箱 / 平台等同一 TileID 下有多个 style（游戏里用 placeStyle / frame 区分）。
    // style → 物品：Item.placeStyle（放置时的样式下标）→ 代表物品，用于显示名称；
    // 有多个 placeStyle 的 tile 才会输出 styles（单样式无需子 ID）。
    private static void DumpTileStyles(string outPath)
    {
        TryInitTileData();
        try
        {
            Terraria.ObjectData.TileObjectData.Initialize();
        }
        catch (Exception e)
        {
            Console.WriteLine($"[tile-styles] 警告：TileObjectData 初始化失败：{e.InnerException?.Message ?? e.Message}");
        }

        // (tileId, style) -> 代表性物品 id（同 style 取第一个物品）
        var styleItems = new Dictionary<int, Dictionary<int, int>>();
        for (int i = 1; i < ItemID.Count; i++)
        {
            var it = new Item();
            try { it.SetDefaults(i); } catch { }
            if (it.createTile < 0) continue;
            int style = it.placeStyle >= 0 ? it.placeStyle : 0;
            if (!styleItems.TryGetValue(it.createTile, out var map))
                styleItems[it.createTile] = map = new Dictionary<int, int>();
            if (!map.ContainsKey(style)) map[style] = i;
        }

        var tiles = new Dictionary<int, object>();
        for (int t = 0; t < TileID.Count; t++)
        {
            // 宝箱 / 平台 / 火把等 tile 的样式由物品的 placeStyle 给出；
            // 一个 placeStyle 对应一个可放置的样式（也是玩家通常说的「子 ID」）。
            if (!styleItems.TryGetValue(t, out var items) || items.Count <= 1) continue;
            var styles = items
                .OrderBy(kv => kv.Key)
                .Select(kv => new { subId = kv.Key, item = kv.Value })
                .ToArray();
            tiles[t] = new { styles };
        }

        var payload = new
        {
            gameVersion = AssemblyVersion(),
            tileCount = tiles.Count,
            source = "TileObjectData.SubTiles + Item.placeStyle @ OTAPI " + AssemblyVersion(),
            generatedBy = "tools/gamedump/Program.cs --tile-styles",
            tiles,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(payload));
        Console.WriteLine($"[tile-styles] {tiles.Count} tiles -> {outPath}");
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

            // 微光分解（可微分）：与 WorldItem.GetShimmered 的分支顺序一致——
            // 金币走 CoinLuck、有微光转换的走转换、4986/560/makeNPC 有各自分支，
            // 只有落到最后一条的才会被「分解还原成材料」（ShimmerTransforms.GetDecraftingRecipeIndex）。
            int shimmerEquiv = it.GetShimmerEquivalentType();
            int decraftEquiv = it.GetShimmerEquivalentType(forDecrafting: true);
            int decraftRecipe = Terraria.GameContent.ShimmerTransforms.GetDecraftingRecipeIndex(decraftEquiv);
            int shimmerTransform = Terraria.GameContent.ShimmerTransforms.GetTransformToItem(shimmerEquiv);
            bool canDecraft = decraftRecipe >= 0
                && shimmerTransform <= 0
                && !ItemID.Sets.CommonCoin[shimmerEquiv]
                && shimmerEquiv != 4986 && shimmerEquiv != 560
                && it.makeNPC <= 0;
            int decraftStack = canDecraft ? Terraria.Main.recipe[decraftRecipe].createItem.stack : 0;

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
                canDecraft, decraftStack,
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
