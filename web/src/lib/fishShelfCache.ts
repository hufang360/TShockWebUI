import type { FishCapabilities, FishShop } from '@/lib/tshock'

/**
 * 鱼店货架的本机缓存（按服务器分开）。
 *
 * 货架是**配置类**数据：只有服主改配置 + `/fish reload` 之后才会变，所以拉到一次就存下来，
 * 下次进页面直接用，只有手动刷新 / 重载配置成功才重新拉。
 *
 * 能力（capability）一起存：命中缓存就不必再探一次插件，进页面是 0 次上游请求
 * （以前是「探测 + 拉货架」两次 `/fishshop/list`）。
 */
export const FISH_SHELF_CACHE_VERSION = 1

/** 落盘上限：单份超过这个大小就只留在内存（localStorage 一共 5 MB，别让一份货架吃掉）。 */
export const FISH_SHELF_MAX_BYTES = 512 * 1024

/** 超过这个时间没更新就在页面上标警告色（货架可能已经和配置对不上了）。 */
export const FISH_SHELF_STALE_MS = 24 * 60 * 60 * 1000

export interface FishShelfCacheEntry {
  version: number
  /** 拉到货架的时间戳（ms）：页面上的「更新于 …」用它。 */
  at: number
  shop: FishShop
  capability: FishCapabilities
}

export interface FishShelfStore {
  byServer: Record<string, FishShelfCacheEntry>
}

export const EMPTY_FISH_SHELF_STORE: FishShelfStore = { byServer: {} }

/** 取某台服务器的货架缓存；版本不符 / 结构不像样一律当没有。 */
export function readFishShelfCache(store: unknown, serverId: string): FishShelfCacheEntry | null {
  const byServer = (store as FishShelfStore | null | undefined)?.byServer
  const entry = byServer?.[serverId]
  if (!entry || entry.version !== FISH_SHELF_CACHE_VERSION) return null
  if (!Number.isFinite(entry.at) || entry.at <= 0) return null
  if (!entry.shop || !Array.isArray(entry.shop.goods)) return null
  if (!entry.capability || typeof entry.capability !== 'object') return null
  return entry
}

/** 写入一份缓存；超过落盘上限时原样返回（调用方的界面仍用这次的货架，只是不落盘）。 */
export function writeFishShelfCache(
  store: FishShelfStore,
  serverId: string,
  entry: Omit<FishShelfCacheEntry, 'version'>,
): FishShelfStore {
  const full: FishShelfCacheEntry = { ...entry, version: FISH_SHELF_CACHE_VERSION }
  try {
    if (JSON.stringify(full).length > FISH_SHELF_MAX_BYTES) return store
  } catch {
    return store
  }
  return { byServer: { ...store.byServer, [serverId]: full } }
}

/** 货架是不是「超过 24 小时没更新」（`at` 为空 = 还没有货架，不算过期）。 */
export function isShelfStale(at: number | null, now: number): boolean {
  return at != null && now - at > FISH_SHELF_STALE_MS
}
