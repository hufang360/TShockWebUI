/**
 * 「数据ID」（原「数据图鉴」）的界面状态，放在**模块级内存**里（和物品图鉴 `dexState.ts` 同一套策略）：
 *
 * - **切到其它页面再回来**：模块内存还在 → 原样还原（数据源 tab / NPC 分类 / 油漆分组 /
 *   两列表格开关 / NPC·Buff 的图标或表格视图 / 滚动位置）。
 * - **刷新页面**：模块内存随刷新清空 → 回到默认（NPC tab、图标视图、两列表格开）。
 */

import type { PaintGroup } from '@/types'

/** 数据源：NPC / 图格 / 墙 / Buff / 油漆 / 射弹。 */
export type DataIdKind = 'npc' | 'tile' | 'wall' | 'buff' | 'paint' | 'projectile'

export interface DataIdState {
  kind: DataIdKind
  /** NPC 分类：`''` = 全部，`'boss'` = Boss，其余 = 分类 id。 */
  npcFilter: string
  /** 油漆分组：`''` = 全部，`'paint'` = 油漆，`'coating'` = 涂料（两套 ID 空间，默认混看）。 */
  paintFilter: PaintGroup | ''
  /** 图格 / 墙 / Buff / 油漆 / 射弹表格是否排成左右两列（默认开）。 */
  twoCols: boolean
  /** NPC / Buff 是否使用表格视图（默认关闭 = 图标网格）。 */
  tableView: boolean
  scrollTop: number
  /** 打开着的详情（切页面回来继续开着）。油漆要带上分组才唯一（油漆 1 ≠ 涂料 1）。 */
  detail: DataIdDetail | null
}

/** 详情抽屉指向的条目。 */
export interface DataIdDetail {
  kind: DataIdKind
  id: number
  /** 只有油漆有：`paint` / `coating`（两套 ID 空间数字会重复）。 */
  group?: PaintGroup
}

const DEFAULT_DATAID_STATE: DataIdState = {
  kind: 'npc',
  npcFilter: '',
  paintFilter: '',
  twoCols: true,
  tableView: false,
  scrollTop: 0,
  detail: null,
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
