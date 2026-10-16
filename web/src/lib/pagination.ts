/**
 * 物品图鉴的列表分页与随机洗牌（纯函数，便于单测）。
 *
 * 图鉴约定：**每页默认 50 个**（翻页控件可改：50 / 100 / 200 / 500）；
 * 无搜索时按随机顺序分页，刷新页面即重新随机。详见 docs/页面-物品图鉴.md。
 */

/** 每页物品数默认值。 */
export const PAGE_SIZE = 50
/** 翻页控件可选的每页数量。 */
export const PAGE_SIZES = [50, 100, 200, 500] as const

/** mulberry32：确定性 PRNG。同 seed 同顺序，避免 StrictMode 双调用导致抖动。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates 洗牌，返回新数组，不修改入参。 */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}

/** 总页数（至少 1 页）。 */
export function totalPages(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** 把页码夹到 [1, pageCount]；非法值回落到 1。 */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, pageCount))
}

/** 取第 page 页（1 基）的切片。 */
export function paginate<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE): T[] {
  const start = (Math.max(1, Math.floor(page)) - 1) * pageSize
  return items.slice(start, start + pageSize)
}

/** 翻页器里的一项：页码，或省略号。 */
export type PageRangeItem = number | 'ellipsis'

/**
 * 计算翻页器要展示的页码窗口：始终含首/尾页，当前页两侧各 `siblings` 个，
 * 中间断开处用 `'ellipsis'` 占位（形如 `1 … 4 5 6 … 124`）。
 */
export function paginationRange(
  page: number,
  pageCount: number,
  siblings = 1,
): PageRangeItem[] {
  const count = Math.max(1, Math.floor(pageCount))
  const current = clampPage(page, count)
  const windowSize = siblings * 2 + 3
  if (count <= windowSize + 2) {
    return Array.from({ length: count }, (_, i) => i + 1)
  }
  const start = Math.max(2, current - siblings)
  const end = Math.min(count - 1, current + siblings)
  const out: PageRangeItem[] = [1]
  if (start > 2) out.push('ellipsis')
  else for (let i = 2; i < start; i += 1) out.push(i)
  for (let i = start; i <= end; i += 1) out.push(i)
  if (end < count - 1) out.push('ellipsis')
  else for (let i = end + 1; i < count; i += 1) out.push(i)
  out.push(count)
  return out
}
