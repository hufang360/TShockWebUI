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
 * - 每组最多 `MAX_PER_GROUP` 条，总上限 `MAX_TOTAL`；被截掉的靠组标题的「全部」承接。
 * - 数字查询天然优先命中 ID：各域的 ID 字段参与 `rank`，精确命中的排在最前。
 */

export type SearchGroupId =
  | 'pages'
  | 'items'
  | 'commands'
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

/** 每组最多展示几条。 */
export const MAX_PER_GROUP = 3
/** 面板总共最多展示几条。 */
export const MAX_TOTAL = 12
/** 每组最多扫描出多少条（只用于「全部 N 条」的计数，不需要全量）。 */
const SCAN_CAP = 40

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
   * 为 false 时回车仍然只是跳到「指令小抄」查用法，不会替你执行一条跑不起来的命令。
   */
  runnable?: boolean
  icon?: SearchHitIcon
  action: SearchHitAction
}

export interface SearchGroup {
  id: SearchGroupId
  /** 最多 `MAX_PER_GROUP` 条。 */
  hits: SearchHit[]
  /** 命中的总数（上限 `SCAN_CAP`）；大于 `hits.length` 时显示「全部」。 */
  total: number
  /** 「全部」要去哪：缺省 = 该组不支持跳转。 */
  seeAll?: { tab: TabId; intent?: SearchIntent }
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
  commands: ['指令小抄', '小抄', '帮助', '用法', 'cheat', 'help', 'tip'],
  save: ['存档', '角色', '背包', 'plr', 'player file'],
  worldview: ['世界', '地图', '存档', 'wld', 'world', 'map'],
  spritesheet: ['精灵', '精灵图', '切图', 'sprite', 'png'],
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

function collect(rows: Scored[]): Scored[] {
  return rows
    .sort((a, b) => a.score - b.score || a.order - b.order || a.hit.name.localeCompare(b.hit.name))
    .slice(0, SCAN_CAP)
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
  extra: { meta?: string; copy?: string; command?: string; runnable?: boolean; icon?: SearchHitIcon } = {},
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
  return searchItems(sources.dataset.items, q, SCAN_CAP).map((item) =>
    hit('items', String(item.id), item.name, { kind: 'item', itemId: item.id }, {
      meta: `#${item.id}`,
      copy: String(item.id),
      icon: { kind: 'item', itemId: item.id },
    }),
  )
}

function matchCommands(sources: GlobalSearchSources, q: string): SearchHit[] {
  const rows: Scored[] = []
  for (const command of sources.dataset.commands) {
    const score = rank(q, command.name, ...command.aliases, command.help, command.helpZh ?? undefined, command.helpEn ?? undefined)
    if (score < 0) continue
    rows.push({
      score,
      order: command.name.length,
      hit: hit(
        'commands',
        command.name,
        `/${command.name}`,
        { kind: 'prefill', tab: 'commands', intent: { query: command.name } },
        {
          meta: (command.helpZh || command.help || '').replace(/[。.]$/, '') || undefined,
          icon: { kind: 'lucide', icon: TerminalIcon },
          copy: `/${command.name}`,
          command: `/${command.name}`,
          runnable: command.allowServer !== false && !hasRequiredArgs(command),
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
  commands: { tab: 'commands' },
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

/**
 * 搜索入口：`query` 为空返回 `[]`（面板自己不显示空结果组）。
 * 返回结果已按 `SEARCH_GROUP_ORDER` 排序、每组已截断到 `MAX_PER_GROUP`、总数已截断到 `MAX_TOTAL`。
 */
export function searchEverything(sources: GlobalSearchSources, query: string): SearchGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const matchers: Record<SearchGroupId, () => SearchHit[]> = {
    pages: () => matchPages(sources, q),
    items: () => matchItems(sources, q),
    commands: () => matchCommands(sources, q),
    npcs: () => matchNpcs(sources, q),
    buffs: () => matchBuffs(sources, q),
    tiles: () => matchTiles(sources, q),
    walls: () => matchWalls(sources, q),
    goods: () => (sources.goods.length > 0 ? matchGoods(sources, q) : []),
    collections: () => matchCollections(q),
  }

  const groups: SearchGroup[] = []
  let budget = MAX_TOTAL
  for (const id of SEARCH_GROUP_ORDER) {
    if (budget <= 0) break
    const all = matchers[id]()
    if (all.length === 0) continue
    const hits = all.slice(0, Math.min(MAX_PER_GROUP, budget))
    budget -= hits.length
    const seeAll = all.length > hits.length ? seeAllOf(id, q) : undefined
    groups.push({ id, hits, total: all.length, seeAll })
  }
  return groups
}
