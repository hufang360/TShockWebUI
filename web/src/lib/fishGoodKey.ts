import type { FishGood } from '@/lib/tshock'

/**
 * 鱼店商品的**稳定身份**：收藏 / 「买过」都不能存 `serial`。
 *
 * 为什么不能存 `serial`：`serial` 是插件配置数组的下标（`_config.shop[serial - 1]`，
 * 见插件 `BuyGoods.cs`）。服主上架 / 下架／插入一件商品，后面所有商品的 `serial` 整体前移或后退，
 * 存下来的 `#12` 就会指向别的商品 —— 「收藏」变成收藏了别的东西，「买过」也认错。
 *
 * 所以用**内容指纹**认商品（与 `RecipeFavorite` 不存下标同一个理由）：
 * - 严格指纹 = 物品 id / 堆叠 / 词缀 / 参数要求 + 名称 + 指令（`cmds`）；
 * - 宽松指纹 = 上面去掉名称，商品被改名后仍能对上。
 *
 * 刻意**不把价格放进指纹**：服主调价不该让收藏失效。
 */
export interface FishGoodStamp {
  /** 图鉴 / 收藏列表里存的是这条（含快照，商品下架后还能显示图标与名称）。 */
  key: string
  ts: number
  good: FishGood
}

const norm = (value: string) => value.trim().toLowerCase()

/** 商品里不随「上架顺序 / 价格 / 改名」变化的部分。 */
function identityBase(good: FishGood): string {
  return [good.id ?? 0, good.stack ?? 0, good.prefix ?? 0, good.needArgs ? 1 : 0, good.argCount ?? 0].join(
    ':',
  )
}

/** 指令类商品真正做的事（原版物品为空串）；服务类商品的 `id` 会重复，靠它区分。 */
function cmdsSignature(good: FishGood): string {
  return (good.cmds ?? []).map(norm).join(';')
}

export function fishGoodKey(good: FishGood): string {
  return `${identityBase(good)}|${norm(good.name)}|${cmdsSignature(good)}`
}

export function fishGoodLooseKey(good: FishGood): string {
  return `${identityBase(good)}|${cmdsSignature(good)}`
}

/**
 * 在货架上找同一件商品：先按严格指纹；找不到再按宽松指纹（**只有唯一命中才算**，
 * 免得把两件同 id 的商品认成一件）。
 */
export function findLiveGood(target: FishGood, shelf: FishGood[]): FishGood | null {
  const key = fishGoodKey(target)
  const exact = shelf.filter((good) => fishGoodKey(good) === key)
  // 同款可能上了两次（内容完全一样）：优先认编号也相同的那一条，否则点 A 会打开 B。
  if (exact.length > 0) return exact.find((good) => good.serial === target.serial) ?? exact[0]
  const looseKey = fishGoodLooseKey(target)
  const loose = shelf.filter((good) => fishGoodLooseKey(good) === looseKey)
  return loose.length === 1 ? loose[0] : null
}

export interface ResolvedStamp {
  stamp: FishGoodStamp
  /** 货架上的同款（已下架时是存下来的快照）。 */
  good: FishGood
  live: boolean
}

/**
 * 把「买过 / 收藏」解析成当前货架上的商品：同一件货架商品只归一条记录，
 * 已下架的用快照占位（图标与名称还在，点开提示已下架）。
 */
export function resolveStamps(stamps: FishGoodStamp[], shelf: FishGood[]): ResolvedStamp[] {
  const used = new Set<number>()
  return stamps.map((stamp) => {
    const key = fishGoodKey(stamp.good)
    const looseKey = fishGoodLooseKey(stamp.good)
    const exact = shelf.find((good) => !used.has(good.serial) && fishGoodKey(good) === key)
    if (exact) {
      used.add(exact.serial)
      return { stamp, good: exact, live: true }
    }
    const loose = shelf.filter((good) => !used.has(good.serial) && fishGoodLooseKey(good) === looseKey)
    if (loose.length === 1) {
      used.add(loose[0].serial)
      return { stamp, good: loose[0], live: true }
    }
    return { stamp, good: stamp.good, live: false }
  })
}

/** 本机存的记录可能被改坏：只留结构对得上的，按指纹去重、保留最新的，最多 `max` 条。 */
export function sanitizeStamps(value: unknown, max: number): FishGoodStamp[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: FishGoodStamp[] = []
  for (const entry of value) {
    const stamp = entry as FishGoodStamp
    if (!stamp || typeof stamp.key !== 'string' || !stamp.good) continue
    if (typeof stamp.good.name !== 'string' || typeof stamp.good.serial !== 'number') continue
    if (seen.has(stamp.key)) continue
    seen.add(stamp.key)
    out.push({ key: stamp.key, ts: typeof stamp.ts === 'number' ? stamp.ts : 0, good: stamp.good })
    if (out.length >= max) break
  }
  return out
}

/** 记一条（同指纹只留最新，最新在前，超上限丢最旧的）。 */
export function stampGood(stamps: FishGoodStamp[], good: FishGood, max: number): FishGoodStamp[] {
  const key = fishGoodKey(good)
  const rest = stamps.filter((stamp) => stamp.key !== key)
  return [{ key, ts: Date.now(), good }, ...rest].slice(0, max)
}

export function unstampGood(stamps: FishGoodStamp[], good: FishGood): FishGoodStamp[] {
  const key = fishGoodKey(good)
  return stamps.filter((stamp) => stamp.key !== key)
}

/**
 * 旧版本只存了 `recentBuys`（没有指纹）：换算成「买过」，避免升级后历史记录凭空消失。
 */
export function migrateRecentBuys(value: unknown): FishGoodStamp[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: FishGoodStamp[] = []
  for (const good of value as FishGood[]) {
    if (!good || typeof good.serial !== 'number' || typeof good.name !== 'string') continue
    out.push({ key: fishGoodKey(good), ts: Date.now(), good })
  }
  return out.length > 0 ? out : null
}
