/**
 * 「进入页面自动刷新」的时间闸门（仅内存，不持久化）。
 *
 * 规则（见需求：首页 / 鱼店的指令卡片）：
 * - 进入页面时自动刷新全部卡片；若该作用域**上次「刷新全部」**在 `GATE_MS` 之内，则跳过；
 * - **单个卡片的手动刷新不计入**这个闸门（它只更新自己卡片上的执行时间）；
 * - 作用域按 `服务器:模块` 区分，切换服务器后各自独立。
 *
 * 放在内存而非 localStorage：命令结果是内存态（刷新页面即清空），
 * 若闸门跨刷新页面存活，会导致「页面刚刷新却因为不到 2 分钟而什么都不拉」。
 */

/** 默认自动刷新间隔：2 分钟（可在「设置 → 页面数据刷新间隔」里改）。 */
export const REFRESH_GATE_MS = 2 * 60 * 1000

const lastFullRefresh = new Map<string, number>()

/**
 * 该作用域是否到了该自动刷新的时间（从未刷新过也算到点）。
 * `intervalMs <= 0` 表示「不自动刷新」：**首次进入仍加载一次**（否则页面空白），之后不再自动刷新。
 */
export function isRefreshDue(
  scope: string,
  intervalMs: number = REFRESH_GATE_MS,
  now: number = Date.now(),
): boolean {
  const last = lastFullRefresh.get(scope)
  if (last == null) return true
  if (intervalMs <= 0) return false
  return now - last >= intervalMs
}

/** 记下「刷新全部」的时间，返回该时间戳（供界面展示）。 */
export function markRefreshed(scope: string, now: number = Date.now()): number {
  lastFullRefresh.set(scope, now)
  return now
}

/** 上次「刷新全部」的时间；从未刷新过返回 null。 */
export function lastRefreshedAt(scope: string): number | null {
  return lastFullRefresh.get(scope) ?? null
}

/** 构造作用域 key：`服务器:模块`。 */
export function refreshScope(serverId: string, module: string): string {
  return `${serverId}:${module}`
}

/** 仅供测试：清空内存状态。 */
export function resetRefreshGate(): void {
  lastFullRefresh.clear()
}
