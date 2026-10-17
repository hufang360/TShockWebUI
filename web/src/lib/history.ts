import type { CommandStatus, HistoryEntry } from '@/types'

/** 历史记录上限（与收藏一致：写满只丢最旧）。 */
export const HISTORY_LIMIT = 100

const STATUSES: readonly CommandStatus[] = [
  'ok',
  'command_error',
  'no_permission',
  'token_invalid',
  'unavailable',
  'timeout',
  'bad_response',
  'rate_limited',
  'rejected',
]

function isStatus(value: unknown): value is CommandStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

/**
 * 从任意持久化数据恢复历史：丢弃非法项、为旧数据补齐 `status`。
 * 旧版本 / 手工改坏的 localStorage 不应让界面渲染出 `status.undefined`。
 */
export function sanitizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return []
  const out: HistoryEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const cmd = (raw as { cmd?: unknown }).cmd
    if (typeof cmd !== 'string' || !cmd.trim()) continue
    const rawTs = (raw as { ts?: unknown }).ts
    const ts = typeof rawTs === 'number' && Number.isFinite(rawTs) ? rawTs : Date.now()
    const rawOk = (raw as { ok?: unknown }).ok
    const ok = typeof rawOk === 'boolean' ? rawOk : false
    const rawStatus = (raw as { status?: unknown }).status
    const status = isStatus(rawStatus) ? rawStatus : ok ? 'ok' : 'command_error'
    out.push({ cmd, ts, ok, status })
  }
  return out.slice(0, HISTORY_LIMIT)
}
