import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useItemFavoritesState } from '@/hooks/useItemFavoritesState'

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
 * 全局物品收藏 Provider（挂在 `App` 最外层）：让**任何地方**的物品提示都能显示右上角 ⭐ ——
 * 指令执行结果、浮动终端、首页卡片、聊天、鱼店、数据 ID 速查……而不只是图鉴 / 指令页。
 *
 * 页面若还需要收藏列表（图鉴的「⭐ 收藏」筛选、指令页的收藏 tab），自己调
 * `useItemFavoritesState()`；多个实例通过 `STORAGE_EVENT` 同步，不会出现两边状态不一致。
 */
export function ItemFavoritesStoreProvider({ children }: { children: ReactNode }) {
  const { api } = useItemFavoritesState()
  return <ItemFavoritesContext.Provider value={api}>{children}</ItemFavoritesContext.Provider>
}

/**
 * 取物品收藏接口。
 * 未提供 Provider 时返回 `null`（工具提示不渲染收藏星），便于单独渲染组件的测试。
 */
export function useItemFavorites(): ItemFavoritesApi | null {
  return useContext(ItemFavoritesContext)
}
