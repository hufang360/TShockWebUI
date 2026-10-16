import { loadAtlasImage } from '@/lib/atlas'
import type { PlayerAtlas } from '@/types'

const BASE = import.meta.env.BASE_URL

let cache: Promise<PlayerAtlas> | null = null

/**
 * 懒加载玩家角色图集（`data/player-atlas.json`）。
 *
 * 只在「玩家管理」真正渲染角色预览时调用，不进入首屏 dataset；
 * 失败时清缓存，下次重试（与 `loadAtlasImage` 同策略）。
 */
export function loadPlayerAtlas(): Promise<PlayerAtlas> {
  if (!cache) {
    // Promise.resolve().then 包一层：Node 下相对 URL 可能让 fetch 同步抛错，
    // 统一转成 reject，调用方只处理异步失败。
    cache = Promise.resolve()
      .then(() => fetch(`${BASE}data/player-atlas.json`, { credentials: 'same-origin' }))
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载 player-atlas.json 失败：HTTP ${res.status}`)
        return (await res.json()) as PlayerAtlas
      })
      .catch((err: unknown) => {
        cache = null
        throw err
      })
  }
  return cache
}

/** 加载角色图集 PNG（复用物品图集的单例缓存）。 */
export function loadPlayerAtlasImage(atlas: PlayerAtlas): Promise<HTMLImageElement> {
  return loadAtlasImage(`${BASE}data/${atlas.meta.sheet}`)
}
