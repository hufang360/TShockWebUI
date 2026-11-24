import { ATLAS_JSON_FETCH, loadVerifiedAtlasImage } from '@/lib/atlas'
import type { ProjectileAtlas } from '@/types'

const BASE = import.meta.env.BASE_URL

let cache: Promise<ProjectileAtlas> | null = null

/**
 * 懒加载射弹图标图集（`data/projectile-atlas.json`）。
 *
 * 只在渲染射弹图标时调用，不进入首屏 dataset；失败时清缓存，下次重试
 * （与 `loadNpcAtlas` / `loadBuffAtlas` 同策略）。
 */
export function loadProjectileAtlas(): Promise<ProjectileAtlas> {
  if (!cache) {
    // Promise.resolve().then 包一层：Node 下相对 URL 可能让 fetch 同步抛错，统一转成 reject。
    cache = Promise.resolve()
      .then(() => fetch(`${BASE}data/projectile-atlas.json`, ATLAS_JSON_FETCH))
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载 projectile-atlas.json 失败：HTTP ${res.status}`)
        return (await res.json()) as ProjectileAtlas
      })
      .catch((err: unknown) => {
        cache = null
        throw err
      })
  }
  return cache
}

/** 加载射弹图集 PNG（复用图集单例缓存；会校验尺寸与裁切表一致）。 */
export function loadProjectileAtlasImage(atlas: ProjectileAtlas): Promise<HTMLImageElement> {
  return loadVerifiedAtlasImage(atlas)
}
