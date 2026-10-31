import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import {
  addItemFavorite,
  isItemFavorited,
  removeItemFavorite,
  sanitizeItemFavorites,
} from '@/lib/itemFavorites'
import type { ItemFavoritesApi } from '@/lib/itemFavoritesContext'
import { StorageKeys } from '@/lib/storage'
import type { ItemFavorite } from '@/types'

/**
 * 物品收藏（`tswui:itemFavorites`）的唯一状态实现。
 *
 * 为什么是 hook 而不是「只有 App 顶上那一份 state」：物品提示散落在页面、浮动终端、首页卡片、
 * 聊天等各处，提示里的 ⭐ 需要**到处都能点**。App 顶层挂一个 `ItemFavoritesStoreProvider`
 * 覆盖所有非页面区域；页面（图鉴 / 指令）自己也调本 hook（收藏列表要做筛选 / tab）。
 * 多个实例之间靠 `useLocalState` 的 `STORAGE_EVENT` 同步：任意一处点 ⭐，其它位置的提示立刻跟着变。
 */
export function useItemFavoritesState(): {
  /** 按收藏时间倒序的收藏列表。 */
  list: ItemFavorite[]
  /** 提示里 ⭐ 用的读写接口。 */
  api: ItemFavoritesApi
  toggle: (id: number) => void
  remove: (id: number) => void
  clear: () => void
} {
  const [raw, setRaw] = useLocalState<ItemFavorite[]>(StorageKeys.itemFavorites, [])
  const list = useMemo(() => sanitizeItemFavorites(raw), [raw])

  const toggle = useCallback(
    (id: number) => {
      setRaw((prev) => {
        const clean = sanitizeItemFavorites(prev)
        return isItemFavorited(clean, id)
          ? removeItemFavorite(clean, id)
          : addItemFavorite(clean, id)
      })
    },
    [setRaw],
  )

  const remove = useCallback(
    (id: number) => {
      setRaw((prev) => removeItemFavorite(sanitizeItemFavorites(prev), id))
    },
    [setRaw],
  )

  const clear = useCallback(() => setRaw([]), [setRaw])

  const api = useMemo<ItemFavoritesApi>(
    () => ({ isFavorited: (id) => isItemFavorited(list, id), toggle }),
    [list, toggle],
  )

  return { list, api, toggle, remove, clear }
}
