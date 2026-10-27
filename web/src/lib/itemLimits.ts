const BASE = import.meta.env.BASE_URL

/** `data/item-limits.json` 的原始形状（由 `tools/gamedump` 的 `--item-limits` 导出）。 */
interface ItemLimitsData {
  meta: {
    gameVersion: string
    itemCount: number
    source: string
    generatedBy: string
    note: string
  }
  maxStack: Record<string, number>
  noInventory: number[]
}

/** 物品数量 / 禁入背包规则（`.plr` 编辑器校验用）。 */
export interface ItemLimits {
  meta: ItemLimitsData['meta']
  /** 物品 id → 游戏自身的堆叠上限（`Item.maxStack`）。 */
  maxStackById: Map<number, number>
  /** 这些 id 在加载存档时会被 `FixAgainstExploit` 变成空气，编辑器直接拒绝。 */
  noInventory: Set<number>
}

let cache: Promise<ItemLimits> | null = null

/**
 * 懒加载物品数量规则（`data/item-limits.json`，约 70 KB）。
 *
 * 只在「查看存档 → 编辑」时用，不进首屏 dataset；失败时清缓存，下次重试
 * （与 `loadBuffAtlas` 同策略）。
 */
export function loadItemLimits(): Promise<ItemLimits> {
  if (!cache) {
    cache = Promise.resolve()
      .then(() => fetch(`${BASE}data/item-limits.json`, { credentials: 'same-origin' }))
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载 item-limits.json 失败：HTTP ${res.status}`)
        const data = (await res.json()) as ItemLimitsData
        return {
          meta: data.meta,
          maxStackById: new Map(Object.entries(data.maxStack).map(([id, n]) => [Number(id), n])),
          noInventory: new Set(data.noInventory),
        } satisfies ItemLimits
      })
      .catch((err: unknown) => {
        cache = null
        throw err
      })
  }
  return cache
}

/** 仅测试用：重置缓存。 */
export function resetItemLimitsCache(): void {
  cache = null
}
