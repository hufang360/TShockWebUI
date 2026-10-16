/**
 * 指令执行结果的全局内存存储。
 *
 * 首页卡片的结果不能只放在 HomePage 组件里：用户切到别的页面时 HomePage 会卸载，
 * 但执行队列仍在后台继续跑。把结果放到 App 级存储，返回首页时能直接看到已完成的结果。
 *
 * 仅供渲染使用，刷新即清空；不写入 localStorage（不持久化任何服务器数据）。
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CommandResult } from '@/types'

export interface CommandResultsValue {
  /** key -> 最近一次执行结果（key 由调用方定义，如首页卡片 id）。 */
  results: Record<string, CommandResult>
  setResult: (key: string, result: CommandResult) => void
  clearResult: (key: string) => void
  clearAll: () => void
}

const noop = () => {}

const CommandResultsContext = createContext<CommandResultsValue>({
  results: {},
  setResult: noop,
  clearResult: noop,
  clearAll: noop,
})

export function CommandResultsProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<Record<string, CommandResult>>({})

  const setResult = useCallback((key: string, result: CommandResult) => {
    // 统一打上完成时间，供卡片底部展示「最后的执行时间」。
    setResults((prev) => ({ ...prev, [key]: { ...result, ts: Date.now() } }))
  }, [])

  const clearResult = useCallback((key: string) => {
    setResults((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const clearAll = useCallback(() => setResults({}), [])

  const value = useMemo<CommandResultsValue>(
    () => ({ results, setResult, clearResult, clearAll }),
    [results, setResult, clearResult, clearAll],
  )

  return <CommandResultsContext.Provider value={value}>{children}</CommandResultsContext.Provider>
}

/** 读取 / 写入全局指令结果存储。 */
export function useCommandResults(): CommandResultsValue {
  return useContext(CommandResultsContext)
}
