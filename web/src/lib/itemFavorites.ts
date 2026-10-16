import type { ItemFavorite } from '@/types'

/** 物品收藏上限（与指令收藏一致：写满只丢最旧）。 */
export const ITEM_FAVORITES_LIMIT = 200

/** 从任意持久化数据恢复物品收藏：丢弃非法/重复项并按上限截断。 */
export function sanitizeItemFavorites(value: unknown): ItemFavorite[] {
  if (!Array.isArray(value)) return []
  const out: ItemFavorite[] = []
  const seen = new Set<number>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = (raw as { id?: unknown }).id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    const rawTs = (raw as { ts?: unknown }).ts
    const ts = typeof rawTs === 'number' && Number.isFinite(rawTs) ? rawTs : Date.now()
    seen.add(id)
    out.push({ id, ts })
  }
  return out.slice(0, ITEM_FAVORITES_LIMIT)
}

export function isItemFavorited(list: ItemFavorite[], id: number): boolean {
  return list.some((f) => f.id === id)
}

/** 收藏（已存在则置顶并刷新时间）。 */
export function addItemFavorite(list: ItemFavorite[], id: number, ts = Date.now()): ItemFavorite[] {
  return [{ id, ts }, ...list.filter((f) => f.id !== id)].slice(0, ITEM_FAVORITES_LIMIT)
}

export function removeItemFavorite(list: ItemFavorite[], id: number): ItemFavorite[] {
  return list.filter((f) => f.id !== id)
}
