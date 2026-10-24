/**
 * 「数据ID」（原「数据图鉴」）的界面状态，放在**模块级内存**里（和物品图鉴 `dexState.ts` 同一套策略）：
 *
 * - **切到其它页面再回来**：模块内存还在 → 原样还原（数据源 tab / NPC 分类 /
 *   两列表格开关 / NPC·Buff 的图标或表格视图 / 滚动位置）。
 * - **刷新页面**：模块内存随刷新清空 → 回到默认（NPC tab、图标视图、两列表格开）。
 */

/** 数据源：NPC / 图格 / 墙 / Buff。 */
export type DataIdKind = 'npc' | 'tile' | 'wall' | 'buff'

export interface DataIdState {
  kind: DataIdKind
  /** NPC 分类：`''` = 全部，`'boss'` = Boss，其余 = 分类 id。 */
  npcFilter: string
  /** 图格 / 墙 / Buff 表格是否排成左右两列（默认开）。 */
  twoCols: boolean
  /** NPC / Buff 是否使用表格视图（默认关闭 = 图标网格）。 */
  tableView: boolean
  scrollTop: number
}

const DEFAULT_DATAID_STATE: DataIdState = {
  kind: 'npc',
  npcFilter: '',
  twoCols: true,
  tableView: false,
  scrollTop: 0,
}

let remembered: DataIdState | null = null

/** 读取状态：切页面回来时拿到上次的，刷新后拿到默认。 */
export function readDataIdState(): DataIdState {
  return remembered ?? DEFAULT_DATAID_STATE
}

/** 记录状态（组件卸载时调用）。 */
export function rememberDataIdState(state: DataIdState): void {
  remembered = state
}

/** 清空记忆状态（单测用；生产只在刷新页面时自然清空）。 */
export function resetDataIdState(): void {
  remembered = null
}
