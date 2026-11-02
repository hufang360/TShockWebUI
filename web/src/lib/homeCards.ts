/**
 * 首页卡片的本地自定义配置。
 *
 * 设计（设计原则与约束 §4.5）：
 * - 内置卡片固定存在（不做增删），可隐藏、可排序，但**不可编辑**；
 * - 自定义卡片由用户填写「名称 + 指令」，可增删改；
 * - 顺序、隐藏态与自定义卡片全部存 `tswui:homeCards`，只在本机生效。
 *
 * 内置卡片的图标与指令执行函数放在 HomePage（含 ReactNode，不能放 .ts），
 * 这里只保存与展示/编排有关的元数据。
 */

// 默认顺序 = 屏幕上的默认观感（v4 起顺序就是渲染顺序，右栏卡片按宽度分栏后排在右列）：
// 右栏（服务器状态 → 服务器动态 → 快捷入口 → 最近执行）之后是左栏的两列卡，最后是整行卡。
// 快捷入口默认隐藏：它与侧栏导航重复，仍可在「管理卡片」中重新显示。
export const BUILTIN_CARD_IDS = [
  'server',
  'events',
  'quick',
  'recent',
  'world',
  'lookbag',
  'online',
  'time',
  'alldeath',
  'bossdamage',
  'bossinfo',
] as const

export type BuiltinCardId = (typeof BUILTIN_CARD_IDS)[number]

export interface BuiltinCardMeta {
  id: BuiltinCardId
  /** 展示用的指令；无指令的卡片（状态/最近/快捷）为 null。 */
  command: string | null
  /** i18n key。 */
  titleKey: string
}

export const BUILTIN_CARD_META: Record<BuiltinCardId, BuiltinCardMeta> = {
  server: { id: 'server', command: null, titleKey: 'home.server' },
  online: { id: 'online', command: '/who', titleKey: 'home.online' },
  events: { id: 'events', command: null, titleKey: 'home.events' },
  bossinfo: { id: 'bossinfo', command: '/bossinfo', titleKey: 'home.bossinfo' },
  world: { id: 'world', command: '/worldinfo', titleKey: 'home.world' },
  lookbag: { id: 'lookbag', command: '/lookbag <我>', titleKey: 'home.lookbag' },
  time: { id: 'time', command: '/time', titleKey: 'home.time' },
  bossdamage: { id: 'bossdamage', command: '/bossdamage', titleKey: 'home.bossdamage' },
  alldeath: { id: 'alldeath', command: '/alldeath', titleKey: 'home.alldeath' },
  recent: { id: 'recent', command: null, titleKey: 'home.recent' },
  quick: { id: 'quick', command: null, titleKey: 'home.quick' },
}

/** 会自动执行的内置指令卡片（顺序即执行顺序）。 */
export const BUILTIN_COMMAND_IDS: BuiltinCardId[] = [
  'online',
  'bossinfo',
  'world',
  'lookbag',
  'time',
  'bossdamage',
  'alldeath',
]

export function isBuiltinCardId(id: string): id is BuiltinCardId {
  return Object.prototype.hasOwnProperty.call(BUILTIN_CARD_META, id)
}

import { isCardWidth, type CardWidth } from './cardLayout'

// 宽度档位（小 / 大 / 右）与模块页共用一份定义，见 `lib/cardLayout.ts`。
export type { CardWidth } from './cardLayout'
export { CARD_WIDTHS, isCardWidth } from './cardLayout'

/** 概览卡默认在右栏。 */
const RIGHT_RAIL_DEFAULT_IDS = new Set<string>(['server', 'events', 'quick', 'recent'])
/** 指令卡里默认占整行的（Boss 进度内容宽，半栏挤）。 */
const FULL_WIDTH_DEFAULT_IDS = new Set<string>(['bossinfo'])

/** 卡片的默认宽度（用户没改过时用它，等价于 v3 的硬编码分栏）。 */
export function defaultCardWidth(id: string): CardWidth {
  if (RIGHT_RAIL_DEFAULT_IDS.has(id)) return 'right'
  if (FULL_WIDTH_DEFAULT_IDS.has(id)) return 'full'
  // 内置指令卡默认「小」（两列并排）；用户自己添加的卡片也默认「小」。
  return 'half'
}

/** 自定义卡片 id 前缀，避免与内置 id 冲突。 */
const CUSTOM_PREFIX = 'c:'

export function isCustomCardId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX) && id.length > CUSTOM_PREFIX.length
}

export interface CustomHomeCard {
  id: string
  /** 显示名；为空时界面回退用指令。 */
  name: string
  /** 用户填写的指令原文（可能缺前导 /，执行前再规范化）。 */
  command: string
}

/**
 * 内置默认布局版本。变更内置卡片的默认顺序时 +1：
 * 老的本机布局（`tswui:homeCards` 无 `layoutVersion` 或版本更旧）会自动升级，
 * 只把「服务器动态」「快捷入口」挪到第 2 / 第 3 位，其余卡片与隐藏态、自定义卡片都保留。
 */
export const HOME_CARDS_LAYOUT_VERSION = 4

/** 「服务器动态」「快捷入口」的默认落位（0 基索引，见 docs/功能-服务器动态.md）。 */
const PINNED_CARD_POSITIONS: { id: BuiltinCardId; index: number }[] = [
  { id: 'events', index: 1 },
  { id: 'quick', index: 2 },
]

/**
 * v3 及以前的本机默认顺序（这些版本里左栏顺序由代码写死，用户拖拽只影响自定义卡片位置）。
 * v4 迁移时拿它判断「顺序是不是原封未动」：原封未动 → 换成 v4 的视觉默认；
 * 用户自己排过 → 保留他的顺序（v4 起拖拽才真正生效，别把他的排版弄乱）。
 */
const LEGACY_DEFAULT_ORDER: string[] = [
  'server',
  'events',
  'quick',
  'online',
  'bossinfo',
  'world',
  'lookbag',
  'time',
  'bossdamage',
  'alldeath',
  'recent',
]

export interface HomeCardsPrefs {
  /** 全部卡片 id 的展示顺序（内置 + 自定义）；v4 起它就是渲染顺序，也是指令执行顺序。 */
  order: string[]
  /** id -> 是否隐藏。 */
  hidden: Record<string, boolean>
  /** id -> 宽度（缺省走 `defaultCardWidth`）。 */
  width: Record<string, CardWidth>
  /** 用户自定义卡片。 */
  custom: CustomHomeCard[]
  /** 本机布局对应的内置默认版本，用于一次性升级默认顺序。 */
  layoutVersion: number
}

export const DEFAULT_HOME_CARDS: HomeCardsPrefs = {
  order: [...BUILTIN_CARD_IDS],
  hidden: { quick: true },
  width: {},
  custom: [],
  layoutVersion: HOME_CARDS_LAYOUT_VERSION,
}

/**
 * 本机存储形态（v5 起）：**按服务器分开**存首页布局。
 *
 * `{ byServer: { [serverId]: HomeCardsPrefs } }` —— 不同服务器的指令卡片本来就不一样，
 * 自定义卡片 / 顺序 / 隐藏 / 宽度各记各的。
 */
export interface HomeCardsStore {
  byServer: Record<string, HomeCardsPrefs>
}

export const DEFAULT_HOME_CARDS_STORE: HomeCardsStore = { byServer: {} }

/**
 * 兼容旧数据：v4 及以前整个对象就是一份 `HomeCardsPrefs`（没有 `byServer`）。
 * 迁移策略：老数据当作「所有服务器的初始值」——第一次在某台服务器上打开时以它为底。
 */
export function readHomeCardsStore(value: unknown): {
  store: HomeCardsStore
  legacy: HomeCardsPrefs | null
} {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const byServerRaw = raw.byServer
  if (byServerRaw && typeof byServerRaw === 'object') {
    const byServer: Record<string, HomeCardsPrefs> = {}
    for (const [serverId, prefs] of Object.entries(byServerRaw as Record<string, unknown>)) {
      byServer[serverId] = sanitizeHomeCards(prefs)
    }
    return { store: { byServer }, legacy: null }
  }
  // 老形态：顶层就是一份布局。
  const legacy = sanitizeHomeCards(value)
  const looksLegacy = Array.isArray(raw.order) || Array.isArray(raw.custom)
  return { store: { byServer: {} }, legacy: looksLegacy ? legacy : null }
}

/** 卡片当前宽度（用户设置优先，其次默认）。 */
export function cardWidth(prefs: HomeCardsPrefs, id: string): CardWidth {
  return prefs.width[id] ?? defaultCardWidth(id)
}

/** 取指令的第一条非空行、去首尾空白；缺前导 / 时补上。返回 '' 表示空。 */
export function normalizeCustomCommand(input: string): string {
  const first = input.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  const trimmed = first.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** 生成一个合法且不太可能重复的自定义卡片 id。 */
function newCustomId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${CUSTOM_PREFIX}${rand}`
}

export function createCustomCard(name = '', command = ''): CustomHomeCard {
  return { id: newCustomId(), name, command }
}

/** 卡片可执行时使用的规范化指令（空则返回 null）。 */
export function customCardCommand(card: CustomHomeCard): string | null {
  const cmd = normalizeCustomCommand(card.command)
  return cmd.length > 0 ? cmd : null
}

/**
 * 从任意持久化数据恢复配置：丢弃非法项、去重、补齐缺失的内置卡片。
 * 旧版本 / 手工改坏的 localStorage 不应让首页崩溃。
 */
export function sanitizeHomeCards(value: unknown): HomeCardsPrefs {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<HomeCardsPrefs>

  const custom: CustomHomeCard[] = []
  const seenCustom = new Set<string>()
  if (Array.isArray(raw.custom)) {
    for (const item of raw.custom) {
      if (!item || typeof item !== 'object') continue
      const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : ''
      if (!isCustomCardId(id) || seenCustom.has(id)) continue
      const rawName = (item as { name?: unknown }).name
      const rawCmd = (item as { command?: unknown }).command
      // 原样保留（不 trim、不补 /），避免输入框在编辑时跳动；
      // 执行与展示前再用 normalizeCustomCommand 规范化。
      const name = typeof rawName === 'string' ? rawName : ''
      const command = typeof rawCmd === 'string' ? rawCmd : ''
      seenCustom.add(id)
      custom.push({ id, name, command })
    }
  }

  const valid = new Set<string>([...BUILTIN_CARD_IDS, ...custom.map((c) => c.id)])
  const order: string[] = []
  const seenOrder = new Set<string>()
  if (Array.isArray(raw.order)) {
    for (const id of raw.order) {
      if (typeof id !== 'string' || !valid.has(id) || seenOrder.has(id)) continue
      seenOrder.add(id)
      order.push(id)
    }
  }
  for (const id of valid) {
    if (!seenOrder.has(id)) order.push(id)
  }

  const hidden: Record<string, boolean> = {}
  if (raw.hidden && typeof raw.hidden === 'object') {
    for (const [key, val] of Object.entries(raw.hidden as Record<string, unknown>)) {
      if (valid.has(key) && val === true) hidden[key] = true
    }
  }

  const width: Record<string, CardWidth> = {}
  const rawWidth = (raw as { width?: unknown }).width
  if (rawWidth && typeof rawWidth === 'object') {
    for (const [key, val] of Object.entries(rawWidth as Record<string, unknown>)) {
      if (valid.has(key) && isCardWidth(val)) {
        width[key] = val
      }
    }
  }

  const layoutVersion =
    typeof raw.layoutVersion === 'number' && Number.isFinite(raw.layoutVersion)
      ? raw.layoutVersion
      : 0

  return { order, hidden, width, custom, layoutVersion }
}

/**
 * 把老版本的内置布局升级到当前默认顺序：
 * 只重新落位「服务器动态」（第 2）与「快捷入口」（第 3），
 * 其余卡片（含自定义）保持原有相对顺序，隐藏态不变。已是当前版本则原样返回。
 */
export function upgradeHomeCardsLayout(prefs: HomeCardsPrefs): HomeCardsPrefs {
  if (prefs.layoutVersion >= HOME_CARDS_LAYOUT_VERSION) return prefs

  // 先补上 v3 的「服务器动态第 2 / 快捷入口第 3」。
  const pinned = new Set<string>(PINNED_CARD_POSITIONS.map((p) => p.id))
  let order = prefs.order.filter((id) => !pinned.has(id))
  for (const { id, index } of PINNED_CARD_POSITIONS) {
    order.splice(Math.min(index, order.length), 0, id)
  }

  // v4：左栏顺序不再写死，改由 order + 每张卡的宽度决定。
  // 顺序若仍是老默认（用户没自己排过），换成 v4 的视觉默认；排过则原样保留。
  const customs = order.filter((id) => !isBuiltinCardId(id))
  const builtins = order.filter((id) => isBuiltinCardId(id))
  if (builtins.join() === LEGACY_DEFAULT_ORDER.join()) {
    order = [...BUILTIN_CARD_IDS, ...customs]
  }

  // v3：快捷入口与侧栏重复，升级时默认隐藏；用户仍可在卡片管理中重新打开。
  return {
    ...prefs,
    order,
    hidden: { ...prefs.hidden, quick: true },
    width: prefs.width ?? {},
    layoutVersion: HOME_CARDS_LAYOUT_VERSION,
  }
}

/** 把 fromId 移动到 toId 所在位置（拖拽排序）。 */
export function moveCard(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order
  const from = order.indexOf(fromId)
  const to = order.indexOf(toId)
  if (from < 0 || to < 0) return order
  const next = order.slice()
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return next
}

/** 上/下移一格（键盘 / 触屏兜底）。 */
export function shiftCard(order: string[], id: string, delta: number): string[] {
  const index = order.indexOf(id)
  if (index < 0) return order
  const target = index + delta
  if (target < 0 || target >= order.length) return order
  const next = order.slice()
  next.splice(index, 1)
  next.splice(target, 0, id)
  return next
}
