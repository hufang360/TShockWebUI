/**
 * 指令执行结果的全局存储（按服务器分开，落盘在本机）。
 *
 * 卡片结果不能只放在页面组件里：用户切到别的页面时页面会卸载，
 * 但执行队列仍在后台继续跑。把结果放到 App 级存储，返回时能直接看到已完成的结果。
 *
 * **落盘**（`tswui:cardResults`）：手动执行的卡片不会自己跑，刷新浏览器后如果不恢复，
 * 「上次是什么时候执行的」这条信息就彻底没了（卡片左下角的「执行于 …」）。
 * 每张卡只留最近一次结果；**登出不清**（用户要求），换账号共用同一台浏览器时
 * 可能看到上一个玩家留下的快照，见 `docs/设计原则与约束.md` §4.6。
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { readJson, StorageKeys, writeJson } from '@/lib/storage'
import type { CommandResult, CommandStatus } from '@/types'

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

/** 单张卡落盘时最多保留的输出行：别让一条超长输出把配额吃光（界面本身也只展示 20 行）。 */
const MAX_OUTPUT_LINES = 200

type ResultsByKey = Record<string, CommandResult>
type ResultsByServer = Record<string, ResultsByKey>

function sanitizeResult(value: unknown): CommandResult | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.status !== 'string') return null
  if (!(STATUSES as readonly string[]).includes(raw.status)) return null
  const output = Array.isArray(raw.output)
    ? raw.output.filter((line): line is string => typeof line === 'string').slice(0, MAX_OUTPUT_LINES)
    : []
  return {
    status: raw.status as CommandStatus,
    output,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    ts: typeof raw.ts === 'number' && Number.isFinite(raw.ts) ? raw.ts : Date.now(),
  }
}

/** 从本机恢复结果：丢掉形状不对的服务器 / 卡片（手改过 localStorage 也不会白屏）。 */
function sanitizeStored(value: unknown): ResultsByServer {
  if (!value || typeof value !== 'object') return {}
  const out: ResultsByServer = {}
  for (const [serverId, byKey] of Object.entries(value as Record<string, unknown>)) {
    if (!byKey || typeof byKey !== 'object') continue
    const kept: ResultsByKey = {}
    for (const [key, entry] of Object.entries(byKey as Record<string, unknown>)) {
      const result = sanitizeResult(entry)
      if (result) kept[key] = result
    }
    if (Object.keys(kept).length > 0) out[serverId] = kept
  }
  return out
}

/**
 * 落盘版：去掉 `command_not_found`（当下状态，不是历史结果）。
 * 别的错误（无权限 / 超时）保留，第二天回来还能看到「上次是为什么失败」。
 */
function persistable(value: ResultsByServer): ResultsByServer {
  const out: ResultsByServer = {}
  for (const [serverId, byKey] of Object.entries(value)) {
    const kept: ResultsByKey = {}
    for (const [key, result] of Object.entries(byKey)) {
      if (result.status === 'command_not_found') continue
      kept[key] = result
    }
    if (Object.keys(kept).length > 0) out[serverId] = kept
  }
  return out
}

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
  // 只在挂载时读一次（清洗后）：写入的都是本模块构造的数据，不需要每次都洗。
  const [byServer, setByServer] = useState<ResultsByServer>(() =>
    sanitizeStored(readJson(StorageKeys.cardResults, {})),
  )

  const update = useCallback((next: (prev: ResultsByServer) => ResultsByServer) => {
    setByServer((prev) => {
      const resolved = next(prev)
      // 「指令不存在」多是插件未装 / 上游刚重启，属于当下状态而不是历史结果：
      // 落盘会让刷新后重新弹出来"插件未安装"陈年错误（内存里仍保留，缺插件判定照旧）。
      writeJson(StorageKeys.cardResults, persistable(resolved))
      return resolved
    })
  }, [])

  const setResult = useCallback(
    (key: string, result: CommandResult) => {
      // 统一打上完成时间，供卡片底部展示「最后的执行时间」。
      update((prev) => ({
        ...prev,
        [serverId]: { ...(prev[serverId] ?? {}), [key]: { ...result, ts: Date.now() } },
      }))
    },
    [serverId, update],
  )

  const clearResult = useCallback(
    (key: string) => {
      update((prev) => {
        const current = prev[serverId]
        if (!current || !(key in current)) return prev
        const next = { ...current }
        delete next[key]
        return { ...prev, [serverId]: next }
      })
    },
    [serverId, update],
  )

  const clearAll = useCallback(() => {
    update((prev) => ({ ...prev, [serverId]: {} }))
  }, [serverId, update])

  // `byServer` 本身已经很稳定（只在写入时换新对象），这里只兜一次「该服务器还没有结果」。
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
