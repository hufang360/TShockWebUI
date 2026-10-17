import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/** 物品收藏的读写接口：由页面（或全局 Provider）提供，工具提示右上角的 ⭐ 用它。 */
export interface ItemFavoritesApi {
  isFavorited: (id: number) => boolean
  toggle: (id: number) => void
}

const ItemFavoritesContext = createContext<ItemFavoritesApi | null>(null)

export function ItemFavoritesProvider({
  api,
  children,
}: {
  api: ItemFavoritesApi
  children: ReactNode
}) {
  return <ItemFavoritesContext.Provider value={api}>{children}</ItemFavoritesContext.Provider>
}

/**
 * 取物品收藏接口。
 * 未提供 Provider 时返回 `null`（工具提示不渲染收藏星），便于单独渲染组件的测试。
 */
export function useItemFavorites(): ItemFavoritesApi | null {
  return useContext(ItemFavoritesContext)
}
