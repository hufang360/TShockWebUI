import type { SearchGroupId } from '@/lib/globalSearch'

/**
 * 全局搜索「二级（组内列表）」的位置记忆。
 *
 * 用途：`Esc` 从二级回一级后，短时间内再进同一组 / 重开弹框，直接把用户送回上次那一组、
 * 那个词、那一行，而不是从头再搜一遍。
 *
 * 为什么放模块级：搜索弹框在 `App` 里按开关重挂载（`key={open ? 'open' : 'closed'}`），
 * 组件 state 留不住；也不用 localStorage —— 这只是「刚才看到哪」的会话内记忆，刷新页面就该忘。
 */
export const DRILL_MEMORY_TTL_MS = 60_000

export interface DrillMemory {
  /** 当时的搜索词（重开弹框时直接填回输入框）。 */
  query: string
  group: SearchGroupId
  /** 上次高亮的行（`SearchHit.id`，或一级那行「更多」的 value）；`null` = 回到第一条。 */
  selected: string | null
  /** 最后一次触达（ms），用于 TTL。 */
  at: number
}

let memory: DrillMemory | null = null

/** 记下二级位置（`now` 可注入，便于测试 TTL）。 */
export function rememberDrill(entry: Omit<DrillMemory, 'at'>, now = Date.now()): void {
  memory = { ...entry, at: now }
}

/** 取未过期的记忆（**不消费**：同一个位置可以反复回退 / 重开）。 */
export function recallDrill(now = Date.now()): DrillMemory | null {
  if (!memory || now - memory.at > DRILL_MEMORY_TTL_MS) return null
  return memory
}

/** 用户明确离开弹框（跳页 / 填终端）时清掉，避免下次打开突然回到旧位置。 */
export function forgetDrill(): void {
  memory = null
}
