/**
 * 指令执行结果的全局内存存储。
 *
 * 首页卡片的结果不能只放在 HomePage 组件里：用户切到别的页面时 HomePage 会卸载，
 * 但执行队列仍在后台继续跑。把结果放到 App 级存储，返回首页时能直接看到已完成的结果。
 *
 * **按服务器分开**：不同服务器的执行结果不一样，切换上游后不会再看到另一台的结果。
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
/** 未执行过结果时的稳定空对象（避免 useMemo 每次被无效刷新）。 */
const EMPTY_RESULTS: Record<string, CommandResult> = {}

const CommandResultsContext = createContext<CommandResultsValue>({
  results: {},
  setResult: noop,
  clearResult: noop,
  clearAll: noop,
})

export function CommandResultsProvider({
  serverId,
  children,
}: {
  /** 当前 TShock 上游 id；结果按它分开存放。 */
  serverId: string
  children: ReactNode
}) {
  const [byServer, setByServer] = useState<Record<string, Record<string, CommandResult>>>({})

  const setResult = useCallback(
    (key: string, result: CommandResult) => {
      // 统一打上完成时间，供卡片底部展示「最后的执行时间」。
      setByServer((prev) => ({
        ...prev,
        [serverId]: { ...(prev[serverId] ?? {}), [key]: { ...result, ts: Date.now() } },
      }))
    },
    [serverId],
  )

  const clearResult = useCallback(
    (key: string) => {
      setByServer((prev) => {
        const current = prev[serverId]
        if (!current || !(key in current)) return prev
        const next = { ...current }
        delete next[key]
        return { ...prev, [serverId]: next }
      })
    },
    [serverId],
  )

  const clearAll = useCallback(() => {
    setByServer((prev) => ({ ...prev, [serverId]: {} }))
  }, [serverId])

  const results = byServer[serverId] ?? EMPTY_RESULTS
  const value = useMemo<CommandResultsValue>(
    () => ({ results, setResult, clearResult, clearAll }),
    [results, setResult, clearResult, clearAll],
  )

  return <CommandResultsContext.Provider value={value}>{children}</CommandResultsContext.Provider>
}

/** 读取 / 写入当前服务器的指令结果存储。 */
export function useCommandResults(): CommandResultsValue {
  return useContext(CommandResultsContext)
}
