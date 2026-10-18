import { PAGE_SIZE, PAGE_SIZES } from '@/lib/pagination'

/**
 * 「数据图鉴」的界面状态，放在**模块级内存**里（和物品图鉴 `dexState.ts` 同一套策略）：
 *
 * - **切到其它页面再回来**：模块内存还在 → 原样还原（数据源 tab / NPC 分类 / 页码 / 每页数量 /
 *   两列表格开关 / 滚动位置）。
 * - **刷新页面**：模块内存随刷新清空 → 回到默认（NPC tab、每页 100、两列表格开）。
 */

/** 数据源：NPC / 图格 / 墙。 */
export type CodexKind = 'npc' | 'tile' | 'wall'

export interface CodexState {
  kind: CodexKind
  /** NPC 分类：`''` = 全部，`'boss'` = Boss，其余 = 分类 id。 */
  npcFilter: string
  page: number
  pageSize: number
  /** 图格 / 墙表格是否排成左右两列（默认开）。 */
  twoCols: boolean
  scrollTop: number
}

const DEFAULT_CODEX_STATE: CodexState = {
  kind: 'npc',
  npcFilter: '',
  page: 1,
  pageSize: PAGE_SIZE,
  twoCols: true,
  scrollTop: 0,
}

let remembered: CodexState | null = null

/** 读取状态：切页面回来时拿到上次的，刷新后拿到默认。 */
export function readCodexState(): CodexState {
  const s = remembered ?? DEFAULT_CODEX_STATE
  // 每页数量做一次合法化（可能来自旧版本 / 手改内存）。
  if (!(PAGE_SIZES as readonly number[]).includes(s.pageSize)) {
    return { ...s, pageSize: DEFAULT_CODEX_STATE.pageSize }
  }
  return s
}

/** 记录状态（组件卸载时调用）。 */
export function rememberCodexState(state: CodexState): void {
  remembered = state
}

/** 清空记忆状态（单测用；生产只在刷新页面时自然清空）。 */
export function resetCodexState(): void {
  remembered = null
}
