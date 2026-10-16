/**
 * 全局指令执行队列。
 *
 * 所有批量 / 自动执行的指令（如首页「刷新全部」）都排入这里，串行执行，
 * 相邻两条之间按全局设置 `settings.commandInterval` 间隔，避免触发 TShock REST 限流；
 * 侧边栏据此展示「正在执行 / 等待执行」的指令。
 *
 * 语义：
 * - 队列空闲时，新任务**立即**执行（间隔只作用于同一批任务的先后顺序）；
 * - 先入先出；相同来源 + 相同指令若已在等待，则不重复入队（防抖 / StrictMode 双调用）；
 * - 正在执行的任务不可取消（REST 请求已发出），只允许取消尚未开始的等待项。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface QueueTask {
  id: string
  /** 来源标识（页面 / 功能），用于忙碌判断与随页面销毁取消。 */
  key: string
  /** 展示名（如「在线玩家」）；无 labelKey 时直接显示。 */
  label: string
  /** 展示名的 i18n key（优先于 label，便于语言切换后实时更新）。 */
  labelKey?: string
  /** 指令原文（如 /who）。 */
  command: string
  /** 实际执行逻辑；错误应在内部处理，队列只负责调度。 */
  run: () => Promise<void>
}

export type QueueTaskInput = Omit<QueueTask, 'id'>

export interface ExecutionQueueValue {
  /** 正在执行的任务。 */
  current: QueueTask | null
  /** 等待执行的任务（不含正在执行的）。 */
  pending: QueueTask[]
  /**
   * 入队；返回任务 id（被去重或未入队时返回空串）。
   * 相同 key + command 已在等待或执行时不会重复入队。
   */
  enqueue: (task: QueueTaskInput) => string
  /** 取消某个尚未执行的任务。 */
  cancel: (id: string) => void
  /** 取消某来源的所有等待任务（页面卸载时调用）。 */
  cancelByKey: (key: string) => void
  /** 清空全部等待任务（不打断正在执行的）。 */
  clear: () => void
  /** 该来源是否有任务在等待或执行；不传 key 表示任意任务。 */
  busy: (key?: string) => boolean
  /** 是否有任务 key 以 prefix 开头（如 'home:'）在等待或执行。 */
  busyPrefix: (prefix: string) => boolean
}

const noop = () => {}

const ExecutionQueueContext = createContext<ExecutionQueueValue>({
  current: null,
  pending: [],
  enqueue: () => '',
  cancel: noop,
  cancelByKey: noop,
  clear: noop,
  busy: () => false,
  busyPrefix: () => false,
})

let seq = 0
const nextTaskId = () => `q${++seq}`

export function ExecutionQueueProvider({
  interval,
  children,
}: {
  /** 相邻两条指令之间的间隔（毫秒，0 = 不间隔）。 */
  interval: number
  children: ReactNode
}) {
  const [current, setCurrentState] = useState<QueueTask | null>(null)
  const [pending, setPendingState] = useState<QueueTask[]>([])
  // 队列以 ref 为准，state 只用于渲染，避免异步回调读到过期的 pending。
  const pendingRef = useRef<QueueTask[]>([])
  const currentRef = useRef<QueueTask | null>(null)
  const runningRef = useRef(false)
  const lastFinishRef = useRef(0)
  const intervalRef = useRef(interval)

  useEffect(() => {
    intervalRef.current = interval
  }, [interval])

  const setPending = useCallback((next: QueueTask[]) => {
    pendingRef.current = next
    setPendingState(next)
  }, [])

  const setCurrent = useCallback((task: QueueTask | null) => {
    currentRef.current = task
    setCurrentState(task)
  }, [])

  const enqueue = useCallback(
    (task: QueueTaskInput): string => {
      const active = currentRef.current
      if (active && active.key === task.key && active.command === task.command) return ''
      if (pendingRef.current.some((t) => t.key === task.key && t.command === task.command)) return ''
      const id = nextTaskId()
      setPending([...pendingRef.current, { ...task, id }])
      return id
    },
    [setPending],
  )

  const cancel = useCallback(
    (id: string) => {
      if (!pendingRef.current.some((t) => t.id === id)) return
      setPending(pendingRef.current.filter((t) => t.id !== id))
    },
    [setPending],
  )

  const cancelByKey = useCallback(
    (key: string) => {
      const next = pendingRef.current.filter((t) => t.key !== key)
      if (next.length !== pendingRef.current.length) setPending(next)
    },
    [setPending],
  )

  const clear = useCallback(() => {
    if (pendingRef.current.length > 0) setPending([])
  }, [setPending])

  const busy = useCallback(
    (key?: string) => {
      if (current && (key === undefined || current.key === key)) return true
      return pending.some((t) => key === undefined || t.key === key)
    },
    [current, pending],
  )

  const busyPrefix = useCallback(
    (prefix: string) => {
      if (current && current.key.startsWith(prefix)) return true
      return pending.some((t) => t.key.startsWith(prefix))
    },
    [current, pending],
  )

  // 调度器：空闲且有待执行任务时，按间隔取出队首执行。
  useEffect(() => {
    if (runningRef.current || current) return
    const task = pendingRef.current[0]
    if (!task) return

    const gap = intervalRef.current
    const last = lastFinishRef.current
    const wait = last === 0 || gap <= 0 ? 0 : Math.max(0, gap - (Date.now() - last))

    const timer = setTimeout(() => {
      runningRef.current = true
      setPending(pendingRef.current.filter((t) => t.id !== task.id))
      setCurrent(task)
      void (async () => {
        try {
          await task.run()
        } catch {
          /* run 内部已处理错误；队列只保证继续执行后续任务 */
        } finally {
          lastFinishRef.current = pendingRef.current.length > 0 ? Date.now() : 0
          runningRef.current = false
          setCurrent(null)
        }
      })()
    }, wait)

    return () => clearTimeout(timer)
  }, [pending, current, interval, setPending, setCurrent])

  const value = useMemo<ExecutionQueueValue>(
    () => ({ current, pending, enqueue, cancel, cancelByKey, clear, busy, busyPrefix }),
    [current, pending, enqueue, cancel, cancelByKey, clear, busy, busyPrefix],
  )

  return <ExecutionQueueContext.Provider value={value}>{children}</ExecutionQueueContext.Provider>
}

/** 读取全局执行队列。 */
export function useExecutionQueue(): ExecutionQueueValue {
  return useContext(ExecutionQueueContext)
}
