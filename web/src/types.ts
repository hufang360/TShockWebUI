/**
 * 领域类型定义。
 * 数据契约见 data/README.md 与 docs/设计原则与约束.md §3。
 */

export interface Item {
  id: number
  /** 内部名（ItemID 枚举名），如 Zenith；用于搜索与 TShock 英文名回退 */
  key: string
  /** 显示名（当前界面语言）；运行时由 `loc.<culture>.json` 的 `ItemName.<key>` 解析填充 */
  name: string
  /** 实际贴图 id（图集 regions 的键），多数等于 id */
  icon: number
  /** 贴图纵向帧数（1 = 静态） */
  frames: number
  /** 原始贴图尺寸 [宽, 高]（不是单帧尺寸） */
  sprite: [number, number]
  tags: string[]
}

export interface Prefix {
  id: number
  key: string
  /** 显示名（当前界面语言）；运行时由 `loc.<culture>.json` 的 `Prefix.<key>` 解析填充 */
  name: string
}

/** TShock 权限节点（`data/permissions.json`；只是内置/默认集合，允许手输任意值）。 */
export interface PermissionNode {
  node: string
  /** TShock 源码里 `[Description]` 的可读说明。 */
  desc: string
}

/** `data/permissions.json` 的形状。 */
export interface PermissionsData {
  meta: {
    tshockVersion: string
    permissionCount: number
    groupCount: number
    source: string
    generatedBy: string
    note: string
  }
  permissions: PermissionNode[]
  /** TShock 内置/默认用户组名（自定义组只有运行期知道）。 */
  groups: string[]
}

/** NPC（ID → 内部名；显示名从 loc.NPCName 解析）。 */
export interface Npc {
  id: number
  key: string
  name: string
  /** 英文名（`loc.en-US` 的 `NPCName`）。`/tpnpc` 等只认名字的指令用它，避免依赖服务器语言。 */
  en?: string
  /** `/sb`（spawnboss）可用参数（规范写法，如 `eye of cthulhu`）；仅 TShock 支持的 Boss 有。 */
  sb?: string
  /** `/sb` 的其它别名（如 `eoc` / `eye`）。 */
  sbAliases?: string[]
  /** 是否包含在 `/sb all`（一次生成全部 Boss）里。 */
  sbAll?: boolean
}

/** 图格子 ID（同一 TileID 下的 placeStyle / 样式）。 */
export interface TileStyle {
  subId: number
  /** 该样式的代表物品 id；`null` = 无对应物品。 */
  item: number | null
}

/** 图格 / 墙 ID 表条目（`data/tiles.json` / `data/walls.json`）。 */
export interface TileWallEntry {
  id: number
  /** `TileID` / `WallID` 常量名（语言无关；没有对应物品时作为显示名回退）。 */
  key: string
  /** 放置该图格 / 墙的代表物品 id；`null` = 没有对应物品。 */
  item: number | null
  /**
   * 摆放尺寸 `[宽, 高]`（单位：格），来自游戏 `TileObjectData`。
   * 只有图格（`tiles.json`）有；省略 = 简单方块（1×1）。
   */
  size?: [number, number]
  /** frame-important 但无固定尺寸（树 / 陷阱 / 铁轨…）：显示「无固定尺寸」而不是 1×1。 */
  frameImportant?: true
  /** 同一 TileID 下的子 ID（样式）；只有多样式图格才有。 */
  styles?: TileStyle[]
  /** 展开子 ID 时由前端合成：当前行的样式下标。 */
  subId?: number
  /** 展开子 ID 时由前端合成：该样式对应物品 id。 */
  styleItem?: number | null
}

export interface TileWallData {
  meta: {
    gameVersion: string
    count: number
    withItem: number
    withSize?: number
    source: string
    generatedBy: string
    note: string
  }
  entries: TileWallEntry[]
}

/** Buff（ID → 内部名；显示名从 loc.BuffName 解析）。 */
export interface Buff {
  id: number
  key: string
  name: string
}

export interface RecipeIngredient {
  id: number
  stack: number
  /** 属于某个配方组（如 Wood）时，id 是占位物品，实际可用 group.items 中任意一个。 */
  group?: string
}

export interface Recipe {
  result: { id: number; stack: number }
  ingredients: RecipeIngredient[]
  /** 制作站图格 id（-1 = 徒手）。 */
  station: number
  /** 制作站在物品表中的代表物品（用于显示图标）。 */
  stationItems: number[]
  /** 环境要求：water / honey / lava / snow / graveyard / torchGod / mechdusa */
  env?: string[]
  /** crimson / corruption / notDecraftable */
  flags?: string[]
  /** 嬗变（微光）结果 */
  shimmer?: { id: number; stack: number }[]
}

export interface RecipeGroup {
  /** 游戏本地化 key（如 `ItemName.Wood` / `NPCName.Turtle` / `Lang.misc[85]`） */
  key: string
  items: number[]
}

export interface RecipesData {
  meta: {
    gameVersion: string
    count: number
    groupCount: number
    source: string
    generatedBy: string
  }
  groups: Record<string, RecipeGroup>
  recipes: Recipe[]
  /** itemId -> 产出该物品的配方下标 */
  byResult: Record<string, number[]>
  /** itemId -> 以该物品（含配方组成员）为材料的配方下标 */
  byIngredient: Record<string, number[]>
}

export interface ItemStatEntry {
  /** 工具提示行（按游戏 MouseText_DrawItemTooltip_GetLinesInfo 顺序，不含物品名）。 */
  tip?: string[]
  /** 原始属性（只保留非默认值）。 */
  stats?: Record<string, number | boolean>
}

export interface ItemStatsMeta {
  gameVersion: string
  itemCount: number
  itemsWithTip: number
  source: string
  generatedBy: string
  note: string
}

/** `data/item-stats.json`：只含与语言无关的 `stats`。 */
export interface ItemStatsBaseData {
  meta: ItemStatsMeta
  items: Record<string, { stats?: Record<string, number | boolean> }>
}

/** `data/item-tips.<culture>.json`：只含当前语言的 `tip` 行。 */
export interface ItemTipsData {
  meta: ItemStatsMeta
  items: Record<string, string[]>
}

/** 运行期合并后的物品属性（stats + 当前语言 tip）。 */
export interface ItemStatsData {
  meta: ItemStatsMeta
  items: Record<string, ItemStatEntry>
}

/**
 * 官方本地化文件（游戏原生两级格式 `{分类:{key:值}}`）。
 * 当前只收录运行期用到的分类：ItemName / Prefix / Misc / LegacyMisc / NPCName。
 */
export type LocalizationBundle = Record<string, Record<string, string>>

/**
 * 参数补全来源。只声明本地确实有数据源的类型（见 tools/gen-data.mjs）：
 * player → /api/players；item/prefix → data/*.json；command → 指令名；enum → 自带 values。
 * number / text 没有候选，仅用于界面提示。
 */
export type ParamKind =
  | 'player'
  | 'item'
  | 'prefix'
  | 'enum'
  | 'command'
  | 'npc'
  | 'buff'
  | 'region'
  | 'warp'
  | 'permission'
  | 'group'
  | 'number'
  | 'text'

/** 一条指令参数（来自 TShock 源码的用法串，best-effort；详见 tools/gen-data.mjs 顶部说明）。 */
export interface CommandParam {
  /** 字面子命令（如 group 的 addperm）；与 name 互斥 */
  literal?: string
  name?: string
  required?: boolean
  kind?: ParamKind
  /** kind === 'enum' 时的合法取值 */
  values?: string[]
  /** 可变参数（如 <permissions...>） */
  variadic?: boolean
}

/** 一组参数形态：同一指令的不同子命令写法（如 /group 的 add / addperm / del …）。 */
export interface CommandParamSet {
  /** TShock 源码里的用法串，直接展示给玩家 */
  syntax: string
  args: CommandParam[]
  /** 手写条目的源码出处（如 Commands.cs:4626 Time()） */
  source?: string
  /** 额外说明（如「不加参数 = 查看」），显示在参数提示行。 */
  noteZh?: string
  noteEn?: string
}

export interface CommandDef {
  name: string
  aliases: string[]
  permission: string | null
  help: string
  /** 英文帮助原文（TShock GetString 的 msgid） */
  helpEn?: string | null
  /** 中文帮助（来自 TShock i18n/zh_CN） */
  helpZh?: string | null
  /**
   * 是否允许经 /v3/server/rawcmd 执行。
   * false 的指令在 TShock 端会被直接拒绝（C6），前端必须不发请求。
   */
  allowServer: boolean
  doLog: boolean
  /**
   * 参数表。**只有**能从 TShock 源码可信提取时才存在（95 条里 69 条）；
   * 没有该字段的指令保持自由输入，不做任何参数猜测。
   */
  paramSets?: CommandParamSet[]
}

export interface DatasetMeta {
  gameVersion: string
  tshockVersion: string
  itemCount: number
  prefixCount: number
  commandCount: number
  spriteCount: number
  textureCopyCount: number
  generatedBy: string
  sources: Record<string, string>
}

export interface AtlasMeta {
  gameVersion: string
  width: number
  height: number
  limitWidth: number
  padding: number
  textures: number
  items: number
  sheet: string
  /** 图集 PNG 内容哈希（缓存失效用；见 `lib/atlas.ts`）。 */
  hash?: string
  generatedBy: string
  note: string
}

/** regions[贴图id] = [x, y, 单帧宽, 单帧高] */
export type AtlasRegions = Record<string, [number, number, number, number]>

export interface Atlas {
  meta: AtlasMeta
  regions: AtlasRegions
}

/** 玩家角色图集：`b:<variant>:<part>:<role>` 为角色部件，`h:<hair>` 为发型。 */
export interface PlayerAtlasMeta {
  gameVersion: string
  width: number
  height: number
  limitWidth: number
  padding: number
  frameWidth: number
  frameHeight: number
  variants: number
  hairs: number
  regions: number
  sheet: string
  /** 图集 PNG 内容哈希（缓存失效用）。 */
  hash?: string
  generatedBy: string
  note: string
}

export interface PlayerAtlas {
  meta: PlayerAtlasMeta
  regions: AtlasRegions
}

/** NPC 图集（`data/npc-atlas.json`）：`regions[npcId] = [x, y, w, h]`。 */
export interface NpcAtlas {
  meta: {
    gameVersion: string
    width: number
    height: number
    limitWidth: number
    padding: number
    count: number
    missing: number
    sheet: string
    /** 图集 PNG 内容哈希（缓存失效用）。 */
    hash?: string
    generatedBy: string
    source: string
    note: string
  }
  regions: AtlasRegions
}

/** Buff 图标图集（`data/buff-atlas.json`）：`regions[buffId] = [x, y, w, h]`（静态图标，无动画帧）。 */
export interface BuffAtlas {
  meta: {
    gameVersion: string
    width: number
    height: number
    limitWidth: number
    padding: number
    count: number
    missing: number
    sheet: string
    /** 图集 PNG 内容哈希（缓存失效用）。 */
    hash?: string
    generatedBy: string
    source: string
    note: string
  }
  regions: AtlasRegions
}

/** 创意菜单页签（游戏 `Terraria.GameContent.Creative.ItemFilters` 的过滤器列表）。 */
export interface ItemGroupTab {
  /** 前端 i18n 键后缀：`dex.tab.<id>` */
  id: string
  /** 游戏本地化 key（如 `CreativePowers.TabWeapons`），保留出处 */
  label: string
}

/** 单个物品的分组信息（游戏 `GetItemGroup` / `ItemCreativeSortingId`）。 */
export interface ItemGroupEntry {
  /** `ItemGroup` 枚举名（语言无关，如 `MeleeWeapon`） */
  g: string
  /** `ItemGroup` 枚举值（用于按游戏自身顺序排序） */
  gv: number
  /** 组内顺序（`OrderInGroup`，`ByCreativeSortingId` 排序用） */
  o: number
  /** 所属页签下标（对应 `tabs` 的索引；一个物品可属于多个页签） */
  t: number[]
}

/** `data/item-groups.json`：游戏创意菜单的页签与每件物品的分组。 */
export interface ItemGroupsData {
  meta: {
    gameVersion: string
    itemCount: number
    tabCount: number
    source: string
    generatedBy: string
    note: string
  }
  tabs: ItemGroupTab[]
  /** itemId -> 分组信息 */
  items: Record<string, ItemGroupEntry>
}

/** 词缀数值修正（`Item.cs TryGetPrefixStatMultipliersForItem`，与物品无关）。 */
export interface PrefixMods {
  dmg?: number
  kb?: number
  spd?: number
  size?: number
  shtspd?: number
  mcst?: number
  crt?: number
  tagdmg?: number
  arpen?: number
  /** 游戏自身的词缀评分（`Item.BestPrefixValue` 用它取「顶级词缀」）。 */
  val?: number
  /** 饰品词缀的精确效果（`Player.GrantPrefixBenefits` / `Main.cs:21405`）。 */
  benefit?: { key: 'defense' | 'mana' | 'crit' | 'damage' | 'moveSpeed' | 'meleeSpeed'; value: number }
}

/** `data/item-drops.json`：木匣等可开启物品的一次掉落（运行时模拟，chance 为实测概率）。 */
export interface ItemDropEntry {
  id: number
  /** 开出至少 1 个的概率（meta.trials 次模拟的实测值，非源码分数）。 */
  chance: number
  minStack: number
  maxStack: number
}

/** `data/item-drops.json`。 */
export interface ItemDropsData {
  meta: {
    gameVersion: string
    trials: number
    source: string
    generatedBy: string
    note: string
  }
  /** itemId -> 掉落列表 */
  items: Record<string, ItemDropEntry[]>
}

/** `data/prefix-sets.json`：每件物品可滚词缀（来自 `Item.GetRollablePrefixes()`）。 */
export interface PrefixSetsData {
  meta: {
    gameVersion: string
    setCount: number
    itemCount: number
    source: string
    generatedBy: string
    note: string
  }
  sets: number[][]
  items: Record<string, number>
}

/**
 * `data/tile-names.json`：图格 → **地图图例名来源**（来自 `Terraria/Lang.cs` 的 `BuildMapAtlas()`）。
 *
 * 世界里生成、玩家不能放置的图格（生命水晶、罐子、影球…）没有「代表物品」，
 * 名字只能靠这张表：`items` 指物品 id（用 `loc.ItemName` 解析），`objects` 指 `MapObject` 键
 * （用 `loc.MapObject` 解析）；两者都没有才回退 `tiles.json` 的常量名。
 */
export interface TileNamesData {
  meta: {
    gameVersion: string
    source: string
    generatedBy: string
    itemCount: number
    objectCount: number
    note: string
  }
  /** 图格 id → 物品 id。 */
  items: Record<string, number>
  /** 图格 id → `MapObject` 键。 */
  objects: Record<string, string>
}

/** `data/prefix-mods.json`。 */
export interface PrefixModsData {
  meta: { count: number; source: string; generatedBy: string; note: string }
  mods: Record<string, PrefixMods>
}

/** `data/shimmer.json`：微光转换（源物品 id → 目标物品 id）。 */
export interface ShimmerData {
  meta: {
    gameVersion: string
    itemCount: number
    count: number
    source: string
    generatedBy: string
    note: string
  }
  items: Record<string, number>
}

export interface Dataset {
  meta: DatasetMeta
  items: Item[]
  prefixes: Prefix[]
  npcs: Npc[]
  /** `data/tiles.json`：图格 ID 表 */
  tiles: TileWallData
  /** `data/walls.json`：墙 ID 表 */
  walls: TileWallData
  /** `data/tile-names.json`：图格 → 地图图例名来源 */
  tileNames: TileNamesData
  /** tiles.id -> tile */
  tilesById: Map<number, TileWallEntry>
  /** tiles.id -> 显示名（MapObject → 代表物品名 → 常量名，与游戏地图图例口径一致） */
  tileNameById: Map<number, string>
  /** walls.id -> wall */
  wallsById: Map<number, TileWallEntry>
  buffs: Buff[]
  commands: CommandDef[]
  atlas: Atlas
  recipes: RecipesData
  itemStats: ItemStatsData
  /** 游戏创意菜单的物品分组（页签 + 每件物品的 ItemGroup） */
  itemGroups: ItemGroupsData
  /** 微光转换（源 → 目标） */
  shimmer: ShimmerData
  /** 词缀数值修正 */
  prefixMods: PrefixModsData
  /** prefixId -> 修正 */
  prefixModsById: Map<number, PrefixMods>
  /** 每件物品可滚词缀 */
  prefixSets: PrefixSetsData
  /** 木匣等可开启物品的掉落（运行时模拟） */
  itemDrops: ItemDropsData
  /** itemId -> 掉落列表（木匣等，没有则不收录） */
  itemDropsById: Map<number, ItemDropEntry[]>
  /** itemId -> 可滚词缀 id 列表（没有则不收录，如盔甲） */
  rollablePrefixesById: Map<number, number[]>
  /** itemId -> 微光转换目标 */
  shimmerToById: Map<number, number>
  /** itemId -> 可微光转换为此物品的源物品列表 */
  shimmerFromById: Map<number, number[]>
  /** 当前语言的官方本地化（用于解析配方组名等）。 */
  loc: LocalizationBundle
  /** items.id -> item */
  itemsById: Map<number, Item>
  /** prefixes.id -> prefix */
  prefixesById: Map<number, Prefix>
  /** npcs.id -> npc */
  npcsById: Map<number, Npc>
  /** `data/permissions.json`：权限节点 + 内置用户组名（补全用） */
  permissions: PermissionsData
  /** buffs.id -> buff */
  buffsById: Map<number, Buff>
  /** 小写 name / alias -> command */
  commandsByToken: Map<string, CommandDef>
}

/** 前端统一的指令执行结果模型（设计原则与约束 §5）。 */
export type CommandStatus =
  | 'ok'
  /** 指令不存在（多为提供该指令的插件未安装）；首页内置卡片据此隐藏。 */
  | 'command_not_found'
  | 'command_error'
  | 'no_permission'
  | 'token_invalid'
  | 'unavailable'
  | 'timeout'
  | 'bad_response'
  | 'rate_limited'
  | 'rejected'

export interface CommandResult {
  status: CommandStatus
  /** TShock 返回的命令输出行 */
  output: string[]
  /** 面向玩家的提示 */
  message?: string
  /** 最近一次执行完成的时间（本地时间戳，ms）；由结果存储统一写入，不来自 TShock。 */
  ts?: number
}

export interface HistoryEntry {
  cmd: string
  ts: number
  ok: boolean
  status: CommandStatus
}

/**
 * 收藏的指令（localStorage `tswui:favorites`）。
 * 只保存指令文本与收藏时间，不自动执行（设计原则与约束 §4.6）。
 */
export interface FavoriteEntry {
  cmd: string
  ts: number
}

/**
 * 收藏的物品（localStorage `tswui:itemFavorites`）。
 * 在物品图鉴里收藏后，会出现在「指令」模块的「收藏」tab。
 */
export interface ItemFavorite {
  id: number
  ts: number
}

/**
 * 收藏的合成记录（localStorage `tswui:recipeFavorites`）。
 * `key` 由配方内容算出（见 `lib/recipeFavorites.ts` 的 `recipeFavoriteKey`），
 * 不存下标：数据重新生成后下标会整体错位，内容键则能继续对上同一条配方。
 * 在合成表条目 hover 时点 ⭐ 收藏，出现在「指令」模块的「收藏 → 合成表」tab。
 */
export interface RecipeFavorite {
  key: string
  ts: number
}

/**
 * 仅用于渲染缓存的本地用户信息（设计原则与约束 §4.6）。
 * 绝不含 token；真实登录态以 `GET /api/session` 为准。
 */
export interface Me {
  username: string
  savedAt: number
}

/** 已解析出的物品标签（[i:...]）。 */
export interface ParsedItemTag {
  raw: string
  start: number
  end: number
  itemId: number
  stack?: number
  prefixId?: number
}

/** 主题：`auto` 跟随系统（`prefers-color-scheme`），`light` / `dark` 强制。 */
export type ThemeName = 'light' | 'dark' | 'auto'

/** 界面语言。 */
export type Lang = 'zh' | 'en'

export interface Settings {
  theme: ThemeName
  fontSize: number
  showIcons: boolean
  /** 插入标签时是否附带数量（[i/sN:ID]） */
  insertWithCount: boolean
  /** 是否处于真实服务器模式（阶段 1 恒为 false，Mock 必须显式标注） */
  liveMode: boolean
  /** 界面语言 */
  language: Lang
  /** 紧凑视图：收紧内容区间距（默认开）。 */
  compact: boolean
  /** 指令执行队列的间隔（毫秒，0 = 不间隔）。 */
  commandInterval: number
  /** 页面数据自动刷新间隔（毫秒，0 = 不自动刷新）；控制首页/鱼店卡片与货架。 */
  refreshInterval: number
  /** 服务器动态刷新间隔（毫秒）；1 分钟仅 GM / superadmin / vip 可选。 */
  eventsRefreshInterval: number
}

export interface UiState {
  activeTab: TabId
  sidebarCollapsed: boolean
}

// 内置 tab + 自定义模块 id（`m:<uuid>`）；`(string & {})` 保留字面量提示。
export type TabId =
  | 'home'
  | 'editor'
  | 'chat'
  | 'commands'
  | 'items'
  | 'dataid'
  | 'save'
  | 'worldview'
  | 'spritesheet'
  | 'players'
  | 'store'
  | 'requisition'
  | 'world'
  | 'settings'
  | (string & {})

export interface OnlinePlayer {
  name: string
  /** 阶段 1 为 Mock 数据 */
  mock: boolean
}
