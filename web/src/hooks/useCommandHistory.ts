import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { HISTORY_LIMIT, sanitizeHistory } from '@/lib/history'
import { StorageKeys } from '@/lib/storage'
import type { HistoryEntry } from '@/types'

/**
 * 指令历史（`tswui:history`）。
 *
 * 指令页与浮动终端共用同一份历史：在终端里执行过的指令，回到指令页能直接回翻 / 查看。
 * 存储层是同 key 的 `useLocalState`，两个组件同时挂载时通过 `STORAGE_EVENT` 实时同步。
 */
export interface CommandHistoryApi {
  /** 最新在前（已 sanitize，上限 HISTORY_LIMIT 条）。 */
  history: HistoryEntry[]
  push: (entry: HistoryEntry) => void
  remove: (entry: HistoryEntry) => void
  /** 同一指令只保留最新一条。 */
  dedupe: () => void
  clear: () => void
}

export function useCommandHistory(): CommandHistoryApi {
  const [raw, setRaw] = useLocalState<HistoryEntry[]>(StorageKeys.history, [])
  const history = useMemo(() => sanitizeHistory(raw), [raw])

  const push = useCallback(
    (entry: HistoryEntry) => {
      setRaw((prev) => [entry, ...sanitizeHistory(prev)].slice(0, HISTORY_LIMIT))
    },
    [setRaw],
  )

  const remove = useCallback(
    (entry: HistoryEntry) => {
      setRaw((prev) =>
        sanitizeHistory(prev).filter((h) => !(h.ts === entry.ts && h.cmd === entry.cmd)),
      )
    },
    [setRaw],
  )

  const dedupe = useCallback(() => {
    setRaw((prev) => {
      const seen = new Set<string>()
      return sanitizeHistory(prev).filter((h) => {
        if (seen.has(h.cmd)) return false
        seen.add(h.cmd)
        return true
      })
    })
  }, [setRaw])

  const clear = useCallback(() => setRaw([]), [setRaw])

  return useMemo(
    () => ({ history, push, remove, dedupe, clear }),
    [history, push, remove, dedupe, clear],
  )
}
