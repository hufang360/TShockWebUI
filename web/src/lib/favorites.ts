import type { FavoriteEntry } from '@/types'

/** 收藏上限（与历史一致：写满只丢最旧，不报错）。 */
export const FAVORITES_LIMIT = 100

/**
 * 归一化收藏键：只取第一条非空行、去首尾空白、折叠内部空白。
 * 这样 `/time   12:00` 与 `/time 12:00` 视为同一条，多行输入也不会污染收藏。
 */
export function normalizeFavorite(cmd: string): string {
  const first = cmd.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  return first.trim().replace(/\s+/g, ' ')
}

/**
 * 从任意持久化数据恢复收藏列表：丢弃非法/重复项并按上限截断。
 * 旧版本或手工改坏的 localStorage 不应让界面崩溃。
 */
export function sanitizeFavorites(value: unknown): FavoriteEntry[] {
  if (!Array.isArray(value)) return []
  const out: FavoriteEntry[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const cmd = (raw as { cmd?: unknown }).cmd
    const normalized = typeof cmd === 'string' ? normalizeFavorite(cmd) : ''
    if (!normalized || seen.has(normalized)) continue
    const rawTs = (raw as { ts?: unknown }).ts
    const ts = typeof rawTs === 'number' && Number.isFinite(rawTs) ? rawTs : Date.now()
    seen.add(normalized)
    out.push({ cmd: normalized, ts })
  }
  return out.slice(0, FAVORITES_LIMIT)
}

export function isFavorited(list: FavoriteEntry[], cmd: string): boolean {
  const key = normalizeFavorite(cmd)
  return key.length > 0 && list.some((f) => f.cmd === key)
}

/** 收藏（已存在则置顶并刷新时间）。 */
export function addFavorite(list: FavoriteEntry[], cmd: string, ts = Date.now()): FavoriteEntry[] {
  const key = normalizeFavorite(cmd)
  if (!key) return list
  const rest = list.filter((f) => f.cmd !== key)
  return [{ cmd: key, ts }, ...rest].slice(0, FAVORITES_LIMIT)
}

export function removeFavorite(list: FavoriteEntry[], cmd: string): FavoriteEntry[] {
  const key = normalizeFavorite(cmd)
  return list.filter((f) => f.cmd !== key)
}
