/**
 * 「指令卡片是否自动执行」偏好（本机，按卡片 key 记忆）。
 *
 * - key 形如 `home:<cardId>` / `world:fixed:/relive` / `m:<id>:<cardId>`；
 * - 默认值由调用方给出：首页卡片默认**自动**；世界管理的 `/relive`、`/cleartomb` 默认**手动**（不主动跑）；
 * - `manual = true` 的卡片：自动刷新、以及「刷新全部」都不会执行它，只能点卡片自己的按钮手动执行。
 */

export interface AutoExecPrefs {
  /** key -> 是否手动（true = 不自动执行）。 */
  manual: Record<string, boolean>
}

export const DEFAULT_AUTO_EXEC: AutoExecPrefs = { manual: {} }

export function sanitizeAutoExec(value: unknown): AutoExecPrefs {
  const raw = (value && typeof value === 'object' ? value : {}) as { manual?: unknown }
  const manual: Record<string, boolean> = {}
  if (raw.manual && typeof raw.manual === 'object') {
    for (const [key, val] of Object.entries(raw.manual as Record<string, unknown>)) {
      if (key && val === true) manual[key] = true
    }
  }
  return { manual }
}

/** 该卡片是否手动执行；未设置时用 `defaultManual`。 */
export function isManual(prefs: AutoExecPrefs, key: string, defaultManual = false): boolean {
  const v = prefs.manual[key]
  return v === undefined ? defaultManual : v
}

export function setManual(prefs: AutoExecPrefs, key: string, manual: boolean): AutoExecPrefs {
  const next = { ...prefs.manual }
  if (manual) next[key] = true
  else delete next[key]
  return { manual: next }
}
