# data/ — 生成数据说明

## 重新生成

```bash
node tools/gen-data.mjs           # 1) 物品/词缀/NPC/buff/指令 + 图格/墙枚举 + loc.<culture>.json
python3 tools/gen-atlas.py         # 2) 物品图标图集（需 Pillow）
python3 tools/gen-player-atlas.py  # 3) 玩家角色图集（需 Pillow）
python3 tools/gen-npc-atlas.py     # 4) NPC 贴图图集（需 Pillow）
bash tools/gen-game-data.sh        # 5) 合成表 + 属性 stats + item-tips + item-groups + shimmer + prefix + 图格/墙表（需 dotnet 9）
```

数据对应 **Terraria 1.4.5.8**。版本不匹配时必须重新生成，否则物品 ID / 名称 / 图标可能错位。

## 仓库策略（是否入库）

`data/` 由脚本生成，但**全部提交进仓库**（含图集 `items-atlas.png` / `player-atlas.png`，约 8.7MB），
目的是让**没有游戏源码 / 解包资源**的机器也能直接构建前端与单文件二进制。代价是仓库体积与生成数据的 diff 噪音。

- 图集 PNG 版权属 **Re-Logic**，随仓库提交，仅随本项目使用（见 `LICENSE`）。
- 三个图集（items / player / npc）的 `*-atlas.json` 里都有 `meta.hash`（PNG 的内容哈希）：前端用 `?v=<hash>` 拉 PNG，图集一变 URL 就变，避免「新坐标 + 旧 PNG」的图标错位。
- 升级游戏版本后必须按上文重新生成，并核对 `meta.json` 的 `gameVersion`。
- 若后续想瘦身：可把生成物移出仓库、改由 CI / Docker 构建时生成（代价：构建机需备齐游戏资源）。

## 语言拆分

语言相关数据**按界面语言各存一份**，运行期只加载当前语言那一份（`loadDataset(lang)`）：

- `loc.<culture>.json`：官方本地化（物品名 / 词缀名 / 配方组名），保持游戏原生两级格式
  `{分类:{key:值}}`，值逐字取自官方 JSON（仅收录运行期用到的分类）。
- `item-tips.<culture>.json`：物品提示行（按语言）。

与语言无关的数据（`items.json` / `item-stats.json` / `recipes.json` / 图集 / 元信息）只加载一次。
`culture` 为 `zh-Hans` 或 `en-US`。

## 文件

| 文件 | 内容 | 条数 |
| --- | --- | --- |
| `items.json` | 物品：ID、内部名、图标、动画帧数、贴图尺寸、标签（**无名称**） | 6195 |
| `prefixes.json` | 词缀：ID、内部名（**无名称**） | 97 |
| `npcs.json` | NPC：ID、内部名（**无名称**，名称取 `loc.NPCName`；参数补全用）、`/sb` 参数信息 | 694 |
| `tiles.json` | 图格 ID：内部名（`TileID`）、代表物品 id、摆放尺寸 | 754 |
| `walls.json` | 墙 ID：内部名（`WallID`）、代表物品 id | 367 |
| `buffs.json` | Buff：ID、内部名（**无名称**，名称取 `loc.BuffName`；参数补全用） | 400 |
| `commands.json` | TShock 核心指令（源码 best-effort 解析，含参数表 `paramSets`） | 95（70 条带参数表） |
| `recipes.json` | 合成表：配方、配方组（**只有本地化 `key`**）、产出/材料倒排索引 | 3603 |
| `item-stats.json` | 物品属性 `stats`（语言无关） | 6195 |
| `item-groups.json` | 创意菜单物品分组（页签 + 每件物品的 ItemGroup / 组内顺序，语言无关） | 6195 |
| `shimmer.json` | 微光转换：源物品 id → 目标物品 id（语言无关） | 316 |
| `prefix-mods.json` | 词缀数值修正（乘/加；来自 `Item.cs`，与物品无关）+ `val` 评分 + 饰品词缀 `benefit` | 97 |
| `prefix-sets.json` | 每件物品**可滚词缀**（`Item.GetRollablePrefixes()`；盔甲/材料不收录） | 886 |
| `item-drops.json` | 木匣掉落（运行时模拟：物品 / 数量范围 / 实测概率） | 26 个木匣 |
| `item-tips.zh-Hans.json` | 物品提示行（中文） | 6049 |
| `item-tips.en-US.json` | 物品提示行（英文） | 6049 |
| `loc.zh-Hans.json` | 官方本地化：`ItemName` / `Prefix` / `Misc` / `LegacyMisc` / `NPCName` / `BuffName` | — |
| `loc.en-US.json` | 官方本地化（同上） | — |
| `meta.json` | 版本、来源路径、统计 | — |
| `items-atlas.json` | 图标图集裁切信息 `{regions:{贴图id:[x,y,w,h]}}` | 6133 |
| `items-atlas.png` | 图标图集（已入库；版权 Re-Logic） | — |
| `player-atlas.json` | 玩家角色图集裁切信息 `{regions:{"b:<variant>:<part>:<role>" / "h:<hair>":[x,y,40,56]}}` | 507 |
| `player-atlas.png` | 玩家角色图集（已入库；灰度遮罩，绘制时用玩家颜色相乘着色） | — |
| `npc-atlas.json` | NPC 贴图图集裁切信息 `{regions:{npcId:[x,y,w,h]}}`（第一帧） | 694 |
| `npc-atlas.png` | NPC 贴图图集（已入库；版权 Re-Logic） | — |

### commands.json 结构

```jsonc
{
  "meta": {
    "source": "TShockAPI/Commands.cs + i18n/zh_CN/TShockAPI.po",
    "count": 95,
    "paramCount": 70,          // 带参数表 paramSets 的指令数
    "paramNote": "仅收录能从 TShock 源码可信提取的参数；没有 paramSets 的指令请自由输入"
  },
  "commands": [{
    "name": "give",
    "aliases": ["g"],
    "permission": "tshock.item.give",
    "help": "Gives another player an item.",   // 英文原文（GetString msgid）
    "helpEn": "…", "helpZh": "…",              // 中文取自 TShock i18n
    "allowServer": true,                        // false → REST rawcmd 会被拒（C6）
    "doLog": true,
    "paramSets": [{                             // 可选；同一指令的不同子命令形态
      "syntax": "give <item type/id> <player> [item amount] [prefix id/name]",
      "args": [
        { "name": "item type/id", "required": true,  "kind": "item" },
        { "name": "player",       "required": true,  "kind": "player" },
        { "name": "item amount",  "required": false, "kind": "number" },
        { "name": "prefix id/name","required": false,"kind": "prefix" }
      ]
    }]
  }]
}
```

`paramSets` 的来源与限制（实现见 `tools/gen-data.mjs`）：

- 来自 **TShock 自己的用法串** `GetString("Invalid syntax. Proper syntax: {0}<cmd> <args>")`、
  源码枚举常量（`_validEvents` / `_validInvasions` / `_worldModes`）、`switch (args.Parameters[N])` 的 `case` 标签，
  以及「方法体完全不引用 `args.Parameters` → 无参数」的机械判定；少数条目为手写并标注 `source`。
- `args` 里 `literal` 表示字面子命令（如 `/group addperm` 的 `addperm`），`name` 才是真正的参数。
- `kind` 决定前端补全来源：`player`(在线玩家) / `item` / `prefix` / `npc` / `buff`（均来自 data/*.json）/
  `region` / `warp`（TShock 运行时，由信使插件 `/api/data` 提供，前端登录后注入）/
  `enum`(自带 `values`) / `command` / `number`·`text`（无候选，仅提示）。
- 离线数据源：`npc` → `npcs.json` + `loc.NPCName`；`buff` → `buffs.json` + `loc.BuffName`。
  候选插入数字 ID（TShock 的 `GetNPCByIdOrName` 这类接口接受 ID）；区域/传送点插名字（含空格加引号）。
- 覆盖不到就留空——这是 best-effort 数据，实际可用参数以目标服务器版本为准。

### recipes.json 结构

```jsonc
{
  "meta": { "gameVersion": "1.4.5.8", "count": 3603, "groupCount": 34, ... },
  // 配方组名不落盘，前端按当前语言用 loc.<culture>.json 的对象 key 解析：
  //   ItemName.Wood / NPCName.Turtle / Misc.Macaw / Lang.misc[85](→LegacyMisc.85)
  "groups": { "Wood": { "key": "ItemName.Wood", "items": [9, 619, ...] } },
  "recipes": [{
    "result": { "id": 22, "stack": 1 },
    "ingredients": [ { "id": 11, "stack": 3 }, ... ],   // 配方组：{ id, stack, group: "IronBar" }
    "station": 17,                                        // 制作站图格 id（-1 = 徒手）
    "stationItems": [33],                                 // 制作站代表物品（显示图标）
    "env": ["water"], "flags": ["crimson"], "shimmer": []
  }],
  "byResult": { "22": [0, 1, ...] },                      // 产出该物品的配方下标
  "byIngredient": { "22": [3, 4, ...] }                   // 以该物品为材料的配方下标（含配方组成员）
}
```

### item-stats.json / item-tips.<culture>.json 结构

```jsonc
// item-stats.json —— 语言无关，只有 stats
{
  "meta": { "gameVersion": "1.4.5.8", ... },
  "items": { "4956": { "stats": { "damage": 190, "crit": 10, "useAnimation": 30, "rare": 10, ... } } }
}
// item-tips.zh-Hans.json / item-tips.en-US.json —— 每语言一份，只有 tip 行
{
  "meta": { "gameVersion": "1.4.5.8", "itemsWithTip": 6049, ... },
  "items": { "4956": ["190近战伤害", "14%暴击率", ...] }
}
```

- `tip` 行顺序与文案复刻游戏 `Main.MouseText_DrawItemTooltip_GetLinesInfo()`；
  伤害/暴击为**物品基础值**（暴击已按无装备玩家 +4% 基础值处理），不含前缀与玩家/世界状态相关行。
  游戏内这几行会按当前角色属性重算，所以图鉴会对含这些行的物品显示一句「基础值 · 不含角色属性加成」。
- 金币（ID 71–74）按「背包里没有 Coin Gun(905)」的默认行为处理：只显示「可放置」，不显示伤害/暴击行。
- `stats` 只保留非默认字段，供详情面板/筛选使用。其中 `canDecraft` / `decraftStack` 是「可微分」相关：
  `canDecraft` = 该物品丢进微光会走「分解还原材料」分支（严格复刻 `WorldItem.GetShimmered` 的分支顺序：
  金币 / 有微光转换 / 4986·560 / `makeNPC` 优先，其余才看 `ShimmerTransforms.GetDecraftingRecipeIndex`）；
  `decraftStack` = 分解所用的配方一次产出多少（>1 时要凑够这么多才能分解，如平台×2、箭矢×10）。
  判定忽略世界进度锁（骷髅王前 / 石巨人前）与猩红/腐化世界的配方差异。

### item-groups.json 结构（创意菜单分组）

来自游戏运行时（GameDump 通过反射先执行 `Main.Initialize_TileAndNPCData1/2`，再调
`ContentSamples.CreativeHelper.GetItemGroup` / `ItemCreativeSortingId` 与
`Terraria.GameContent.Creative.ItemFilters`）：

```jsonc
{
  "meta": { "gameVersion": "1.4.5.8", "itemCount": 6195, "tabCount": 11, ... },
  // 页签 = 创意菜单 UICreativeInfiniteItemsDisplay 使用的过滤器列表（顺序固定）
  "tabs": [{ "id": "weapons", "label": "CreativePowers.TabWeapons" }, ...],
  "items": {
    // g/gv = ItemGroup 枚举名/值；o = 组内顺序（ByCreativeSortingId 用）；
    // t = 所属页签下标（一个物品可属于多个页签，与游戏 EntryFilterer 一致）
    "4956": { "g": "MeleeWeapon", "gv": 530, "o": -190, "t": [0] }
  }
}
```

- 页签有 11 个：武器 / 盔甲 / 时装 / 物块 / 家具 / 配饰 / 装备 / 消耗品 / 工具 / 材料 / 其他。
- 前端页签文案取自 `web/src/lib/i18n.tsx` 的 `dex.tab.<id>`（与游戏 `CreativePowers.Tab*` 官方文案一致）。
- 由 `tools/gen-item-groups.mjs` 整理（页签 key → i18n id 的映射也在其中）。

### shimmer.json 结构（微光转换）

来源：`ItemID.Sets.ShimmerTransformToItem`（源物品 → 目标物品；-1 = 无转换）。

```jsonc
{
  "meta": { "gameVersion": "1.4.5.8", "count": 316, "source": "ItemID.Sets.ShimmerTransformToItem @ OTAPI 1.4.5.8", ... },
  "items": { "3": 2, "8": 5353, "9": 2 }
}
```

- 由 `tools/gen-shimmer.mjs` 整理（只收录有效且非自身的映射）。
- 前端 `dataset.ts` 同时建正向 `shimmerToById` 与反向 `shimmerFromById`，供详情「微光转换」区展示。

### prefix-mods.json 结构（词缀数值修正）

来源：`TR_SRC/Terraria/Item.cs` 的 `TryGetPrefixStatMultipliersForItem()` switch（与物品无关）。

```jsonc
{
  "meta": { "count": 97, "source": "Terraria/Item.cs TryGetPrefixStatMultipliersForItem() @ 1.4.5.8", ... },
  "mods": { "81": { "kb": 1.15, "dmg": 1.15, "crt": 5, "spd": 0.9, "size": 1.1, "val": 1.760248 } }
}
```

- 由 `tools/gen-prefix-mods.mjs` 解析（只保留非默认字段）。
- 前端详情「词缀」下拉用它预览词缀加成（伤害/暴击/速度/击退）。
- `val`：游戏自身的词缀评分（`Item.TryGetPrefixStatMultipliersForItem` 末尾的 `value` 公式 + 顶级倍率）。
  前端 `web/src/lib/prefixes.ts` 用它取「最佳词缀」= 评分并列最高的那些（对应游戏 `Item.BestPrefixValue()` /
  `rolledPrefixIsTopTier`）；饰品词缀 62–80 在 switch 里没有分支，`val` 只由顶级倍率决定（65/68/72/76/80 → 1.2）。

### prefix-sets.json 结构（可滚词缀）

来源：游戏运行时 `Item.GetRollablePrefixes()`（武器/饰品各不相同，盔甲/材料返回 null）。

```jsonc
{
  "meta": { "setCount": 7, "itemCount": 886, ... },
  "sets": [[1, 2, 3, ...], [16, 17, ...]],
  "items": { "4956": 0, "12": 4 }
}
```

- 由 `tools/gamedump` 导出 + `tools/gen-prefix-sets.mjs` 整理；`items` 只收录有词缀的物品。
- 前端详情「词缀」下拉**只列该物品可滚的词缀**（盔甲等不显示下拉）。

### item-drops.json 结构（木匣掉落）

来源：**运行时模拟** `Player.OpenFishingCrate()`（掉落是命令式 `switch`，没有数据表）。
`tools/gamedump` 对每个木匣（`ItemID.Sets.IsFishingCrate`，26 个）跑 `trials` 次，统计每种物品的出现次数与数量范围。

```jsonc
{
  "meta": { "trials": 1000000, "source": "Monte Carlo Player.OpenFishingCrate()", ... },
  "items": {
    "2334": [ { "id": 3200, "chance": 0.0478, "minStack": 1, "maxStack": 1 }, ... ]
  }
}
```

- `chance` 是**实测概率**（开出至少 1 个的模拟频率），不是源码里的精确分数；UI 会标注模拟次数。
- `minStack` / `maxStack` 是模拟中观察到的数量范围。
- 只做木匣（掉落与专家/大师无关）；宝藏袋（`OpenBossBag`）含专家/大师分支，未纳入。

### npcs.json 结构（`/sb` 参数）

`npcs.json` 的每条除了 `id` / `key`，还会从 TShock `SpawnBoss()` 的 switch 解析出 Boss 信息（供「数据图鉴」的 Boss 筛选与「指令」页 `/sb` 补全使用）：

```jsonc
{
  "id": 4,
  "key": "EyeofCthulhu",
  "sb": "eye of cthulhu",        // /sb 的规范写法（最长别名）；仅 Boss 有
  "sbAliases": ["eoc", "eye", "eye of cthulhu"],  // 全部合法别名（多于一个时）
  "sbAll": true                   // 是否包含在 /sb all 里
}
```

- 来源：`TShockAPI/Commands.cs` 的 `SpawnBoss()`（`case` 标签 → `npc.SetDefaults(N)`；`NPC.SpawnWOF` → 113）。
- 普通怪物没有这些字段；`/sm` 对任意 NPC 都可用（名称或数字 ID），所以图鉴总是给出 `/sm`。

### tiles.json / walls.json 结构（数据图鉴）

```jsonc
{
  "meta": { "gameVersion": "1.4.5.8", "count": 754, "withItem": 647, "withSize": 389, ... },
  "entries": [
    { "id": 0, "key": "Dirt",  "item": 2 },               // item = 放置该图格的代表物品 id
    { "id": 14, "key": "Tables", "item": 1413, "size": [3, 2] }, // size = 摆放尺寸 [宽, 高]（格）
    { "id": 5, "key": "Trees", "item": null, "frameImportant": true }, // 无固定尺寸（树 / 陷阱等）
    { "id": 7, "key": "Copper", "item": 12 }              // 简单方块：无 size（1×1）
  ]
}
```

- 内部名来自 `Terraria.ID/TileID.cs` / `WallID.cs` 的常量名；`item` 来自 GameDump 的 `itemTile` / `itemWall`（同一图格有多个放置物时取 id 最小的）。
- `size`（仅图格）：GameDump 的 `tileDims`，来自游戏运行期 `Terraria.ObjectData.TileObjectData` 的 `Width × Height`（style 0 作代表）；简单方块（`1×1`）省略该字段，墙没有尺寸概念。
- `frameImportant`（仅图格）：GameDump 的 `tileFrameImportant` 里「frame-important 但无 `TileObjectData`」的图格（树 / 陷阱 / 铁轨……）；有 `size` 的条目不重复标。
- 显示名在运行期由代表物品的官方本地化名解析（等价于游戏 `Lang.GetMapObjectName` 的常见情形）；没有代表物品时回退到内部名。
- 由 `tools/gen-tile-wall.mjs` 整理（`tools/gen-game-data.sh` 调用，复用同一次 GameDump 的 `recipes-raw.json`）。

### NPC 贴图图集（npc-atlas）

「数据图鉴」用一张图集展示每个 NPC 的样子（第一帧）：
```jsonc
{
  "meta": { "gameVersion": "1.4.5.8", "count": 694, "sheet": "npc-atlas.png", ... },
  "regions": { "1": [0, 0, 32, 26], "4": [64, 0, 110, 166] }  // npcId -> [x, y, w, h]
}
```

- 帧高 = 贴图高 / `Main.npcFrameCount[npcId]`（`Terraria/NPC.cs:FindFrame()`）；少数特殊 NPC 的 `frame.Width` 也按源码覆盖。
- 第一帧几乎为空（多列 / 特殊布局）时回退到整张贴图的紧包围盒。
- 由 `tools/gen-npc-atlas.py` 生成（需 Pillow，读 `NPC_<id>.png`）。
- 图集 PNG 版权属 **Re-Logic**，随仓库提交（见 `LICENSE`）。

## items.json 单条结构

```json
{
  "id": 75,
  "key": "FallenStar",
  "icon": 75,
  "frames": 8,
  "sprite": [22, 208],
  "tags": []
}
```

### loc.<culture>.json 结构

官方本地化的**两级 `{分类:{key:值}}`** 格式（与游戏 `Terraria.Localization.Content.*.json` 一致）：

```jsonc
{
  "ItemName": { "FallenStar": "坠落之星", ... },
  "Prefix": { "Legendary": "传奇", ... },
  "Misc": { "Macaw": "金刚鹦鹉", ... },
  "LegacyMisc": { "85": "丛林虫子", ... },
  "NPCName": { "Turtle": "龟", ... }
}
```

- 只收录前端运行期用到的分类；新增分类改 `tools/gen-data.mjs` 的 `LOC_CATEGORIES`。
- 物品/词缀名用 `ItemName.<item.key>` / `Prefix.<prefix.key>` 查表；配方组名用
  `locText()`（支持 `Lang.misc[N] → LegacyMisc.N`）。
- **英文名是 TShock 指令的引用名**（服务器按自身语言 `Lang.GetItemNameValue` 解析），中文界面下
  点「插入英文名」时按需加载 `loc.en-US.json`（`web/src/lib/loc.ts`）。

- `icon`：实际贴图 ID。多数等于 `id`；少数（62 个）指向 `ItemID.Sets.TextureCopyLoad` 的回退贴图。
- `frames`：贴图纵向帧数（1 表示静态）。
- `sprite`：`[宽, 高]`，**原始贴图**尺寸，不是单帧尺寸。
- 渲染第一帧：裁剪 `(0, 0, 宽, 高 / frames)`。

## 图标源文件（仅用于生成图集）

原始图标不在本仓库，位于本机已解包目录（`SPRITE_DIR`，默认 `<仓库>/../tr-sprite-1458/Content/Images`）：

```
$SPRITE_DIR/Item_<icon>.png
```

`tools/gen-atlas.py` 从这里读取并合成图集。**原始贴图（约 85MB）不要提交进仓库**；合成后的图集 PNG 会入库。

## 图标图集（sprite）

所有图标合成 **一张** `items-atlas.png`，前端按 `items-atlas.json` 裁切第一帧。
参考本机 `FishShopConfig` 的 `items.png` / `itemsPngInfo` 方案，但全自动且覆盖全部物品 ID。

- 尺寸：**1024 × 4584**（唯一贴图 6133 张，约 2.0 MB）。
- 裁切信息 key 是**贴图 id**，前端用 `items.json` 里的 `item.icon` 取：
  ```js
  const [x, y, w, h] = regions[item.icon];
  ctx.imageSmoothingEnabled = false;      // 像素风
  ctx.drawImage(atlasImg, x, y, w, h, dx, dy, dw, dh);
  ```
- 动画物品只取第一帧；`regions` 里的 `w/h` 已是单帧尺寸，**不需要再除以 frames**。
- 摆放规则：按「高降序、宽升序」排序，逐行摆放，超过 1024 宽换行（与参考项目一致）。
- 图集 PNG 版权属 Re-Logic，随仓库提交（见 `LICENSE`）；由 `tools/gen-atlas.py` 从本地游戏贴图生成。
- 缺省动画物品/回退贴图已在生成时处理：`items.json` 的 `icon` 指向真实贴图，图集按贴图 id 收录。

## commands.json 注意

- 只包含 TShock **核心指令**；插件指令、运行时别名不在此文件。
- 每条指令含 `help`（英文原文，= `helpEn`）与 `helpZh`（取自 TShock `i18n/zh_CN/TShockAPI.po`），
  供前端按界面语言展示帮助文本。
- `allowServer: false` 的指令**无法通过 `/v3/server/rawcmd` 执行**（TShock 会让非真实玩家用不了的指令返回「必须游戏内使用」）。
  24 条此类指令包含 `/i`、`/tp`、`/home`、`/buff` 等，详见 `docs/TECHNICAL_RESEARCH.md`。
- 指令是否真的可执行，仍以目标服务器运行时为准，本文件只用于补全提示与预校验。

## 数据来源

见 `tools/gen-data.mjs` 顶部注释与 `docs/TECHNICAL_RESEARCH.md`。
