import { useCallback, useMemo } from 'react'
import type { ResultEntry } from '@/components/ResultPanel'
import { useLocalState } from '@/hooks/useLocalState'
import { StorageKeys } from '@/lib/storage'
import type { CommandResult, CommandStatus } from '@/types'

/** 结果卡片保留最近 N 条（更早的自动丢弃）。 */
export const RESULT_LIMIT = 20

const STATUSES: readonly CommandStatus[] = [
  'ok',
  'command_not_found',
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

/** 从本机恢复结果卡片：丢弃非法项，只保留合法的 output / status。 */
export function sanitizeResults(value: unknown): ResultEntry[] {
  if (!Array.isArray(value)) return []
  const out: ResultEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const seq = (raw as { seq?: unknown }).seq
    const command = (raw as { command?: unknown }).command
    const result = (raw as { result?: unknown }).result
    if (typeof seq !== 'number' || typeof command !== 'string') continue
    if (!result || typeof result !== 'object') continue
    const r = result as Record<string, unknown>
    if (!isStatus(r.status)) continue
    const output = Array.isArray(r.output)
      ? r.output.filter((line): line is string => typeof line === 'string')
      : []
    const ts = (raw as { ts?: unknown }).ts
    const collapsed = (raw as { collapsed?: unknown }).collapsed
    out.push({
      seq,
      ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now(),
      command,
      collapsed: collapsed === true,
      result: {
        status: r.status,
        output,
        message: typeof r.message === 'string' ? r.message : undefined,
      },
    })
  }
  return out.slice(-RESULT_LIMIT)
}

/**
 * 指令执行结果（`tswui:commandResults`，**按服务器分开**）。
 *
 * 指令页与浮动终端共用同一份结果：在终端里执行完，切回指令页能直接看到那一条；
 * 反过来也一样。追加时 seq 接着现有最大值，避免两边各自递增撞号。
 */
export interface CommandResultsApi {
  results: ResultEntry[]
  append: (command: string, result: CommandResult) => void
  remove: (seq: number) => void
  /** 折叠 / 展开单条结果（随结果持久化）。 */
  toggleCollapse: (seq: number, collapsed: boolean) => void
  /** 一次折叠 / 展开全部结果卡片。 */
  setAllCollapsed: (collapsed: boolean) => void
  clear: () => void
}

export function useCommandResultsList(serverId: string): CommandResultsApi {
  const [rawByServer, setRawByServer] = useLocalState<Record<string, ResultEntry[]>>(
    StorageKeys.commandResults,
    {},
  )
  const results = useMemo(() => sanitizeResults(rawByServer[serverId]), [rawByServer, serverId])

  /** 更新当前服务器的结果列表（每次都做一次 sanitize）。 */
  const setResults = useCallback(
    (updater: (prev: ResultEntry[]) => ResultEntry[]) => {
      setRawByServer((prev) => ({
        ...prev,
        [serverId]: updater(sanitizeResults(prev[serverId])),
      }))
    },
    [serverId, setRawByServer],
  )

  const append = useCallback(
    (command: string, result: CommandResult) => {
      setResults((prev) => {
        const seq = (prev.length ? Math.max(...prev.map((e) => e.seq)) : 0) + 1
        const entry: ResultEntry = { seq, ts: Date.now(), command, result }
        return [...prev, entry].slice(-RESULT_LIMIT)
      })
    },
    [setResults],
  )

  const remove = useCallback(
    (seq: number) => {
      setResults((prev) => prev.filter((e) => e.seq !== seq))
    },
    [setResults],
  )

  const clear = useCallback(() => setResults(() => []), [setResults])

  const toggleCollapse = useCallback(
    (seq: number, collapsed: boolean) => {
      setResults((prev) => prev.map((e) => (e.seq === seq ? { ...e, collapsed } : e)))
    },
    [setResults],
  )

  const setAllCollapsed = useCallback(
    (collapsed: boolean) => {
      setResults((prev) => prev.map((e) => ({ ...e, collapsed })))
    },
    [setResults],
  )

  return useMemo(
    () => ({ results, append, remove, toggleCollapse, setAllCollapsed, clear }),
    [results, append, remove, toggleCollapse, setAllCollapsed, clear],
  )
}
