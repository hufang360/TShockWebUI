import { createContext, useContext } from 'react'

/** 合成记录收藏的读写接口：由页面（或全局 Provider）提供，合成表条目的 ⭐ 用它。 */
export interface RecipeFavoritesApi {
  isFavorited: (key: string) => boolean
  toggle: (key: string) => void
}

/**
 * 收藏上下文的载体。放在 `.ts`（而不是 Provider 所在的 `.tsx`）：
 * 组件文件只导出组件，Fast Refresh 才不会因为多了一个 hook 导出而整页刷新。
 */
export const RecipeFavoritesContext = createContext<RecipeFavoritesApi | null>(null)

/**
 * 取合成记录收藏接口。
 * 未提供 Provider 时返回 `null`（合成表条目不渲染 ⭐），便于单独渲染组件的测试。
 */
export function useRecipeFavorites(): RecipeFavoritesApi | null {
  return useContext(RecipeFavoritesContext)
}
