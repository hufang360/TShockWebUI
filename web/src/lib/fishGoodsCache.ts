import type { BackendTransport, FishGood } from '@/lib/tshock'

/**
 * 全局搜索用的「鱼店货架」缓存（按服务器分开，只在内存里）。
 *
 * 货架本来只由鱼店页面拉取，搜索要用就得有一份跨页面可用的数据。这里不重复实现拉取策略，
 * 只做三件事：按 `serverId` 缓存、同一时刻只发一个请求（in-flight 去重）、失败不缓存（下次再试）。
 *
 * 缓存的失效靠**用户主动**：点搜索里打开弹框时会 `refresh` 一次（有缓存也照拉），
 * 因为货架会随插件配置变化，而搜索场景对“新鲜度”的容忍度比鱼店页低（那里有自己的刷新按钮）。
 */
const cache = new Map<string, FishGood[]>()
const inflight = new Map<string, Promise<FishGood[]>>()

export function getCachedFishGoods(serverId: string): FishGood[] | undefined {
  return cache.get(serverId)
}

/** 拉取（或复用已在飞的请求）。失败时抛错，由调用方决定是否静默。 */
export function loadFishGoods(
  transport: BackendTransport,
  serverId: string,
  opts: { force?: boolean } = {},
): Promise<FishGood[]> {
  if (!opts.force) {
    const hit = cache.get(serverId)
    if (hit) return Promise.resolve(hit)
  }
  const running = inflight.get(serverId)
  if (running) return running

  const request = transport
    .fishList()
    .then((shop) => {
      cache.set(serverId, shop.goods)
      return shop.goods
    })
    .finally(() => {
      inflight.delete(serverId)
    })
  inflight.set(serverId, request)
  return request
}

/** 清掉某个服的缓存（切服 / 退出登录时用）。 */
export function clearFishGoods(serverId?: string): void {
  if (serverId) cache.delete(serverId)
  else cache.clear()
}

/** 单测用：连同 in-flight 一起清空。 */
export function resetFishGoodsCache(): void {
  cache.clear()
  inflight.clear()
}
