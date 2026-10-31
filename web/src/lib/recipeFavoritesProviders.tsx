import type { ReactNode } from 'react'
import { useRecipeFavoritesState } from '@/hooks/useRecipeFavoritesState'
import { RecipeFavoritesContext } from '@/lib/recipeFavoritesContext'
import type { RecipeFavoritesApi } from '@/lib/recipeFavoritesContext'

export function RecipeFavoritesProvider({
  api,
  children,
}: {
  api: RecipeFavoritesApi
  children: ReactNode
}) {
  return (
    <RecipeFavoritesContext.Provider value={api}>{children}</RecipeFavoritesContext.Provider>
  )
}

/**
 * 全局合成记录收藏 Provider（挂在 `App` 最外层）：让**任何地方**的合成表条目都能点 ⭐ ——
 * 物品图鉴详情抽屉、抽屉里再叠开的子物品……而不只是某一张页面。
 *
 * 需要收藏列表的地方（指令页的「收藏 → 合成表」）自己调 `useRecipeFavoritesState()`；
 * 多个实例通过 `STORAGE_EVENT` 同步。
 */
export function RecipeFavoritesStoreProvider({ children }: { children: ReactNode }) {
  const { api } = useRecipeFavoritesState()
  return <RecipeFavoritesContext.Provider value={api}>{children}</RecipeFavoritesContext.Provider>
}
