import { ATLAS_JSON_FETCH, loadVerifiedAtlasImage } from '@/lib/atlas'
import type { BuffAtlas } from '@/types'

const BASE = import.meta.env.BASE_URL

let cache: Promise<BuffAtlas> | null = null

/**
 * 懒加载 Buff 图标图集（`data/buff-atlas.json`）。
 *
 * 只在渲染 Buff 图标时调用，不进入首屏 dataset；失败时清缓存，下次重试
 * （与 `loadNpcAtlas` / `loadPlayerAtlas` 同策略）。
 */
export function loadBuffAtlas(): Promise<BuffAtlas> {
  if (!cache) {
    // Promise.resolve().then 包一层：Node 下相对 URL 可能让 fetch 同步抛错，统一转成 reject。
    cache = Promise.resolve()
      .then(() => fetch(`${BASE}data/buff-atlas.json`, ATLAS_JSON_FETCH))
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载 buff-atlas.json 失败：HTTP ${res.status}`)
        return (await res.json()) as BuffAtlas
      })
      .catch((err: unknown) => {
        cache = null
        throw err
      })
  }
  return cache
}

/** 加载 Buff 图集 PNG（复用图集单例缓存；会校验尺寸与裁切表一致）。 */
export function loadBuffAtlasImage(atlas: BuffAtlas): Promise<HTMLImageElement> {
  return loadVerifiedAtlasImage(atlas)
}
