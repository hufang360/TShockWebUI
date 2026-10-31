import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import {
  addRecipeFavorite,
  isRecipeFavorited,
  removeRecipeFavorite,
  sanitizeRecipeFavorites,
} from '@/lib/recipeFavorites'
import type { RecipeFavoritesApi } from '@/lib/recipeFavoritesContext'
import { StorageKeys } from '@/lib/storage'
import type { RecipeFavorite } from '@/types'

/**
 * 合成记录收藏（`tswui:recipeFavorites`）的唯一状态实现。
 *
 * 与物品收藏同一套路：App 顶层挂 `RecipeFavoritesStoreProvider`，让**全站**的合成表条目
 * （图鉴详情抽屉、堆叠的子抽屉……）都能点 ⭐；「指令」页的收藏 panel 自己再调本 hook 拿列表。
 * 多实例靠 `useLocalState` 的 `STORAGE_EVENT` 同步，任意一处点 ⭐，收藏列表立刻跟着变。
 */
export function useRecipeFavoritesState(): {
  /** 按收藏时间倒序的收藏列表。 */
  list: RecipeFavorite[]
  /** 合成表条目 ⭐ 用的读写接口。 */
  api: RecipeFavoritesApi
  toggle: (key: string) => void
  remove: (key: string) => void
  clear: () => void
} {
  const [raw, setRaw] = useLocalState<RecipeFavorite[]>(StorageKeys.recipeFavorites, [])
  const list = useMemo(() => sanitizeRecipeFavorites(raw), [raw])

  const toggle = useCallback(
    (key: string) => {
      setRaw((prev) => {
        const clean = sanitizeRecipeFavorites(prev)
        return isRecipeFavorited(clean, key)
          ? removeRecipeFavorite(clean, key)
          : addRecipeFavorite(clean, key)
      })
    },
    [setRaw],
  )

  const remove = useCallback(
    (key: string) => {
      setRaw((prev) => removeRecipeFavorite(sanitizeRecipeFavorites(prev), key))
    },
    [setRaw],
  )

  const clear = useCallback(() => setRaw([]), [setRaw])

  const api = useMemo<RecipeFavoritesApi>(
    () => ({ isFavorited: (key) => isRecipeFavorited(list, key), toggle }),
    [list, toggle],
  )

  return { list, api, toggle, remove, clear }
}
