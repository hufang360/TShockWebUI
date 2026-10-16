# data/ — 生成数据说明

## 重新生成

```bash
node tools/gen-data.mjs          # 1) 物品/词缀/指令 + loc.<culture>.json（官方本地化）
python3 tools/gen-atlas.py       # 2) 图标图集（需 Pillow）
python3 tools/gen-player-atlas.py # 3) 玩家角色图集（需 Pillow）
bash tools/gen-game-data.sh      # 4) 合成表 + 属性 stats + item-tips.<culture>.json（需 dotnet 9）
```

数据对应 **Terraria 1.4.5.8**。版本不匹配时必须重新生成，否则物品 ID / 名称 / 图标可能错位。

## 仓库策略（是否入库）

`data/` 由脚本生成，但**全部提交进仓库**（含图集 `items-atlas.png` / `player-atlas.png`，约 8.7MB），
目的是让**没有游戏源码 / 解包资源**的机器也能直接构建前端与单文件二进制。代价是仓库体积与生成数据的 diff 噪音。

- 图集 PNG 版权属 **Re-Logic**，随仓库提交，仅随本项目使用（见 `LICENSE`）。
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
| `npcs.json` | NPC：ID、内部名（**无名称**，名称取 `loc.NPCName`；参数补全用） | 694 |
| `buffs.json` | Buff：ID、内部名（**无名称**，名称取 `loc.BuffName`；参数补全用） | 400 |
| `commands.json` | TShock 核心指令（源码 best-effort 解析，含参数表 `paramSets`） | 95（70 条带参数表） |
| `recipes.json` | 合成表：配方、配方组（**只有本地化 `key`**）、产出/材料倒排索引 | 3603 |
| `item-stats.json` | 物品属性 `stats`（语言无关） | 6195 |
| `item-tips.zh-Hans.json` | 物品提示行（中文） | 6049 |
| `item-tips.en-US.json` | 物品提示行（英文） | 6049 |
| `loc.zh-Hans.json` | 官方本地化：`ItemName` / `Prefix` / `Misc` / `LegacyMisc` / `NPCName` / `BuffName` | — |
| `loc.en-US.json` | 官方本地化（同上） | — |
| `meta.json` | 版本、来源路径、统计 | — |
| `items-atlas.json` | 图标图集裁切信息 `{regions:{贴图id:[x,y,w,h]}}` | 6133 |
| `items-atlas.png` | 图标图集（已入库；版权 Re-Logic） | — |
| `player-atlas.json` | 玩家角色图集裁切信息 `{regions:{"b:<variant>:<part>:<role>" / "h:<hair>":[x,y,40,56]}}` | 507 |
| `player-atlas.png` | 玩家角色图集（已入库；灰度遮罩，绘制时用玩家颜色相乘着色） | — |

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
- `stats` 只保留非默认字段，供详情面板/筛选使用。

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
