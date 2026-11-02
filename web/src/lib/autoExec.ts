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
      // 明确记下来的 `false` 也要留着：卡片的默认值可能是「手动」（用户添加的卡片），
      // 只有显式 `false` 才能让它们回到「自动执行」。
      if (key && typeof val === 'boolean') manual[key] = val
    }
  }
  return { manual }
}

/** 该卡片是否手动执行；未设置时用 `defaultManual`。 */
export function isManual(prefs: AutoExecPrefs, key: string, defaultManual = false): boolean {
  const v = prefs.manual[key]
  return v === undefined ? defaultManual : v
}

/**
 * 记录「是否手动执行」。两个方向都落盘（不只记 `true`）：
 * 用户添加的卡片默认手动，删掉 key 会让它又变回手动，所以「自动执行」必须显式记 `false`。
 */
export function setManual(prefs: AutoExecPrefs, key: string, manual: boolean): AutoExecPrefs {
  return { manual: { ...prefs.manual, [key]: manual } }
}
