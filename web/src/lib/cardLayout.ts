/**
 * 卡片布局（宽度 / 顺序）—— 首页、模块页、鱼店共用。
 *
 * 宽度只有三档，界面上写「小 / 大 / 右」：
 * - `half`（小）= 左栏两列网格里的半栏；
 * - `full`（大）= 左栏整行；
 * - `right`（右）= 右侧 360px 概览栏（鱼店只有右栏，所以只能选这一档）。
 *
 * 顺序就是渲染顺序，也是指令执行顺序；同一份 order 同时决定左栏与右栏的先后。
 * 存本机 `tswui:cardLayout`（按服务器 + 模块分开），首页仍用 `tswui:homeCards`。
 */

/** 卡片宽度档位（界面文案：小 / 大 / 右）。 */
export type CardWidth = 'half' | 'full' | 'right'

/** 菜单里的排列顺序：小 → 大 → 右。 */
export const CARD_WIDTHS: readonly CardWidth[] = ['half', 'full', 'right'] as const

export function isCardWidth(value: unknown): value is CardWidth {
  return typeof value === 'string' && (CARD_WIDTHS as readonly string[]).includes(value)
}

/** 一个作用域（某服务器上的某个模块）内的布局。 */
export interface CardLayout {
  /** 全部卡片 id 的展示顺序（含记事本这类非指令卡片）。缺失的 id 由读取时补齐。 */
  order: string[]
  /** id -> 宽度；没记过的走默认值。 */
  width: Record<string, CardWidth>
  /** id -> 是否隐藏（隐藏的卡片不渲染、不参与自动刷新，但仍列在「管理卡片」里）。 */
  hidden: Record<string, boolean>
}

export interface CardLayoutPrefs {
  /** `byServer[serverId][scopeId]`，`scopeId` = 模块 id（鱼店用 `store`）。 */
  byServer: Record<string, Record<string, CardLayout>>
}

export const DEFAULT_CARD_LAYOUTS: CardLayoutPrefs = { byServer: {} }

/** 从任意持久化数据恢复：只做结构校验，id 级过滤在读的时候做。 */
export function sanitizeCardLayouts(value: unknown): CardLayoutPrefs {
  const raw = (value && typeof value === 'object' ? value : {}) as { byServer?: unknown }
  const byServer: Record<string, Record<string, CardLayout>> = {}
  if (!raw.byServer || typeof raw.byServer !== 'object') return { byServer }

  for (const [serverId, scopes] of Object.entries(raw.byServer as Record<string, unknown>)) {
    if (!scopes || typeof scopes !== 'object') continue
    const out: Record<string, CardLayout> = {}
    for (const [scopeId, layout] of Object.entries(scopes as Record<string, unknown>)) {
      if (!layout || typeof layout !== 'object') continue
      const rawOrder = (layout as { order?: unknown }).order
      const order: string[] = []
      const seen = new Set<string>()
      if (Array.isArray(rawOrder)) {
        for (const id of rawOrder) {
          if (typeof id !== 'string' || seen.has(id)) continue
          seen.add(id)
          order.push(id)
        }
      }
      const width: Record<string, CardWidth> = {}
      const rawWidth = (layout as { width?: unknown }).width
      if (rawWidth && typeof rawWidth === 'object') {
        for (const [id, value] of Object.entries(rawWidth as Record<string, unknown>)) {
          if (isCardWidth(value)) width[id] = value
        }
      }
      const hidden: Record<string, boolean> = {}
      const rawHidden = (layout as { hidden?: unknown }).hidden
      if (rawHidden && typeof rawHidden === 'object') {
        for (const [id, value] of Object.entries(rawHidden as Record<string, unknown>)) {
          if (value === true) hidden[id] = true
        }
      }
      out[scopeId] = { order, width, hidden }
    }
    byServer[serverId] = out
  }
  return { byServer }
}

/**
 * 取某个作用域生效的布局：`ids` 是当前真实存在的卡片（按代码里的默认顺序），
 * 顺序里消失的 id 丢弃、新出现的 id 补在末尾；宽度只保留仍然存在的 id。
 */
export function cardLayoutFor(
  prefs: CardLayoutPrefs,
  serverId: string,
  scopeId: string,
  ids: string[],
): CardLayout {
  const stored = prefs.byServer[serverId]?.[scopeId]
  const known = new Set(ids)
  const order: string[] = []
  const seen = new Set<string>()
  for (const id of stored?.order ?? []) {
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  const width: Record<string, CardWidth> = {}
  for (const [id, value] of Object.entries(stored?.width ?? {})) {
    if (known.has(id)) width[id] = value
  }
  const hidden: Record<string, boolean> = {}
  for (const [id, value] of Object.entries(stored?.hidden ?? {})) {
    if (known.has(id) && value === true) hidden[id] = true
  }
  return { order, width, hidden }
}

export function writeCardLayout(
  prefs: CardLayoutPrefs,
  serverId: string,
  scopeId: string,
  layout: CardLayout,
): CardLayoutPrefs {
  const forServer = prefs.byServer[serverId] ?? {}
  return {
    byServer: {
      ...prefs.byServer,
      [serverId]: { ...forServer, [scopeId]: layout },
    },
  }
}

/**
 * 清掉某个作用域（某服务器上的某个模块）的布局，回到「全默认」。
 * 用于「管理卡片 → 恢复默认」：只删这一个作用域，别的页面 / 服务器的布局不受影响。
 */
export function clearCardLayout(
  prefs: CardLayoutPrefs,
  serverId: string,
  scopeId: string,
): CardLayoutPrefs {
  const forServer = prefs.byServer[serverId]
  if (!forServer || !(scopeId in forServer)) return prefs
  const nextForServer = { ...forServer }
  delete nextForServer[scopeId]
  const byServer = { ...prefs.byServer }
  // 这个服务器下已经没有别的模块了，就连服务器键一起删掉（否则空对象会留在存储里）。
  if (Object.keys(nextForServer).length > 0) byServer[serverId] = nextForServer
  else delete byServer[serverId]
  return { byServer }
}

/** 卡片当前宽度（用户设置优先，其次默认）。 */
export function resolveWidth(layout: CardLayout, id: string, fallback: CardWidth): CardWidth {
  return layout.width[id] ?? fallback
}

/** 上 / 下移一格（键盘 / 触屏兜底）；到头返回原数组。 */
export function shiftInOrder(order: string[], id: string, delta: number): string[] {
  const index = order.indexOf(id)
  if (index < 0) return order
  const target = index + delta
  if (target < 0 || target >= order.length) return order
  const next = order.slice()
  next.splice(index, 1)
  next.splice(target, 0, id)
  return next
}

/** 拖拽：把 fromId 挪到 targetIndex（越界自动收敛）。 */
export function moveInOrder(order: string[], fromId: string, targetIndex: number): string[] {
  const from = order.indexOf(fromId)
  if (from < 0) return order
  const clamped = Math.max(0, Math.min(order.length - 1, targetIndex))
  if (from === clamped) return order
  const next = order.slice()
  next.splice(from, 1)
  next.splice(clamped, 0, fromId)
  return next
}
