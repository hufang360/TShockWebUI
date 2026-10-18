import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { addSearchHistory, sanitizeSearchHistory } from '@/lib/searchHistory'

type StorageKey = Parameters<typeof useLocalState>[0]

/**
 * 搜索记录（localStorage）。统一规则见 `lib/searchHistory.ts`：
 * 最多 10 条、去重、最新在前；窄区域只展示前 5 条由 `SearchInput` 负责。
 */
export function useSearchHistory(key: StorageKey): {
  history: string[]
  remember: (query: string) => void
  clear: () => void
} {
  const [raw, setRaw] = useLocalState<string[]>(key, [])
  const history = useMemo(() => sanitizeSearchHistory(raw), [raw])

  const remember = useCallback(
    (query: string) => {
      const next = addSearchHistory(history, query)
      // 内容没变就不写，避免无意义的重渲染 / 存储事件。
      if (next.length === history.length && next.every((x, i) => x === history[i])) return
      setRaw(next)
    },
    [history, setRaw],
  )

  const clear = useCallback(() => setRaw([]), [setRaw])

  return { history, remember, clear }
}
