import { Boxes as BoxesIcon, ShoppingCart as CartIcon, Terminal as TerminalIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ITEM_COLLECTIONS } from '@/lib/collections'
import { searchItems } from '@/lib/items'
import type { SearchIntent } from '@/lib/searchIntent'
import { wallDisplayName } from '@/lib/tiles'
import type { FishGood } from '@/lib/tshock'
import type { CommandDef, Dataset, TabId } from '@/types'

/**
 * 侧栏全局搜索的匹配层：纯函数，不碰 DOM / React，便于单测。
 *
 * 设计取舍（`docs/计划-全局搜索.md` §5）：
 * - **字面匹配**，不做拼音 / 模糊 / 语义；大小写不敏感，`trim` 后为空返回空结果。
 * - 分组顺序**固定**（不按得分重排组），组内按「完全相同 > 前缀 > 包含」再按 id / 名称。
 * - 一级每组最多 `MAX_PER_GROUP` 条，总上限 `MAX_TOTAL`；被截掉的靠组内最后一条「更多」进二级承接。
 * - 二级（`searchGroup`）最多 `MAX_PER_GROUP_DETAIL` 条，再多的才「前往页面」；计数是真实命中数。
 * - 数字查询天然优先命中 ID：各域的 ID 字段参与 `rank`，精确命中的排在最前。
 */

export type SearchGroupId =
  | 'pages'
  | 'commands'
  | 'items'
  | 'npcs'
  | 'buffs'
  | 'tiles'
  | 'walls'
  | 'goods'
  | 'collections'

/** 组的渲染顺序（也是跨组排序）。 */
export const SEARCH_GROUP_ORDER: SearchGroupId[] = [
  'pages',
  'items',
  'commands',
  'npcs',
  'buffs',
  'tiles',
  'walls',
  'goods',
  'collections',
]

/** 一级每组最多展示几条。 */
export const MAX_PER_GROUP = 3
/** 一级面板总共最多展示几条。 */
export const MAX_TOTAL = 12
/** 二级（某组的展开列表）最多展示几条；再多的才「前往页面」。 */
export const MAX_PER_GROUP_DETAIL = 20

/** 行的主操作：物品就地弹详情；其余跳页并预填。 */
export type SearchHitAction =
  | { kind: 'item'; itemId: number }
  | { kind: 'page'; tab: TabId }
  | { kind: 'prefill'; tab: TabId; intent: SearchIntent }

/** 行的图标：物品走物品图集，NPC / Buff 各自图集，页面用 lucide 图标。 */
export type SearchHitIcon =
  | { kind: 'item'; itemId: number }
  | { kind: 'npc'; id: number }
  | { kind: 'buff'; id: number }
  | { kind: 'lucide'; icon: LucideIcon }

export interface SearchHit {
  /** 组内唯一（React key）。 */
  id: string
  group: SearchGroupId
  name: string
  /** 右侧弱化的次要信息（ID / 帮助摘要）。 */
  meta?: string
  /** 行内「复制」的内容（物品 / NPC / Buff / 图格 / 墙的 ID，指令的 `/name`）。 */
  copy?: string
  /** 有值时多一个「填入浮动终端」操作（只有指令有）。 */
  command?: string
  /**
   * 可以直接执行（只有指令有）：`allowServer !== false` 且**没有必填参数**（能裸跑）。
   * 为 false 时回车不替你裸跑：`needsArgs` 的填进浮动终端，其余跳到「指令小抄」看用法。
   */
  runnable?: boolean
  /** 有必填参数（需要先补参数才能跑）：回车改成填入浮动终端而不是执行。 */
  needsArgs?: boolean
  /** `allowServer === false`：只能在游戏内执行（网页不能跑，列表里标红）。 */
  inGameOnly?: boolean
  icon?: SearchHitIcon
  action: SearchHitAction
}

export interface SearchGroup {
  id: SearchGroupId
  /** 最多 `MAX_PER_GROUP` 条。 */
  hits: SearchHit[]
  /** 命中的总数（真实条数）；大于 `hits.length` 时显示「更多」。 */
  total: number
  /** 「更多」进二级；缺省 = 该组不支持展开（页面）。 */
  seeAll?: { tab: TabId; intent?: SearchIntent }
}

/** `searchGroup` 的结果：某组的前 `MAX_PER_GROUP_DETAIL` 条 + 真实命中数。 */
export interface SearchGroupDetail {
  group: SearchGroupId
  hits: SearchHit[]
  /** 真实命中数（不再有扫描上限）。 */
  total: number
  /** 命中数超过二级上限时的跳页出口。 */
  seeAll?: SearchGroup['seeAll']
}

/** 可搜的一个页面（来自 `App` 的侧栏导航，含已激活模块与自定义模块）。 */
export interface SearchPage {
  id: TabId
  label: string
  icon: LucideIcon
}

export interface GlobalSearchSources {
  pages: SearchPage[]
  dataset: Dataset
  /** 鱼店货架（`lib/fishGoodsCache` 里懒加载的那份）；为空时整组不出现。 */
  goods: FishGood[]
}

/** 页面别名：中文习惯叫法 / 英文关键词，帮用户用「搜索」而不是「UI 里的词」找到页面。 */
const PAGE_ALIASES: Partial<Record<TabId, string[]>> = {
  home: ['首页', '主页', 'home', 'homepage'],
  editor: ['指令', '命令', '终端', '聊天', 'command', 'console', 'chat'],
  items: ['物品', '图鉴', '合成', 'id', 'item', 'items', 'craft'],
  dataid: ['数据', 'npc', '怪物', 'buff', '图格', '区块', '墙', 'tile', 'wall', 'id'],
  tables: [
    '表格',
    '种子',
    '世界种子',
    '秘密种子',
    'seed',
    'wiki',
    'table',
    '指令小抄',
    '小抄',
    '帮助',
    '用法',
    'cheat',
    'tip',
  ],
  save: ['存档', '角色', '背包', 'plr', 'player file'],
  worldview: ['世界', '地图', '存档', 'wld', 'world', 'map'],
  players: ['玩家', '背包', '账号', 'player', 'inventory'],
  store: ['鱼店', '商店', '购买', '货架', 'shop', 'store', 'fish'],
  requisition: ['物资', '申请', 'request', 'requisition'],
  world: ['世界管理', 'boss', 'world', '清理'],
  settings: ['设置', '主题', '语言', '字号', 'settings', 'theme', 'language'],
}

/** 0 = 完全相同，1 = 前缀，2 = 包含，-1 = 不匹配（大小写不敏感）。多个字段取最好的一条。 */
export function rank(q: string, ...fields: (string | undefined)[]): number {
  let best = -1
  for (const field of fields) {
    if (!field) continue
    const f = field.trim().toLowerCase()
    const score = f === q ? 0 : f.startsWith(q) ? 1 : f.includes(q) ? 2 : -1
    if (score >= 0 && (best < 0 || score < best)) best = score
  }
  return best
}

interface Scored {
  score: number
  /** 次级排序：数字小的在前（id / 顺序）。 */
  order: number
  hit: SearchHit
}

/** 排序（截断交给调用方：一级按 `MAX_PER_GROUP`，二级按 `MAX_PER_GROUP_DETAIL`）。 */
function collect(rows: Scored[]): Scored[] {
  return rows.sort((a, b) => a.score - b.score || a.order - b.order || a.hit.name.localeCompare(b.hit.name))
}

/** 该指令有没有必填参数（有就不能裸跑，`/give` 这种得先补参数）。 */
function hasRequiredArgs(command: CommandDef): boolean {
  return (command.paramSets ?? []).some((set) => set.args.some((arg) => arg.required))
}

function hit(
  group: SearchGroupId,
  id: string,
  name: string,
  action: SearchHitAction,
  extra: {
    meta?: string
    copy?: string
    command?: string
    runnable?: boolean
    needsArgs?: boolean
    inGameOnly?: boolean
    icon?: SearchHitIcon
  } = {},
): SearchHit {
  return { group, id: `${group}:${id}`, name, action, ...extra }
}

function matchPages(sources: GlobalSearchSources, q: string): SearchHit[] {
  const rows: Scored[] = []
  sources.pages.forEach((page, index) => {
    const aliases = PAGE_ALIASES[page.id] ?? []
    const score = rank(q, page.label, page.id, ...aliases)
    if (score < 0) return
    rows.push({
      score,
      order: index,
      hit: hit('pages', String(page.id), page.label, { kind: 'page', tab: page.id }, {
        icon: { kind: 'lucide', icon: page.icon },
      }),
    })
  })
  return collect(rows).map((r) => r.hit)
}

function matchItems(sources: GlobalSearchSources, q: string): SearchHit[] {
  // 全量给回去（不用 `searchItems` 默认的 30 条）：一级要真实命中数，二级要看够不够 20 条。
  return searchItems(sources.dataset.items, q, Number.POSITIVE_INFINITY).map((item) =>
    hit('items', String(item.id), item.name, { kind: 'item', itemId: item.id }, {
      meta: `#${item.id}`,
      copy: String(item.id),
      icon: { kind: 'item', itemId: item.id },
    }),
  )
}

/** 指令行的前缀：网页习惯 `/`，TShock 游戏内还认 `.`。 */
const COMMAND_PREFIX = /^[/.]/

/** 按名称 / 别名找指令（大小写不敏感）。 */
function findCommand(sources: GlobalSearchSources, name: string): CommandDef | undefined {
  const key = name.toLowerCase()
  return sources.dataset.commands.find(
    (command) =>
      command.name.toLowerCase() === key ||
      command.aliases.some((alias) => alias.toLowerCase() === key),
  )
}

/** 指令右侧那行帮助摘要（和指令组一致）。 */
function summaryOf(command: CommandDef): string | undefined {
  return (command.helpZh || command.help || '').replace(/[。.]$/, '') || undefined
}

/**
 * 「直接跑这一行」：查询写成 `/help 4` / `.help 4` 时给出一个可执行命中。
 *
 * 三种情况不给这个入口，让下面的指令行接管：
 * - 内置指令里 `allowServer === false`（网页本来就不能执行）：照样给一行（标红、不可执行），
 *   回车只是去「指令小抄」看用法；
 * - 不是 `/` / `.` 开头（不要抢普通搜索词）。
 *
 * **必填参数不拦执行**：数据里的 `required` 是从 TShock 源码解析出来的，有些指令（如 `/help`）
 * 被标成必填但实际可省。宁可让 TShock 回一句用法错误（结果页有「查看用法」），也不替用户认定它跑不了。
 *
 * 未收录的指令（插件运行时指令不在本地表里，如 `/wm`）也放行：Tier A 允许未知指令交给 TShock 校验。
 */
export function commandInvocation(
  sources: GlobalSearchSources,
  query: string,
): SearchHit | null {
  const trimmed = query.trim()
  if (!COMMAND_PREFIX.test(trimmed)) return null
  // 压平连续空白：`/help   4` 与 `/help 4` 是同一行。
  const body = trimmed.slice(1).trim().replace(/\s+/g, ' ')
  if (!body) return null
  const [name] = body.split(' ')
  if (!name) return null
  const command = findCommand(sources, name)
  const inGameOnly = command?.allowServer === false
  const line = `/${body}`
  return hit(
    'commands',
    'invocation',
    line,
    { kind: 'prefill', tab: 'tables', intent: { query: command?.name ?? name } },
    {
      meta: command ? summaryOf(command) : undefined,
      copy: line,
      command: line,
      runnable: !inGameOnly,
      needsArgs: command ? hasRequiredArgs(command) : undefined,
      inGameOnly,
      icon: { kind: 'lucide', icon: TerminalIcon },
    },
  )
}

/**
 * 指令组的查询归一：`/help`、`.help`、`/help 4` 都按 `help` 匹配。
 *
 * 只给指令组用——物品 / NPC 的名称里没有 `/` 前缀这回事。
 */
function commandQuery(q: string): string {
  const first = q.split(/\s+/)[0] ?? ''
  const bare = first.replace(COMMAND_PREFIX, '')
  return bare || first
}

function matchCommands(sources: GlobalSearchSources, q: string): SearchHit[] {
  const rows: Scored[] = []
  const cq = commandQuery(q)
  for (const command of sources.dataset.commands) {
    const score = rank(cq, command.name, ...command.aliases, command.help, command.helpZh ?? undefined, command.helpEn ?? undefined)
    if (score < 0) continue
    const needsArgs = hasRequiredArgs(command)
    rows.push({
      score,
      order: command.name.length,
      hit: hit(
        'commands',
        command.name,
        `/${command.name}`,
        { kind: 'prefill', tab: 'tables', intent: { query: command.name } },
        {
          meta: (command.helpZh || command.help || '').replace(/[。.]$/, '') || undefined,
          icon: { kind: 'lucide', icon: TerminalIcon },
          copy: `/${command.name}`,
          command: `/${command.name}`,
          runnable: command.allowServer !== false,
          needsArgs,
          inGameOnly: command.allowServer === false,
        },
      ),
    })
  }
  return collect(rows).map((r) => r.hit)
}

function matchNpcs(sources: GlobalSearchSources, q: string): SearchHit[] {
  const rows: Scored[] = []
  for (const npc of sources.dataset.npcs) {
    const score = rank(q, npc.name, npc.key, npc.en, npc.sb, ...(npc.sbAliases ?? []))
    if (score < 0) continue
    rows.push({
      score,
      order: npc.id,
      hit: hit('npcs', String(npc.id), npc.name, { kind: 'prefill', tab: 'dataid', intent: { kind: 'npc', query: npc.name } }, {
        meta: `#${npc.id}`,
        copy: String(npc.id),
        icon: { kind: 'npc', id: npc.id },
      }),
    })
  }
  return collect(rows).map((r) => r.hit)
}

function matchBuffs(sources: GlobalSearchSources, q: string): SearchHit[] {
  const rows: Scored[] = []
  for (const buff of sources.dataset.buffs) {
    const score = rank(q, buff.name, buff.key)
    if (score < 0) continue
    rows.push({
      score,
      order: buff.id,
      hit: hit('buffs', String(buff.id), buff.name, { kind: 'prefill', tab: 'dataid', intent: { kind: 'buff', query: buff.name } }, {
        meta: `#${buff.id}`,
        copy: String(buff.id),
        icon: { kind: 'buff', id: buff.id },
      }),
    })
  }
  return collect(rows).map((r) => r.hit)
}

/** 图格 / 墙（不含液体：数据 ID 页没有液体入口，搜到也没地方去）。 */
function matchTiles(sources: GlobalSearchSources, q: string): SearchHit[] {
  const { dataset } = sources
  const rows: Scored[] = []
  for (const entry of dataset.tiles.entries) {
    if (entry.id < 0) continue
    const name = dataset.tileNameById.get(entry.id) ?? entry.key
    const score = rank(q, name, entry.key, String(entry.id))
    if (score < 0) continue
    rows.push({
      score,
      order: entry.id,
      hit: hit('tiles', `tile:${entry.id}`, name, { kind: 'prefill', tab: 'dataid', intent: { kind: 'tile', query: name } }, {
        meta: `#${entry.id}`,
        copy: String(entry.id),
        icon: entry.item != null ? { kind: 'item', itemId: entry.item } : undefined,
      }),
    })
  }
  return collect(rows).map((r) => r.hit)
}

function matchWalls(sources: GlobalSearchSources, q: string): SearchHit[] {
  const { dataset } = sources
  const rows: Scored[] = []
  for (const entry of dataset.walls.entries) {
    if (entry.id < 0) continue
    const name = wallDisplayName(dataset, entry.id)
    const score = rank(q, name, entry.key, String(entry.id))
    if (score < 0) continue
    rows.push({
      score,
      order: entry.id,
      hit: hit('walls', `wall:${entry.id}`, name, { kind: 'prefill', tab: 'dataid', intent: { kind: 'wall', query: name } }, {
        meta: `#${entry.id}`,
        copy: String(entry.id),
        icon: entry.item != null ? { kind: 'item', itemId: entry.item } : undefined,
      }),
    })
  }
  return collect(rows).map((r) => r.hit)
}

function matchGoods(sources: GlobalSearchSources, q: string): SearchHit[] {
  const rows: Scored[] = []
  sources.goods.forEach((good, index) => {
    // 名称 / 说明 / 分类标签都参与：鱼店的商品名常常是「[服务] 传送到出生点」这类长串。
    const score = rank(q, good.name, good.desc, ...good.map)
    if (score < 0) return
    rows.push({
      score,
      order: index,
      hit: hit(
        'goods',
        String(good.serial),
        good.name,
        { kind: 'prefill', tab: 'store', intent: { query: good.name } },
        {
          meta: good.cost || undefined,
          icon: good.iconId ? { kind: 'item', itemId: good.iconId } : { kind: 'lucide', icon: CartIcon },
        },
      ),
    })
  })
  return collect(rows).map((r) => r.hit)
}

function matchCollections(q: string): SearchHit[] {
  const rows: Scored[] = []
  ITEM_COLLECTIONS.forEach((collection, index) => {
    const score = rank(q, collection.name, collection.id)
    if (score < 0) return
    rows.push({
      score,
      order: index,
      hit: hit(
        'collections',
        collection.id,
        collection.name,
        { kind: 'prefill', tab: 'items', intent: { collectionId: collection.id } },
        { icon: { kind: 'lucide', icon: BoxesIcon } },
      ),
    })
  })
  return collect(rows).map((r) => r.hit)
}

const SEE_ALL: Partial<Record<SearchGroupId, { tab: TabId }>> = {
  items: { tab: 'items' },
  commands: { tab: 'tables' },
  npcs: { tab: 'dataid' },
  buffs: { tab: 'dataid' },
  tiles: { tab: 'dataid' },
  walls: { tab: 'dataid' },
  goods: { tab: 'store' },
  collections: { tab: 'items' },
}

/** 每组「全部」跳转时带的意图。 */
function seeAllOf(group: SearchGroupId, q: string): SearchGroup['seeAll'] {
  const target = SEE_ALL[group]
  if (!target) return undefined
  if (group === 'collections') return { tab: 'items', intent: { query: q } }
  if (group === 'npcs' || group === 'buffs') return { tab: 'dataid', intent: { query: q } }
  if (group === 'tiles' || group === 'walls') return { tab: 'dataid', intent: { query: q } }
  if (group === 'goods') return { tab: 'store', intent: { query: q } }
  return { tab: target.tab, intent: { query: q } }
}

/** 一个组的匹配器（`q` 已小写化）。一级和二级共用，避免两套匹配逻辑跑偏。 */
function matcherFor(sources: GlobalSearchSources, group: SearchGroupId, q: string): () => SearchHit[] {
  switch (group) {
    case 'pages':
      return () => matchPages(sources, q)
    case 'items':
      return () => matchItems(sources, q)
    case 'commands':
      return () => matchCommands(sources, q)
    case 'npcs':
      return () => matchNpcs(sources, q)
    case 'buffs':
      return () => matchBuffs(sources, q)
    case 'tiles':
      return () => matchTiles(sources, q)
    case 'walls':
      return () => matchWalls(sources, q)
    case 'goods':
      return () => (sources.goods.length > 0 ? matchGoods(sources, q) : [])
    case 'collections':
      return () => matchCollections(q)
  }
}

/**
 * 一级：`query` 为空返回 `[]`（面板自己不显示空结果组）。
 * 返回结果已按 `SEARCH_GROUP_ORDER` 排序、每组已截断到 `MAX_PER_GROUP`、总数已截断到 `MAX_TOTAL`。
 */
export function searchEverything(sources: GlobalSearchSources, query: string): SearchGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const groups: SearchGroup[] = []
  let budget = MAX_TOTAL
  for (const id of SEARCH_GROUP_ORDER) {
    if (budget <= 0) break
    const all = matcherFor(sources, id, q)()
    if (all.length === 0) continue
    const hits = all.slice(0, Math.min(MAX_PER_GROUP, budget))
    budget -= hits.length
    const seeAll = all.length > hits.length ? seeAllOf(id, q) : undefined
    groups.push({ id, hits, total: all.length, seeAll })
  }
  return groups
}

/**
 * 二级：某组命中前 `MAX_PER_GROUP_DETAIL` 条（面板内展开，不跳页）。
 * 超过上限才给「前往页面」出口（`seeAll`）。
 */
export function searchGroup(
  sources: GlobalSearchSources,
  group: SearchGroupId,
  query: string,
  limit = MAX_PER_GROUP_DETAIL,
): SearchGroupDetail {
  const q = query.trim().toLowerCase()
  if (!q) return { group, hits: [], total: 0 }
  const all = matcherFor(sources, group, q)()
  const hits = all.slice(0, limit)
  return {
    group,
    hits,
    total: all.length,
    seeAll: all.length > hits.length ? seeAllOf(group, q) : undefined,
  }
}
