import { createContext, useContext, type ReactNode } from 'react'

/**
 * 物品提示（tips）里「合成表」入口的能力接口。
 *
 * 物品提示在**很多页面**都会出现（图鉴、指令结果、物品搜索…），但「物品详情抽屉」只属于
 * 物品图鉴。所以这里只暴露一个 `open(itemId)`：
 * - 图鉴页内自己提供实现 → 就地打开详情抽屉；已经开着抽屉时**再叠一层**（可堆叠抽屉，见
 *   `components/items/ItemDetailDrawer.tsx`），关掉子抽屉回到上一层；
 * - 其它页面由 `App` 提供实现 → 跳到「物品图鉴」并打开该物品的详情（复用 `onOpenInDex`）；
 * - **没有 Provider 时不渲染这个入口**（与收藏 ⭐ 的做法一致），避免点了没反应。
 */
export interface ItemDetailApi {
  open: (itemId: number) => void
}

const ItemDetailContext = createContext<ItemDetailApi | null>(null)

export function ItemDetailProvider({
  api,
  children,
}: {
  api: ItemDetailApi
  children: ReactNode
}) {
  return <ItemDetailContext.Provider value={api}>{children}</ItemDetailContext.Provider>
}

export function useItemDetail(): ItemDetailApi | null {
  return useContext(ItemDetailContext)
}
