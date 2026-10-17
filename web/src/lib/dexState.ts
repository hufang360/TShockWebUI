import { PAGE_SIZE, PAGE_SIZES } from '@/lib/pagination'
import { readJson, StorageKeys, writeJson } from '@/lib/storage'
import type { CollectionGroup } from './collections'

/**
 * 物品图鉴的界面状态，放在**模块级内存**里：
 *
 * - **切到其它模块再回来**：模块内存还在 → 原样还原（页码 / 每页数量 / 集合分组与集合 / 游戏页签 / 搜索 / 滚动位置 / 选中项），
 *   随机顺序也不会变。
 * - **刷新页面**：模块内存随刷新清空 → 重新随机（`initialDexState` 里取新 seed），
 *   于是每次都从全部物品里随机取第 1 页（默认 100 个）。
 */
export type CopyKind = 'id' | 'name' | 'tag'

/** 图鉴主筛选方式：全部物品 / 游戏分组（Tabs）/ 某个集合分组。 */
export type DexMode = 'all' | 'game' | CollectionGroup

export interface DexState {
  /** 随机种子：决定「从全部物品里随机取」的顺序 */
  seed: number
  page: number
  pageSize: number
  /** 主筛选方式（级联第一级） */
  mode: DexMode
  /** 只看收藏（⭐ 开关）；开启时主筛选固定在「全部物品」 */
  favoritesOnly: boolean
  /** 级联第二级：集合 id（'' = 未选具体集合） */
  collectionId: string
  /** 游戏分组内的页签 id（'' = 全部页签） */
  groupTab: string
  query: string
  scrollTop: number
  selectedId: number | null
  /** 详情里预览的词缀 id（0 = 无词缀）。 */
  prefixId: number
  copyKind: CopyKind
}

/** 默认游戏分组页签：默认落到「工具」（「全部」数据量太大）。 */
export const DEFAULT_GAME_TAB = 'tools'

/** 读取每页数量：跨刷新记忆，非法值回落到默认。 */
export function readDexPageSize(): number {
  const stored = readJson<number>(StorageKeys.dexPageSize, PAGE_SIZE)
  return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : PAGE_SIZE
}

/** 随机种子（保留字段；已不再用于随机排序）。 */
const randomSeed = () => 0

let remembered: DexState | null = null

/** 读取状态：切模块回来时拿到上次的，刷新后拿到新的随机初始状态。 */
export function readDexState(): DexState {
  return (
    remembered ?? {
      seed: randomSeed(),
      page: 1,
      pageSize: readDexPageSize(),
      // 默认落到「全部物品」（分页 + 虚拟滚动，性能可控）。
      mode: 'all',
      favoritesOnly: false,
      collectionId: '',
      groupTab: '',
      query: '',
      scrollTop: 0,
      selectedId: null,
      prefixId: 0,
      copyKind: 'id',
    }
  )
}

/** 记忆每页数量（跨刷新）。 */
export function rememberDexPageSize(size: number): void {
  writeJson(StorageKeys.dexPageSize, size)
}

/** 记录状态（组件卸载时调用）。 */
export function rememberDexState(state: DexState): void {
  remembered = state
}

/** 清空内存状态。测试隔离用；语义上等价于「刷新页面」。 */
export function resetDexState(): void {
  remembered = null
}
