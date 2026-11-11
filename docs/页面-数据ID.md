# 数据 ID（DataIdPage）

文档版本：1.10
对应页面：`web/src/pages/DataIdPage.tsx`（导航「数据 ID」，tab id `dataid`）
相关数据：`data/npcs.json`、`data/tiles.json`、`data/walls.json`、`data/buffs.json`、`data/items.json`、
`data/loc.<culture>.json`（`NPCName` / `ItemName` / `BuffName`）、`data/npc-atlas.json` / `.png`、
`data/buff-atlas.json` / `.png`
相关代码：`web/src/components/NpcSprite.tsx`、`web/src/components/ItemIcon.tsx`、`web/src/components/BuffIcon.tsx`、
`web/src/lib/npcAtlas.ts`、`web/src/lib/buffAtlas.ts`、`web/src/lib/npcCollections.ts`、`web/src/components/SearchInput.tsx`、
`web/src/lib/pagination.ts`、`web/src/hooks/usePageScroll.ts`、`web/src/hooks/useSearchHistory.ts`

> 本文件描述「数据 ID」（代码页 `DataIdPage`）的定位、布局、数据来源与验收方式。它是原「NPC 图鉴」（`NpcDexPage`）与
> 「数据 ID」（`TileWallPage`）**合并后的单页**：**同一套网格组件，只是数据源不同**。

---

## 1. 定位与范围

玩家侧的**只读浏览工具**：在同一个页面里切换 NPC / 图格 / 墙 / Buff，按网格 / 表格浏览，点开看详情。

- **不是**生成 / 管理后台；本页**不执行任何指令**（只读浏览），唯一请求是登录后拉一次 `GET /api/me`
  （只用于 Buff 详情的 `/gbuff`：那条要填「你的玩家名」，未登录时填不出来）。
- `/sb`（`spawnboss`）与 `/sm`（`spawnmob`）在 TShock 里是 `allowServer=false` 的指令，
  经 REST 无法执行（`docs/REST_API限制.md`）→ 详情里只**显示 + 复制**（**不按权限隐藏**，能不能执行由 TShock 判）；
  `/gbuff`（给 buff）是 `allowServer=true`，可以复制到「指令」浮窗里直接执行。
- 图格 / 墙是 `TileID` / `WallID` 速查：ID、代表物品（图标 + 名称）、摆放尺寸、内部名。
- Buff 是 `BuffID` 速查：ID、图标、本地化名称、内部名（图标取自游戏 `Content/Images/Buff_<id>.png`，见 §2）。
- 旧的 tab id（`npcs` / `tiles`，以及改名前用的 `codex`）在 `App.tsx` 里做兼容映射到 `dataid`，老用户的侧边栏记忆不会失效。

---

## 2. 数据来源

| 数据 | 文件 | 说明 |
| --- | --- | --- |
| NPC | `data/npcs.json` | `{ id, key, en, sb?, sbAliases?, sbAll? }`，694 条；中文名不落盘（`en` 落盘：`/tpnpc` **只认名称**，用英文名不受服务器语言影响） |
| NPC 名称 | `data/loc.<culture>.json` | 官方本地化 `NPCName.<key>`，按界面语言加载 |
| NPC 贴图 | `data/npc-atlas.json` / `.png` | `regions[npcId] = [x, y, w, h]`（第一帧），懒加载 |
| NPC 分类 | `web/src/lib/npcCollections.ts` | 手工维护：分类名 + 里面的 NPC id（来源见该文件注释） |
| NPC 相关指令 | `web/src/lib/npcRelatedCommands.ts` | 详情「相关指令」的拼装 + 可切换解救状态的 NPC id（来源见该文件注释） |
| 图格 | `data/tiles.json` | `{ id, key, item, size?, frameImportant? }`，754 条 |
| 墙 | `data/walls.json` | `{ id, key, item }`，367 条（墙没有尺寸概念） |
| 图格 / 墙名称 | `data/loc.<culture>.json` | 代表物品的 `ItemName.<key>`；没有代表物品时回退内部名 |
| NPC 英文名 | `data/npcs.json` 的 `en`（生成自 `loc.en-US` 的 `NPCName`） | NPC 表格最后一列 / 详情里的英文名；缺失回退内部名 |
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
│ 页面设置                                            ↺ 恢复默认 │
│ 视图：表格视图 / 两列表格                                        │
│ ─────────────────────────────────────────────────────────────── │
│ 参考数据：展开子 ID                                             │
│ NPC ID / 数据 ID / 图格 ID / 墙 ID / 增益 ID                    │
└──────────────────────────────────────────────────────────────────┘
┌ 列表（整页滚动，不套白色卡片；无翻页，一次展示全部）────────────┐
│ ┌──┐┌──┐┌──┐…  NPC / 图格 / Buff 默认图标网格                    │
└──────────────────────────────────────────────────────────────────┘
```

- 布局**沿用物品 ID**：工具行不套卡片、列表**不套白色卡片**、**无翻页器**；
  页面**不固定高度、整页滚动**（滚动条是浏览器右侧那条），工具条（数据源 Tab + 搜索 / 筛选）`sticky top-12` 吸在顶栏下面，
  表头再吸在工具条下面（`--page-sticky-top`）。规则见 `docs/UI组件.md` 的「整页滚动」。
- 数据源 tablist 独立放在页面顶部，**不包在 Card 内**（shadcn `Tabs` 的 **line 变体**）。
- NPC 分类由下拉框改为胶囊 Tabs，位于工具行右侧；**「页面设置」与「全屏」按钮在内容区顶栏右侧**（`TopBarActions`），不再占工具行。
- **NPC / 图格 / 墙 / Buff 都支持两种视图**：默认**图标网格**；在同一个「页面设置」Popover 中勾选「表格视图」后切为表格。
- 所有页面设置（表格视图 / 导出表格 / 两列表格 / 展开子 ID / 全部 Wiki 链接）都在**同一个 Popover**，不再按 tab 分开展示或切换内容。
  标题栏右侧是「恢复默认」图标按钮：把隐藏 ID 和名称 / 表格视图 / 两列表格 / 展开子 ID 一次性改回默认（数据源 tab、搜索词、分类不动）；打开弹框时焦点落在第一个设置项上。
- 网格图标保留低对比背景格；**表格视图图标不铺背景、不加描边**。
- **图标网格的统一外观**：格子固定 **120 宽**（`w-30`），上方图标底 **120×120**（`size-30`）、`bg-accent`（与搜索框 / 输入框同色）、**无描边**；
  下方 ID / 名称在 120 宽内截断（`truncate`）；行间距 16px（`gap-y-4`）。
  列间距由 `components/dataid/IconGrid.tsx` 动态计算：先按最小 8px 算列数，再把「容器宽 − 列数 × 120」均摊给列间距（8–32px），
  让最后一列贴住右边缘、格子始终 120 方形；均摊后仍有明显剩余（手机上只能放 2 列）时网格整体居中。
  实测：1440 宽 → 8 列 / 间距 22px；390 宽 → 2 列 / 间距 32px 且居中。
  hover 时**整格（图标 + 文字）一起上浮 2px**，但**变色只发生在 120×120 的图标底上**（`group-hover/cell:bg-primary/10`）。
- **NPC 图标网格**：格子 = 贴图 + ID 一行（像素字体、弱色、**不带 `#`**）+ 名称一行（`truncate`）；贴图绘制区 **96×96**（详情里放大）
  （`DataIdPage` 的 `THUMB_SIZE` / `THUMB_SIZE_BOSS`），列数也相应减少。
- **响应式列数使用容器查询**：普通 NPC / 图格 / Buff 随内容区宽度按 4 → 6 → 8 → 10 列递增；侧栏展开时按剩余内容宽度收缩，不会误用视口断点排成过密网格。
- **图格图标网格**：代表物品图标 96×96（放在 120 的图标底里）+ TileID + 名称；多样式显示 `N 种`；点击打开抽屉。
- **贴图按游戏原生大小画（只缩不放）**：`NpcSprite` 默认 `mode='game'`，贴图 < 方框时按 1:1
  像素绘制（萤火虫就是 10×16、城镇 NPC 就是 40×56），只有超过方框才等比缩小。
- **图格 / 墙切到表格后**：
  - 列：`ID / 图标 / 名称 / 尺寸（仅图格）/ 内部名`（列名统一是 `ID`，不再带 `TileID` / `WallID` 前缀）；
  - **图标列**在 ID 左边：用代表物品的图标（复用物品图集，`ItemIcon` size 24）；没有代表物品时灰色占位。
  - **尺寸列**（仅图格）：只显示非 1×1 的格子（如 `1×2` / `2×2`），带浅色底；1×1 与无固定尺寸的不显示。
  - **表头不铺白底**：用页面背景色（`bg-background/90` + 模糊）吸顶，不再是一块白色。
  - **「两列表格」 checkbox（默认选中）在页面设置的「视图」区**：开启且行数 > 8 时，
    `xl` 排成左右两张表；取消勾选就只一张表。**NPC / 图格 / 墙 / Buff 四张表都受它控制**。
  - **小屏（< 1280px）隐藏该开关并强制单列**：两列表格只在 `xl` 真正生效，小屏本来就只有一列。
  - **子 ID（样式）**：同一 TileID 下有多个 placeStyle 的行，名称旁显示 `N 种` 徽标；
    详情抽屉新增「子 ID / 样式」列表（`21-0 木箱` / `21-1 金箱`…）。勾选「展开子 ID」可把样式平铺成独立行，
    搜索支持 `21-1` 或样式物品名。
  - 奇数行斑马纹（`odd:bg-muted/25`）、hover / 键盘聚焦高亮、圆角质表框；名称无代表物品时用等宽弱色斜体标注。
- **NPC 表格视图**：列 `ID / 图标 / 名称 / 英文名`——最后一列显示**英文名**（`Npc.en`，来源 `loc.en-US` 的 `NPCName`；
  它是 `/sb`、`/tpnpc` 认的那个名字，内部名对人没用），英文界面下这一列改回**内部名**。NPC 表格与图格 / 墙 / Buff 一样受「两列表格」开关控制。
- **Buff 表格视图**：列 `ID / 图标 / 名称 / 内部名`；沿用「两列表格」开关。
- **表头与列一一对应**：`<colgroup>` 的 `<col>` 数量必须等于 `<th>` 数量（`table-fixed` 下列为宽度来源；
  多一个少一个都会让表头横向错位）。表框用 `overflow-clip` 而非 `overflow-hidden`：
  `overflow-hidden` 会让表框自己变成 sticky 的滚动容器，表头会「下沉」（实测 144px）。
- **表格整行可点**：`cursor-pointer` + hover / 键盘聚焦高亮，点行（或聚焦后 Enter / 空格）直接开右侧抽屉；
  行尾不再有「眼睛」按钮（`lib/rowSelect.ts` 的 `selectableRow()` 提供事件）。
- **详情**：图标网格或表格行都打开**右侧抽屉**（`Sheet side="right"`，宽 `sm:max-w-sm`）；
  图标网格与抽屉里 NPC / Buff 图标放大到 128×128，名称 / ID / 英文名（非英文界面）/ 内部名 / 相关指令（去掉了冗余说明文字）。
- **抽屉是「只盖内容区」的**（桌面端）：`modal={false}` + 共享的 `ContentScrim`（半透黑 50%、不模糊、`z-[45]`），
  左侧边栏不被压暗、可点，所以抽屉开着也能直接切到别的页面；点遮罩关闭，点导航不关，
  「展开侧栏」按钮浮在遮罩上（详见 `docs/UI组件.md` 的「浮层」一节）。窄屏仍是自带遮罩的模态抽屉。
- **切页面回来抽屉还在**：`{ kind, id }` 记进 `lib/dataIdState.ts` 的模块内存（与数据源 tab / 筛选 / 滚动位置同一套），
  回到本页时照旧打开；关掉之后不再弹。刷新页面按既有策略回到默认（不弹详情）。
- **Wiki 链接**：在页面设置 Popover 的当前数据源分区，按当前语言显示中文 / 英文站点；NPC 同时给出「NPC ID」与「数据 ID」两个入口。
- **详情**：NPC / Buff 点格子或行 → **右侧抽屉**（图标 **128×128**，名称 / ID / 英文名（非英文界面）/ 内部名 / 相关指令，去掉了冗余说明文字）；
  图格 / 墙用同一个抽屉（`Sheet side="right"`）。

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
| 页面状态记忆 | 数据源 tab / NPC 分类 / 两列表格 / 表格视图 / 滚动位置 / **打开着的详情**记在**模块内存**（`lib/dataIdState.ts`）：切页面回来会还原，**刷新页面重置** |
| 全屏 | 点击全屏后隐藏 Tabs、搜索、结果数和分类，仅结果区铺满视口；右侧操作坞先是「页面设置 / 退出全屏」，约 4 秒后收成小竖条（悬停 / 聚焦展开），Esc 也可退出。全屏图标网格按可用宽度自动铺满 |
| 详情 | 图标不显示 hover 提示；图标网格点击后打开右侧抽屉并放大图标（NPC / Buff 为 128×128）。表格**整行可点**（指针为手型，键盘 Enter / 空格同样可开），行尾不再有「查看详情」按钮。 |
| 最近搜索 | 按数据源分开记（NPC：`tswui:npcs:searchHistory`；图格 / 墙：`tswui:tiles:searchHistory`；Buff：`tswui:buffs:searchHistory`），规则见 `docs/功能-搜索记录.md` |

---

## 5. 搜索框

进入页面会**自动聚焦**搜索框（`searchRef`），但**聚焦本身不弹「最近搜索」**——否则一进页面就有一层菜单
盖住结果。条数 / 去重 / 打开时机等**统一规则见 [`功能-搜索记录.md`](功能-搜索记录.md)**，本页只记自己的部分：

- 防抖 150ms；占位符 `名称 / ID`；NPC 另支持内部名、`/sb` 参数与别名；
- 实现走 `components/SearchInput.tsx`（`historyOnFocus` 默认 `false`、`historyToggle` 默认 `true`、`onHistoryRemove`）；
- 点输入框外、按 Esc、点某条记录、清空（✕）都会收起下拉。

---

## 6. 相关指令：NPC 详情里显示 + 补全里可读

NPC 详情 / Buff 详情用 `components/CommandLine.tsx` 列一块 **「相关指令」**（NPC 的行由 `lib/npcRelatedCommands.ts` 生成，顺序固定）。
样式与交互对齐物品详情的「合成」分组：

- 标题可折叠（`Collapsible` + 折角箭头，默认展开），**标题里带条目数量**（`相关指令（6）`，i18n 键 `commandLine.withCount`）；
- 标题左边是 **149 号物品（书）的图标**，标题文字用绿色 `text-success`（与物品详情「相关指令」一致）（`lib/sectionTones.ts`）；
- 每条指令一行，行外观同合成记录（无描边、`bg-accent/40`、悬停 `hover:bg-accent`）；
- **点条目本身什么也不做**（不复制、不执行），右侧三个按钮**悬停或键盘聚焦才出现**（触屏常显），顺序：终端 → ⭐ → 复制：
  - **终端**（提示词就叫「填充指令」）：把指令填进右下角的**浮动终端**并让它弹出来（`useTerminal().open(cmd)`）；
    浮动终端在抽屉下面，所以点完**顺手关掉详情抽屉**（物品详情的堆叠抽屉是整叠一起关）；
  - ⭐ 收藏这条指令（写进「指令」页的收藏 `tswui:favorites`，与结果卡片的星标同一份数据）；
  - 复制：只复制指令。
- 带说明的条目（`note`）悬停整行时出 `Tooltip`：`/sb all` → 「召唤所有Boss」、`/setdungeon` → 「设置地牢点」、
  `/wm dungeon` → 「查看地牢点」、`/give <召唤物>` → 「召唤物品：<物品名>」。

| 行 | 指令 | 显示条件 |
| --- | --- | --- |
| 召唤 Boss | `/spawnboss "<sb>"`；有更短别名时再来一行 `/sb <简写>` | 该 NPC 是 Boss（有 `sb`） |
| 召唤全部 Boss | `/sb all`（悬停提示「召唤所有Boss」） | 该 Boss 被算进 `/sb all`（`data/npcs.json` 的 `sbAll`） |
| 召唤物 | `/give <召唤物ID> <玩家名>`（悬停提示「召唤物品：<名称>」） | 该 Boss 有召唤物（`NPC_SUMMON_ITEM`）**且**已登录（要玩家名） |
| 召唤 NPC | `/sm <ID>`（`/spawnmob` 的别名，写短的） | 总是显示 |
| 传送 | `/tpnpc "<英文名>"`（无空格不加引号） | `NPC_TOWN_IDS`（城镇 NPC）或 `NPC_TP_EXTRA_IDS`（379、438）；`/tpnpc` **只认名称** |
| 改名 | `/renameNPC <ID> <newname>` | 只在 `NPC_TOWN_IDS`（**城镇 NPC**）里；新名字留 `<newname>`，玩家复制后自己替换 |
| 地牢坐标点 | `/setdungeon`（设置）/ `/wm dungeon`（查看） | 只在 `NPC_DUNGEON_IDS` 里 |
| 解救 / 购买状态 | `/npc <ID>` | 只在 `NPC_STATE_TOGGLE_IDS` 里的 NPC（渔夫 / 哥布林工匠 / 机械师 / 发型师 / 酒馆老板 / 高尔夫球手 / 巫师 / 税收官 / 猫 / 狗 / 兔兔 / 1.4.4.5 的 8 只史莱姆，含各自的「未解救形态」ID） |

数据来源：`/spawnboss` 的合法参数来自 `data/npcs.json` 的 `sb` / `sbAliases`（`SpawnBoss()` 的 `switch`）；
`/renameNPC` 的语法取自 `data/commands.json` 的 `paramSets`（`renameNPC <guide, nurse, etc.> <newname>`），
而**只有城镇 NPC** 才能改名 —— TShock `RenameNPC()` 只改 `Main.npc[i].townNPC == true` 的实例。
参数用 **ID 而不是名字**：`RenameNPC()` 走 `Utils.GetNPCByIdOrName()`，名字取「首个完全匹配」，
`Bunny`（城镇兔兔 656）会先命中 46 号小动物兔子、`Golfer` 同时对应 588/589，按名字会改错或报 “Could not rename”。

`townNPC` 由 Terraria `NPC.SetDefaults()` 逐类型赋值，所以 `NPC_TOWN_IDS` 就是这些类型
（`17,18,19,20,22,37,38,54,107,108,124,142,160,178,207,208,209,227,228,229,353,368,369,441,550,588,633,637,638,656,663,670,678…684`；
受缚 / 沉睡 / 被网 / 昏迷形态不算）；
`/npc` 的可切换清单来自服务器上该指令的 `switch`（见 `lib/npcRelatedCommands.ts` 注释）。

> `/npc` 与 `/wm dungeon` 不在 `data/commands.json`（那份由 TShock 源码生成）里，说明它们不是 TShock 内置指令，
> 而是服主装的插件提供的；没装插件时这两行执行会失败（其它行不受影响）。
> `/setdungeon` 是 TShock 内置（`tshock.world.setdungeon`，见 `data/commands.json`）。

### 6.1 手工维护的 ID 清单（陆续补充）

本节的清单是**手工维护**的，都写在 `web/src/lib/npcRelatedCommands.ts` 顶部常量里，加 ID 时改那里并同步本表。

**① 有 `/setdungeon` + `/wm dungeon`（地牢坐标点）的 NPC** —— `NPC_DUNGEON_IDS`

| NPCID | 名称 | 说明 |
| --- | --- | --- |
| 37 | 老人（Old Man） | 地牢门口的旧人 |
| 54 | 服装商（Clothier） | 地牢里救出 |
| 68 | 地牢守卫（Dungeon Guardian） | 进入地牢深处前 |
| 379 | 邪教徒弓手（Cultist Archer） | 地牢入口的邪教徒 |
| 437 | 神秘碑牌（Mysterious Tablet） | 邪教徒仪式 |
| 438 | 拜月教忠徒（Lunatic Devotee） | 邪教徒仪式 |
| 439 | 拜月教邪教徒（Lunatic Cultist） | Boss |

**② 额外给 `/tpnpc` 的非城镇 NPC** —— `NPC_TP_EXTRA_IDS`

| NPCID | 名称 |
| --- | --- |
| 379 | 邪教徒弓手（Cultist Archer） |
| 438 | 拜月教忠徒（Lunatic Devotee） |

另：**城镇 NPC 39 个**（`NPC_TOWN_IDS`）都给 `/tpnpc`，见上面 §6 的列表。

**③ 有 `/spawnboss`（+ `/sb`）的 Boss** —— 来自 `data/npcs.json` 的 `sb`（由 `SpawnBoss()` 的 `switch` 自动生成，**不是手写的**）

| NPCID | 名称 | `/spawnboss` 参数 | 在 `/sb all` 里 | 召唤物（`/give`） |
| --- | --- | --- | --- | --- |
| 4 | 克苏鲁之眼 | `eye of cthulhu` | ✓ | 可疑眼球（43） |
| 13 | 世界吞噬怪 | `eater of worlds` | ✓ | 蠕虫诱饵（70） |
| 35 | 骷髅王 | `skeletron` | ✓ | — |
| 50 | 史莱姆王 | `king slime` | ✓ | 史莱姆王冠（560） |
| 113 | 血肉墙 | `wall of flesh` | — | 向导巫毒娃娃（267） |
| 125 | 激光眼 | `twins` | ✓ | 机械魔眼（544） |
| 126 | 魔焰眼 | `twins` | ✓ | 机械魔眼（544） |
| 127 | 机械骷髅王 | `skeletron prime` | ✓ | 机械骷髅头（557） |
| 134 | 毁灭者 | `destroyer` | ✓ | 机械蠕虫（556） |
| 222 | 蜂王 | `queen bee` | ✓ | 憎恶之蜂（1133） |
| 245 | 石巨人 | `golem` | ✓ | 丛林蜥蜴电池（1293） |
| 262 | 世纪之花 | `plantera` | ✓ | — |
| 266 | 克苏鲁之脑 | `brain of cthulhu` | ✓ | 血腥脊椎（1331） |
| 325 | 哀木 | `mourning wood` | — | — |
| 327 | 南瓜王 | `pumpking` | — | — |
| 344 | 常绿尖叫怪 | `everscream` | — | — |
| 345 | 冰雪女王 | `ice queen` | — | — |
| 346 | 圣诞坦克 | `santa-nk1` | — | — |
| 370 | 猪龙鱼公爵 | `duke fishron` | ✓ | 松露虫（2673） |
| 392 | 火星飞碟 | `martian saucer` | — | — |
| 398 | 月亮领主心脏 | `moon lord` | ✓ | 天界符（3601） |
| 422 | 星旋柱 | `vortex pillar` | — | — |
| 439 | 拜月教邪教徒 | `lunatic cultist` | ✓ | — |
| 491 | 荷兰飞盗船 | `flying dutchman` | — | — |
| 493 | 星尘柱 | `stardust pillar` | — | — |
| 507 | 星云柱 | `nebula pillar` | — | — |
| 517 | 日耀柱 | `solar pillar` | — | — |
| 551 | 双足翼龙 | `betsy` | — | — |
| 636 | 光之女皇 | `empress of light` | ✓ | — |
| 657 | 史莱姆皇后 | `queen slime` | ✓ | 明胶水晶（4988） |
| 668 | 独眼巨鹿 | `deerclops` | — | 鹿华（5120） |

**④ 玩家给的「召唤物」全集**（`NPC_SUMMON_ITEM` 只挂了能对上单一 NPC 的那些）

| 物品 | 名称 | 对应 NPC |
| --- | --- | --- |
| 560 | 史莱姆王冠 | 50 史莱姆王 |
| 43 | 可疑眼球 | 4 克苏鲁之眼 |
| 70 | 蠕虫诱饵 | 13 世界吞噬怪 |
| 1331 | 血腥脊椎 | 266 克苏鲁之脑 |
| 1133 | 憎恶之蜂 | 222 蜂王 |
| 5120 | 鹿华 | 668 独眼巨鹿 |
| 4988 | 明胶水晶 | 657 史莱姆皇后 |
| 556 | 机械蠕虫 | 134 毁灭者 |
| 544 | 机械魔眼 | 125 / 126 双子魔眼 |
| 557 | 机械骷髅头 | 127 机械骷髅王 |
| 1293 | 丛林蜥蜴电池 | 245 石巨人 |
| 2673 | 松露虫 | 370 猪龙鱼公爵 |
| 3601 | 天界符 | 398 月亮领主 |
| 267 | 向导巫毒娃娃 | 113 血肉墙 |
| 5334 | 机械缝合体召唤物 | —（同时召出三只机械 Boss，没有单一 NPC） |
| 4271 | 血泪 | —（血月事件） |
| 361 | 哥布林战旗 | —（哥布林入侵） |
| 1315 | 海盗地图 | —（海盗入侵） |
| 2767 | 日耀石板 | —（日食） |
| 602 | 雪球 | —（霜月前哨 / 雪人军团） |
| 1844 | 南瓜月勋章 | —（南瓜月） |
| 1958 | 调皮礼物 | —（霜月） |

- **不探测权限**（与「物品 ID」一致）：本页不请求 `/api/me`，也不把权限当展示门槛 ——
  玩家照常能看到 / 复制（能不能执行始终由 TShock / 插件判）。与「指令小抄」页口径一致；
  `/sb`、`/sm`、`/tpnpc` 甚至根本不能经 REST 执行。
- **英文名**：NPC 详情在「内部名」**上一行**列出英文名（`data/npcs.json` 的 `en`，取自 `loc.en-US` 的 `NPCName`）；
  **英文界面不显示**（那时它就是 NPC 的本名，重复一遍没意义）。
- Buff 详情用同一块「相关指令」：`/gbuff <你的玩家名> <buffID>`（原来叫「增益指令」）。
  它要拼进「你的玩家名」，所以**只按「知道玩家名」决定显示**：`DataIdPage` 从上层拿 `username`
  （未登录传 `null` → 不显示），不再探测 `tshock.buff.others`。
- 物品详情的「物品给予指令」也改成同一块「相关指令」（`/give <物品ID> <玩家名>`），样式与按钮一致。
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
  Buff 默认图标网格（96×96，图标底同上），勾选「表格视图」后为 `ID / 图标 / 名称 / 内部名` 表格。
- 无翻页器：全部结果一次展示；搜索 / 切 tab / 切筛选都会回到顶部。
- 全屏后仅保留右侧操作坞（页面设置 / 退出全屏，数秒后收成竖条）；图标网格横向铺满。
- 图标网格点击 → 打开右侧抽屉，NPC / Buff 的图标放大到 128×128；图格 / 墙详情的大图底也是 `bg-accent`（与输入框同色）。
- 表格**整行可点**（指针手型）：点行即开右侧抽屉（Enter / 空格同样可开），行尾没有「眼睛」按钮；表头与列一一对应、吸顶时不偏移。
- NPC 详情不显示 Boss 徽章（`/sb all` 现在是「相关指令」里的一条）；Boss 分类图标统一为默认 64×64。
  图标格下方仍是原来的两行（`4` + `克苏鲁之眼`）；**详情**图标下方是一行 `#4 克苏鲁之眼`。
- NPC 详情：英文名在「内部名」上一行（英文界面不显示）；「相关指令（n）」按顺序列 Boss 召唤（含 `/sb all`）/
  召唤物（`/give`，登录时）/ `/sm` /（城镇 NPC）传送 + 改名 /（地牢 NPC）`/setdungeon` + `/wm dungeon` / `/npc`；
  带说明的条目（`/sb all`、`/setdungeon`、`/wm dungeon`、`/give`）悬停出 Tooltip。
  点条目本身不复制；悬停行右侧出 终端（填充指令，弹浮动终端并关抽屉）、⭐（收藏）、复制（只复制）。
- 本页不请求 `/api/me`：未登录也能看到全部 NPC 指令；Buff 详情只在「知道玩家名」时给 `/gbuff`。
- `web/src/lib/npcRelatedCommands.test.ts`：Boss / 普通 NPC 的行序、`/npc` 清单、`/renameNPC` 只给城镇 NPC 且用 ID 传参、占位符规则。
- 「指令」页输入 `/spawnboss ` 候选中 `brain` 旁显示「克苏鲁之脑」；`/worldevent blood` 旁显示「血月」。
- `cd web && npm run typecheck && npm run lint && npm run test:run`。
