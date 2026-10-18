/**
 * 搜索记录统一规则（所有带搜索的页面共用）。
 *
 * - **最多保留 `SEARCH_HISTORY_MAX`（10）条**，去重、最新在前。
 * - **窄区域只显示前 `SEARCH_HISTORY_NARROW_MAX`（5）条**（由 `SearchInput` 按容器宽度判定）。
 * - 搜索记录是纯本地偏好，存 localStorage；不参与服务端、不上传。
 *
 * 约定：以后任何页面要加「最近搜索」，都走这里，不要再各自写一套。
 */

/** 最多保留的条数。 */
export const SEARCH_HISTORY_MAX = 10
/** 窄区域最多展示的条数。 */
export const SEARCH_HISTORY_NARROW_MAX = 5

/** 从持久化数据恢复：只保留非空字符串，去重，最多 `SEARCH_HISTORY_MAX` 条。 */
export function sanitizeSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const q = item.trim()
    if (!q) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= SEARCH_HISTORY_MAX) break
  }
  return out
}

/** 把一次搜索加进记录：去重（忽略大小写）、最新在前、最多 `SEARCH_HISTORY_MAX` 条。 */
export function addSearchHistory(list: readonly string[], query: string): string[] {
  const q = query.trim()
  if (!q) return list as string[]
  const rest = list.filter((x) => x.toLowerCase() !== q.toLowerCase())
  return [q, ...rest].slice(0, SEARCH_HISTORY_MAX)
}
