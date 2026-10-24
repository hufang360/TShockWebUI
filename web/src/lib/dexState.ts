import type { CollectionGroup } from './collections'

/**
 * 物品图鉴的界面状态，放在**模块级内存**里：
 *
 * - **切到其它模块再回来**：模块内存还在 → 原样还原（集合分组与集合 / 游戏页签 / 搜索 / 滚动位置 / 选中项）。
 * - **刷新页面**：模块内存随刷新清空 → 回到默认状态（全部物品、滚动到顶部）。
 */
/** 图鉴主筛选方式：全部物品 / 游戏分组（Tabs）/ 某个集合分组。 */
export type DexMode = 'all' | 'game' | CollectionGroup

export interface DexState {
  /** 随机种子（保留字段；已不再用于随机排序） */
  seed: number
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
}

/** 默认游戏分组页签：默认落到「工具」（「全部」数据量太大）。 */
export const DEFAULT_GAME_TAB = 'tools'

/** 随机种子（保留字段；已不再用于随机排序）。 */
const randomSeed = () => 0

let remembered: DexState | null = null

/** 读取状态：切模块回来时拿到上次的，刷新后拿到默认状态。 */
export function readDexState(): DexState {
  return (
    remembered ?? {
      seed: randomSeed(),
      // 默认落到「全部物品」（全部结果交给虚拟滚动）。
      mode: 'all',
      favoritesOnly: false,
      collectionId: '',
      groupTab: '',
      query: '',
      scrollTop: 0,
      selectedId: null,
      prefixId: 0,
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
