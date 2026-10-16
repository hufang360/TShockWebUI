import { PAGE_SIZE } from '@/lib/pagination'

/**
 * 物品图鉴的界面状态，放在**模块级内存**里：
 *
 * - **切到其它模块再回来**：模块内存还在 → 原样还原（页码 / 每页数量 / 集合 / 搜索 / 开关 / 滚动位置 / 选中项），
 *   随机顺序也不会变。
 * - **刷新页面**：模块内存随刷新清空 → 重新随机（`initialDexState` 里取新 seed），
 *   于是每次都从全部物品里随机取第 1 页（默认 50 个）。
 */
export type CopyKind = 'id' | 'name' | 'tag'

export interface DexState {
  /** 随机种子：决定「从全部物品里随机取」的顺序 */
  seed: number
  page: number
  pageSize: number
  collectionId: string
  query: string
  scrollTop: number
  selectedId: number | null
  copyKind: CopyKind
}

/** 随机种子。用位运算生成 32 位非负整数，供 shuffleWithSeed 使用。 */
const randomSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0

let remembered: DexState | null = null

/** 读取状态：切模块回来时拿到上次的，刷新后拿到新的随机初始状态。 */
export function readDexState(): DexState {
  return (
    remembered ?? {
      seed: randomSeed(),
      page: 1,
      pageSize: PAGE_SIZE,
      collectionId: '',
      query: '',
      scrollTop: 0,
      selectedId: null,
      copyKind: 'id',
    }
  )
}

/** 记录状态（组件卸载时调用）。 */
export function rememberDexState(state: DexState): void {
  remembered = state
}

/** 清空内存状态。测试隔离用；语义上等价于「刷新页面」。 */
export function resetDexState(): void {
  remembered = null
}
