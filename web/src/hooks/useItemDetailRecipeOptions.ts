import { useLocalState } from '@/hooks/useLocalState'
import { StorageKeys } from '@/lib/storage'

/** 合成表 / 掉落列表的只读显示选项；编辑入口在图鉴工具栏的「图鉴设置」Popover（两边改的是同一份）。 */
export interface ItemDetailRecipeOptions {
  /** 显示物品名称（默认不勾选 = 仅图标）。 */
  showItemNames: boolean
  /** 固定两列（默认不勾选 = 自适应多列）。 */
  twoColumn: boolean
}

/** 物品详情里合成表 / 掉落列表的显示选项（物品图鉴的设置，存本机）。 */
export function useItemDetailRecipeOptions(): ItemDetailRecipeOptions {
  const [showItemNames] = useLocalState<boolean>(StorageKeys.dexRecipeShowNames, false)
  const [twoColumn] = useLocalState<boolean>(StorageKeys.dexRecipeTwoColumn, false)
  return { showItemNames, twoColumn }
}
