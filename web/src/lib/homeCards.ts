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

// 默认顺序即「服务器状态 → 服务器动态 → 快捷入口 → 在线玩家 → …」。
// 「服务器动态」固定在第 2 位、「快捷入口」固定在第 3 位（见 docs/功能-服务器动态.md）。
export const BUILTIN_CARD_IDS = [
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
export const HOME_CARDS_LAYOUT_VERSION = 2

/** 「服务器动态」「快捷入口」的默认落位（0 基索引，见 docs/功能-服务器动态.md）。 */
const PINNED_CARD_POSITIONS: { id: BuiltinCardId; index: number }[] = [
  { id: 'events', index: 1 },
  { id: 'quick', index: 2 },
]

export interface HomeCardsPrefs {
  /** 全部卡片 id 的展示顺序（内置 + 自定义）。 */
  order: string[]
  /** id -> 是否隐藏。 */
  hidden: Record<string, boolean>
  /** 用户自定义卡片。 */
  custom: CustomHomeCard[]
  /** 本机布局对应的内置默认版本，用于一次性升级默认顺序。 */
  layoutVersion: number
}

export const DEFAULT_HOME_CARDS: HomeCardsPrefs = {
  order: [...BUILTIN_CARD_IDS],
  hidden: {},
  custom: [],
  layoutVersion: HOME_CARDS_LAYOUT_VERSION,
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

  const layoutVersion =
    typeof raw.layoutVersion === 'number' && Number.isFinite(raw.layoutVersion)
      ? raw.layoutVersion
      : 0

  return { order, hidden, custom, layoutVersion }
}

/**
 * 把老版本的内置布局升级到当前默认顺序：
 * 只重新落位「服务器动态」（第 2）与「快捷入口」（第 3），
 * 其余卡片（含自定义）保持原有相对顺序，隐藏态不变。已是当前版本则原样返回。
 */
export function upgradeHomeCardsLayout(prefs: HomeCardsPrefs): HomeCardsPrefs {
  if (prefs.layoutVersion >= HOME_CARDS_LAYOUT_VERSION) return prefs
  const pinned = new Set<string>(PINNED_CARD_POSITIONS.map((p) => p.id))
  const order = prefs.order.filter((id) => !pinned.has(id))
  for (const { id, index } of PINNED_CARD_POSITIONS) {
    order.splice(Math.min(index, order.length), 0, id)
  }
  return { ...prefs, order, layoutVersion: HOME_CARDS_LAYOUT_VERSION }
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
