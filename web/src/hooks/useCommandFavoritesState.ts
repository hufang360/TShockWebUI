import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import {
  addFavorite,
  isFavorited,
  removeFavorite,
  sanitizeFavorites,
  type CommandFavoritesApi,
} from '@/lib/favorites'
import { StorageKeys } from '@/lib/storage'
import type { FavoriteEntry } from '@/types'

/**
 * 收藏指令（`tswui:favorites`）的唯一状态实现。
 *
 * 「指令」页的收藏 tab / 结果卡片，以及详情页里的指令条目（数据 ID → NPC 的「相关指令」）
 * 用的是同一份数据：多实例靠 `useLocalState` 的 `STORAGE_EVENT` 同步，任意一处点 ⭐，
 * 其它地方立刻跟着变。
 */
export function useCommandFavoritesState(): {
  /** 按收藏时间倒序的收藏列表。 */
  list: FavoriteEntry[]
  /** 指令条目 ⭐ 用的读写接口。 */
  api: CommandFavoritesApi
} {
  const [raw, setRaw] = useLocalState<FavoriteEntry[]>(StorageKeys.favorites, [])
  const list = useMemo(() => sanitizeFavorites(raw), [raw])

  const toggle = useCallback(
    (cmd: string) => {
      setRaw((prev) => {
        const clean = sanitizeFavorites(prev)
        return isFavorited(clean, cmd) ? removeFavorite(clean, cmd) : addFavorite(clean, cmd)
      })
    },
    [setRaw],
  )

  const api = useMemo<CommandFavoritesApi>(
    () => ({ isFavorited: (cmd) => isFavorited(list, cmd), toggle }),
    [list, toggle],
  )

  return { list, api }
}
