# 数据 ID（DataIdPage）

文档版本：1.10
对应页面：`web/src/pages/DataIdPage.tsx`（导航「数据 ID」，tab id `dataid`）
相关数据：`data/npcs.json`、`data/tiles.json`、`data/walls.json`、`data/buffs.json`、`data/items.json`、
`data/loc.<culture>.json`（`NPCName` / `ItemName` / `BuffName`）、`data/npc-atlas.json` / `.png`、
`data/buff-atlas.json` / `.png`
相关代码：`web/src/components/NpcSprite.tsx`、`web/src/components/ItemIcon.tsx`、`web/src/components/BuffIcon.tsx`、
`web/src/lib/npcAtlas.ts`、`web/src/lib/buffAtlas.ts`、`web/src/lib/npcCollections.ts`、`web/src/components/SearchInput.tsx`、
`web/src/lib/pagination.ts`、`web/src/hooks/usePageHeight.ts`、`web/src/hooks/useSearchHistory.ts`

> 本文件描述「数据 ID」（代码页 `DataIdPage`）的定位、布局、数据来源与验收方式。它是原「NPC 图鉴」（`NpcDexPage`）与
> 「数据 ID」（`TileWallPage`）**合并后的单页**：**同一套网格组件，只是数据源不同**。

---

## 1. 定位与范围

玩家侧的**只读浏览工具**：在同一个页面里切换 NPC / 图格 / 墙 / Buff，按网格 / 表格浏览，点开看详情。

- **不是**生成 / 管理后台；本页**不执行任何指令**（只读浏览），唯一请求是登录后拉一次 `GET /api/me`
  （拿当前玩家的权限节点，决定详情里显示哪几条指令）。
- `/sb`（`spawnboss`）与 `/sm`（`spawnmob`）在 TShock 里是 `allowServer=false` 的指令，
  经 REST 无法执行（`docs/REST_API限制.md`）→ 详情里只**显示 + 复制**；
  `/gbuff`（给 buff）是 `allowServer=true`，可以复制到「指令」浮窗里直接执行。
- 图格 / 墙是 `TileID` / `WallID` 速查：ID、代表物品（图标 + 名称）、摆放尺寸、内部名。
- Buff 是 `BuffID` 速查：ID、图标、本地化名称、内部名（图标取自游戏 `Content/Images/Buff_<id>.png`，见 §2）。
- 旧的 tab id（`npcs` / `tiles`，以及改名前用的 `codex`）在 `App.tsx` 里做兼容映射到 `dataid`，老用户的侧边栏记忆不会失效。

---

## 2. 数据来源

| 数据 | 文件 | 说明 |
| --- | --- | --- |
| NPC | `data/npcs.json` | `{ id, key, sb?, sbAliases?, sbAll? }`，694 条；名称不落盘 |
| NPC 名称 | `data/loc.<culture>.json` | 官方本地化 `NPCName.<key>`，按界面语言加载 |
| NPC 贴图 | `data/npc-atlas.json` / `.png` | `regions[npcId] = [x, y, w, h]`（第一帧），懒加载 |
| NPC 分类 | `web/src/lib/npcCollections.ts` | 手工维护：分类名 + 里面的 NPC id（来源见该文件注释） |
| 图格 | `data/tiles.json` | `{ id, key, item, size?, frameImportant? }`，754 条 |
| 墙 | `data/walls.json` | `{ id, key, item }`，367 条（墙没有尺寸概念） |
| 图格 / 墙名称 | `data/loc.<culture>.json` | 代表物品的 `ItemName.<key>`；没有代表物品时回退内部名 |
| 图格 / 墙图标 | `data/items-atlas.{json,png}` | 由代表物品 `item` → 物品图标（复用物品图集，不新增资源） |
| Buff | `data/buffs.json` | `{ id, key }`，400 条；名称不落盘 |
| Buff 名称 | `data/loc.<culture>.json` | 官方本地化 `BuffName.<key>`，按界面语言加载；缺名时回退内部名 |
| Buff 图标 | `data/buff-atlas.{json,png}` | 游戏原图 `Buff_<id>.png`（32×32 静态图标，400 个）拼成的图集；懒加载 |
| 自备 NPC 贴图 | `tools/npc-overrides.json` + `tools/npc-overrides/` | 可给指定 NPC 换成自己的图片（见 §7） |

- NPC 的 `sb` / `sbAliases` / `sbAll` 由 `tools/gen-data.mjs` 从 `TShockAPI/Commands.cs` 的 `SpawnBoss()` 解析，
  见 `data/README.md`「npcs.json 结构」。
- 图格 / 墙的 `key` 是 `Terraria.ID/TileID.cs` / `WallID.cs` 常量名；`item` 来自 GameDump 的 `itemTile` / `itemWall`；
  `size` / `frameImportant` 来自 `TileObjectData`，由 `tools/gen-tile-wall.mjs` 整理（`tools/gen-game-data.sh` 调用）。
- Buff 的 `key` 是 `Terraria.ID/BuffID.cs` 常量名（也是 `loc.BuffName` 的 key），由 `tools/gen-data.mjs` 解析；
  图标由 `tools/gen-buff-atlas.py` 从 `Content/Images/Buff_<id>.png` 生成（静态图标，无动画帧），
  `regions[buffId]` 与 `data/buffs.json` 的 id 一致。
- NPC 图集由 `tools/gen-npc-atlas.py` 生成，帧高 = `贴图高 / Main.npcFrameCount[id]`，
  第一帧为空时回退到整张贴图的紧包围盒。图集 PNG 版权属 Re-Logic。
- **多列网格贴图**例外：少数 NPC 的贴图是横铺的网格，游戏在 `Main.DrawNPCDirect` 里用
  `Frame(列, 行, ...)` 选单帧（`frame.Width` 不等于可见帧宽）——生成脚本的 `FRAME_GRIDS` 照抄这些分格，
  取左上角那一帧。当前：`396`(3,3)、`564`/`565`(5,9)、`576`/`577`(5,10)、`696`(6,27)。

### 2.1 图集「裁切表 ↔ PNG」一致性（防图标错位）

图标错位（上下偏移 / 显示成别的 NPC / Buff）**几乎都是浏览器把「旧裁切表」和「新 PNG」拼到了一起**。
三层防护（见 `web/src/lib/atlas.ts`）：

1. `*-atlas.json` 里带 PNG 的**内容哈希**，前端用 `?v=<hash>` 拉图 → 图集一变 URL 就变；
2. 裁切表请求**一律 `cache: 'no-store'`** → 连历史上被长缓存过的旧条目也不会再用（`no-store` 强制回源）；
3. 加载 PNG 后**校验 `naturalWidth/Height` 与裁切表一致**，不一致就带时间戳重取一次，仍不一致保持透明（不再显示暗色问号占位），绝不画错位贴图。

> 图集宽度取 `--limit-width` 与**最宽贴图**的较大值：按 1024 截断会把超宽贴图的右侧裁掉。
> 生成时若出现超宽贴图会在 stderr 提示。

> 多列网格的 6 个 NPC（见 §2 `FRAME_GRIDS`）已按游戏分格取单帧，不会再显示成并排的好几帧。
> 极少数仍需要人工框选的可放 `tools/npc-overrides.json` 用 `crop` 指定（见 §7）；
> `677`（微光蝶）与 `549`（邪教传送门）本身就是游戏的原样裁切（粒子 / 门形），不是错位。

---

## 3. 布局（工具条 + 列表 + Popover / 抽屉）

```
┌ 数据源 Tabs（不在 Card 内）─────────────────────────────────────┐
│ NPC │ 图格 │ 墙 │ Buff                                            │
└──────────────────────────────────────────────────────────────────┘
┌ 工具行（不套卡片，直接铺在页面上）────────────────────────────┐
│ 搜索框  结果数        [全部│Boss│NPC│小动物]（胶囊）  ⚙  ⛶       │
└──────────────────────────────────────────────────────────────────┘
┌ 页面设置 Popover（所有 tab 共用）───────────────────────────────┐
│ 视图：表格视图 / 两列表格                                        │
│ ─────────────────────────────────────────────────────────────── │
│ 参考数据：展开子 ID                                             │
│ NPC ID / 数据 ID / 图格 ID / 墙 ID / 增益 ID                    │
└──────────────────────────────────────────────────────────────────┘
┌ 列表（可滚动区域，不套白色卡片；无翻页，一次展示全部）──────────┐
│ ┌──┐┌──┐┌──┐…  NPC / 图格 / Buff 默认图标网格                    │
└──────────────────────────────────────────────────────────────────┘
```

- 布局**沿用物品 ID**：工具行不套卡片、中间列表是可滚动区域（**不套白色卡片**），**无翻页器**；
  页面整体高度由 `hooks/usePageHeight.ts` 撑满，自身不滚动。
- 数据源 tablist 独立放在页面顶部，**不包在 Card 内**（shadcn `Tabs` 的 **line 变体**）。
- NPC 分类由下拉框改为胶囊 Tabs，位于工具行右侧；**「页面设置」与「全屏」按钮在内容区顶栏右侧**（`TopBarActions`），不再占工具行。
- **NPC / 图格 / 墙 / Buff 都支持两种视图**：默认**图标网格**；在同一个「页面设置」Popover 中勾选「表格视图」后切为表格。
- 所有页面设置（表格视图 / 导出表格 / 两列表格 / 展开子 ID / 全部 Wiki 链接）都在**同一个 Popover**，不再按 tab 分开展示或切换内容。
- 网格图标保留低对比背景格；**表格视图图标不铺背景、不加描边**。
- **图标网格的统一外观**：格子固定 **120 宽**（`w-30`），上方图标底 **120×120**（`size-30`）、`bg-accent`（与搜索框 / 输入框同色）、**无描边**；
  下方 ID / 名称在 120 宽内截断（`truncate`）；行间距 16px（`gap-y-4`）。
  列间距由 `components/dataid/IconGrid.tsx` 动态计算：先按最小 8px 算列数，再把「容器宽 − 列数 × 120」均摊给列间距（8–32px），
  让最后一列贴住右边缘、格子始终 120 方形；均摊后仍有明显剩余（手机上只能放 2 列）时网格整体居中。
  实测：1440 宽 → 8 列 / 间距 22px；390 宽 → 2 列 / 间距 32px 且居中。
  hover 时**整格（图标 + 文字）一起上浮 2px**，但**变色只发生在 120×120 的图标底上**（`group-hover/cell:bg-primary/10`）。
- **NPC 图标网格**：格子 = 贴图 + ID + 名称；贴图绘制区 **96×96**（详情里放大）
  （`DataIdPage` 的 `THUMB_SIZE` / `THUMB_SIZE_BOSS`），列数也相应减少。
- **响应式列数使用容器查询**：普通 NPC / 图格 / Buff 随内容区宽度按 4 → 6 → 8 → 10 列递增；侧栏展开时按剩余内容宽度收缩，不会误用视口断点排成过密网格。
- **图格图标网格**：代表物品图标 96×96（放在 120 的图标底里）+ TileID + 名称；多样式显示 `N 种`；点击打开抽屉。
- **贴图按游戏原生大小画（只缩不放）**：`NpcSprite` 默认 `mode='game'`，贴图 < 方框时按 1:1
  像素绘制（萤火虫就是 10×16、城镇 NPC 就是 40×56），只有超过方框才等比缩小。
- **图格 / 墙切到表格后**：
  - 列：`图标 / TileID（墙是 WallID）/ 名称 / 尺寸（仅图格）/ 内部名`；
  - **图标列**在 ID 左边：用代表物品的图标（复用物品图集，`ItemIcon` size 24）；没有代表物品时灰色占位。
  - **尺寸列**（仅图格）：只显示非 1×1 的格子（如 `1×2` / `2×2`），带浅色底；1×1 与无固定尺寸的不显示。
  - **表头不铺白底**：用页面背景色（`bg-background/90` + 模糊）吸顶，不再是一块白色。
  - **「两列表格」 checkbox（默认选中）在页面设置的「视图」区**：开启且行数 > 8 时，
    `xl` 排成左右两张表；取消勾选就只一张表。
  - **小屏（< 1280px）隐藏该开关并强制单列**：两列表格只在 `xl` 真正生效，小屏本来就只有一列。
  - **子 ID（样式）**：同一 TileID 下有多个 placeStyle 的行，名称旁显示 `N 种` 徽标；
    详情抽屉新增「子 ID / 样式」列表（`21-0 木箱` / `21-1 金箱`…）。勾选「展开子 ID」可把样式平铺成独立行，
    搜索支持 `21-1` 或样式物品名。
  - 奇数行斑马纹（`odd:bg-muted/25`）、hover / 键盘聚焦高亮、圆角质表框；名称无代表物品时用等宽弱色斜体标注。
- **NPC / Buff 表格视图**：列 `ID / 图标 / 名称 / 内部名`；Buff 表格沿用「两列表格」开关。
- **Wiki 链接**：在页面设置 Popover 的当前数据源分区，按当前语言显示中文 / 英文站点；NPC 同时给出「NPC ID」与「数据 ID」两个入口。
- **详情**：NPC / Buff 点格子或行 → **Popover**（图标 **32×32**，名称 / ID / 内部名，去掉了冗余说明文字）；
  图格 / 墙仍用右侧抽屉（`Sheet side="right"`）。

---

## 4. 交互规则

| 行为 | 规则 |
| --- | --- |
| 数据源 | `NPC` / `图格` / `墙` / `Buff` 单选 **shadcn `Tabs`（line 下划线变体）**；切换会**清空搜索**并复位列表滚动（不同源的名称互不通用） |
| NPC 筛选 | 工具行右侧、页面设置左侧的胶囊 Tabs：`全部` / `Boss` / 各分类（`lib/npcCollections.ts` 配置），与搜索叠加；`Boss` = `npcs.json` 的 `sb` 与 `EXTRA_BOSS_IDS` 的并集（已移除 440 / 565 / 577）；切换数据源时保持分类状态 |
| 搜索 | 胶囊输入框，放大镜位于最右侧；工具行上下各 4px（`p-1`，左右同样 4px 以保护聚焦环）；手机端 NPC 分类胶囊（全部 / Boss / …）独占下一行；占位符统一为 `名称 / ID`；NPC 另支持内部名 / `/sb` 参数与别名；防抖 150ms；最近搜索可逐条删除 |
| 分页 | **无分页**：一次展示全部结果，搜索 / 切数据源 / 切筛选都会把列表滚动复位 |
| 视图切换 | 统一在页面设置 Popover 的「视图」区切换表格；默认不勾 = 图标网格 |
| 导出 | 页面设置的「表格视图」旁提供「导出表格」，按当前筛选结果导出 CSV。 |
| 两列 | 图格 / 墙，以及 Buff 的表格视图，可在页面设置里切换「两列表格」（默认开）；开且行 > 8 时 `xl` 左右两张表；小屏（< 1280px）隐藏该开关并强制单列 |
| 图格子 ID | 主表一行一个 TileID，名称旁显示 `N 种`；详情列出 `TileID-子ID` 与样式名；「展开子 ID」把样式平铺成行；搜索支持 `21-1` / 样式名 |
| 页面状态记忆 | 数据源 tab / NPC 分类 / 两列表格 / 表格视图 / 滚动位置记在**模块内存**（`lib/dataIdState.ts`）：切页面回来会还原，**刷新页面重置** |
| 全屏 | 点击全屏后隐藏 Tabs、搜索、结果数和分类，仅结果区铺满视口；右侧操作坞先是「页面设置 / 退出全屏」，约 4 秒后收成小竖条（悬停 / 聚焦展开），Esc 也可退出。全屏图标网格按可用宽度自动铺满 |
| 详情 | 图标不显示 hover 提示；图标网格点击后打开右侧抽屉并放大图标（NPC / Buff 为 128×128）。表格行本身不可点、不显示手型，hover 行右侧出现「查看详情」按钮，点击按钮才开抽屉。 |
| 最近搜索 | 按数据源分开记（NPC：`tswui:npcs:searchHistory`；图格 / 墙：`tswui:tiles:searchHistory`；Buff：`tswui:buffs:searchHistory`），规则见 `docs/功能-搜索记录.md` |

---

## 5. 搜索框

进入页面会**自动聚焦**搜索框（`searchRef`），但**聚焦本身不弹「最近搜索」**——否则一进页面就有一层菜单
盖住结果。条数 / 去重 / 打开时机等**统一规则见 [`功能-搜索记录.md`](功能-搜索记录.md)**，本页只记自己的部分：

- 防抖 150ms；占位符 `名称 / ID`；NPC 另支持内部名、`/sb` 参数与别名；
- 实现走 `components/SearchInput.tsx`（`historyOnFocus` 默认 `false`、`historyToggle` 默认 `true`、`onHistoryRemove`）；
- 点输入框外、按 Esc、点某条记录、清空（✕）都会收起下拉。

---

## 6. 召唤 / 增益指令：详情里显示 + 补全里可读

**详情底部**按「左属性名 / 右指令 + 复制」的左右布局显示（`components/dataid/DataIdViews.tsx` 的 `CommandRow`）：

| 详情 | 行 | 指令 | 显示条件 |
| --- | --- | --- | --- |
| NPC | `Boss召唤指令` | `/spawnboss "<sb>"` | 该 NPC 是 Boss（有 `sb`）**且**有 `tshock.npc.spawnboss` |
| NPC | `NPC召唤指令` | `/spawnmob <id>` | 有 `tshock.npc.spawnmob` |
| Buff | `增益指令` | `/gbuff <你的玩家名> <buffID>` | 有 `tshock.buff.others` |

- **未登录不显示**任何指令行；权限来自 `GET /api/me`（`hooks/useMyPermissions.ts`，按上游缓存，退出登录即失效）。
- 权限匹配遵循 TShock 的通配规则：`*`、`tshock.*`、`tshock.npc.*` 都算拥有子节点（与 `Group.HasPermission()` 一致）。
- **拿不到权限时仍然显示**（老版本信使插件没有 `/webui/me`、或请求失败）：
  只有「已登录 + 明确拿到权限列表 + 确实没有该节点」才隐藏，避免看起来像功能坏了。
  也就是说这层过滤是「少显示确定用不了的」，不是权限边界。
- 权限只决定**是否展示**；真正的执行判定始终在 TShock（`/gbuff` 走 rawcmd，`/sb` / `/sm` 根本不能经 REST 执行）。
- 「指令」页的补全下拉框仍会给出可读名称（`web/src/lib/commandMeta.ts`）：

| 指令 | 语法 | 说明 |
| --- | --- | --- |
| `/sm`（别名 `/spawnmob`） | `/sm <名称\|ID> [数量]` | 任意 NPC；名称含空格加引号，如 `/sm "blue slime"`；数量默认 1 |
| `/sb`（别名 `/spawnboss`） | `/sb <boss> [数量]` | 仅 TShock 支持的 Boss 列表（含 `all` / `*` 一次生成全部） |

- `/spawnboss <boss>`：每个别名旁显示 NPC 名称（`brain` → 克苏鲁之脑；`twins` → 双子魔眼；`all` → 全部 Boss），
  由 `data/npcs.json` 的 `sb` / `sbAliases` + `loc.NPCName` 解析，跟随界面语言。
- 也可按备注名搜索（输入「血月」命中 `bloodmoon`）。
- 更多多级子命令（`/worldevent invasion`、`/pm`、`/wm`、`/fish` 等）见 `docs/功能-指令多级补全与备注.md`。

---

## 7. 自备 NPC 贴图覆盖（可选）

游戏原图里少数 NPC 的第一帧不完整（如 636 光之女皇缺翅膀、657 → 史莱姆皇后缺光泽/头冠、668 → 巨鹿只有上半身）。
当前已登记：`50` King Slime、`400` True Eye of Cthulhu、`551` Betsy、`636`、`657` Queen Slime、`668` Deerclops。
（多列网格的贴图（如 696）已由 `FRAME_GRIDS` 自动取单帧，不需手动覆盖。）可以自己准备图片替换：

1. 把图片放到 `tools/npc-overrides/`（**图片随仓库入库**；文件名不要有空格，用下划线代替）；
2. 在 `tools/npc-overrides.json` 按 NPC id 登记（`file` / 可选 `crop` / `frameWidth` + `frameIndex`）；
3. 跑 `python3 tools/gen-npc-atlas.py` —— 已登记的优先用你的图，其余仍用游戏原图。

格式与示例见 `tools/npc-overrides/README.md`。

---

## 8. 验收

- 进「数据ID」默认是 **NPC** 网格（贴图 + 名称 + ID），搜索框已聚焦，但**不会**自动弹出「最近搜索」。
- 打字后建议下拉出现，可边输边筛、点一条填入；点右侧历史按钮也能展开；点外面 / Esc 收起。
- 「图格」「墙」默认都是图标网格，在页面设置中勾选「表格视图」后为表格；图格还可勾选「展开子 ID」平铺样式。墙图标使用代表物品，名称使用物品本地化名，无代表物品时显示斜体内部名；
  Buff 默认图标网格（96×96，图标底同上），勾选「表格视图」后为 `BuffID / 图标 / 名称 / 内部名` 表格。
- 无翻页器：全部结果一次展示；搜索 / 切 tab / 切筛选都会回到顶部。
- 全屏后仅保留右侧操作坞（页面设置 / 退出全屏，数秒后收成竖条）；图标网格横向铺满。
- 图标网格点击 → 打开右侧抽屉，NPC / Buff 的图标放大到 128×128；图格 / 墙详情的大图底也是 `bg-accent`（与输入框同色）。
- 表格行默认不可点；hover 后点击行右侧「查看详情」按钮才打开抽屉。
- NPC 详情不显示 Boss / `/sb all` 标签；Boss 分类图标统一为默认 64×64。
- 「指令」页输入 `/spawnboss ` 候选中 `brain` 旁显示「克苏鲁之脑」；`/worldevent blood` 旁显示「血月」。
- `cd web && npm run typecheck && npm run lint && npm run test:run`。
