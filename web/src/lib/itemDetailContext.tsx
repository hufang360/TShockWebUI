import { createContext, useContext, type ReactNode } from 'react'

/**
 * 物品提示（tips）右上角 ⓘ「物品详情」入口的能力接口。
 *
 * 物品提示在**很多页面**都会出现（图鉴、指令结果、物品搜索…），但「物品详情抽屉」只属于
 * 物品图鉴。所以这里只暴露一个 `open(itemId, opts?)`：
 * - 图鉴页内自己提供实现 → 就地打开详情抽屉；已经开着抽屉时**再叠一层**（可堆叠抽屉，见
 *   `components/items/ItemDetailDrawer.tsx`），关掉子抽屉回到上一层；
 * - 其它页面由 `App` 提供实现 → 跳到「物品图鉴」并打开该物品的详情（复用 `onOpenInDex`）；
 * - **没有 Provider 时不渲染这个入口**（与收藏 ⭐ 的做法一致），避免点了没反应。
 */
export interface ItemDetailApi {
  /**
   * 打开物品详情。`opts` 用于从**带修饰符的物品标签**（`[i/p60,s2:1569]`）进来时带上词缀 / 堆叠，
   * 这样详情 tips 与词缀分组不用再手选。
   */
  open: (itemId: number, opts?: ItemDetailOptions) => void
}

/** 打开详情时可带的标签修饰符（都缺省 = 无词缀、无堆叠）。 */
export interface ItemDetailOptions {
  prefixId?: number
  stack?: number
}

/** 详情抽屉栈的一层：物品 id + 从标签带进来的修饰符（点配方材料时没有）。 */
export interface DetailEntry extends ItemDetailOptions {
  id: number
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
