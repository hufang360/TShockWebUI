import { createContext, useContext } from 'react'
import type { Dataset, ItemStatEntry } from '@/types'

/**
 * 数据集上下文：让任意位置的 `ItemIcon` 都能取到物品属性（悬停提示用），
 * 而不必把 dataset 逐层透传。测试中未提供 Provider 时返回 null，提示自动降级为「名称行」。
 */
const DatasetContext = createContext<Dataset | null>(null)

export const DatasetProvider = DatasetContext.Provider

export function useDataset(): Dataset | null {
  return useContext(DatasetContext)
}

export function useItemStat(id: number | undefined | null): ItemStatEntry | undefined {
  const dataset = useDataset()
  if (!dataset || id == null) return undefined
  return dataset.itemStats.items[String(id)]
}
