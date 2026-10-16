import { useEffect, useRef, useState } from 'react'
import {
  TshockRequestError,
  type BackendTransport,
  type ServerEvent,
  type ServerInfoExtra,
} from '@/lib/tshock'

export interface ServerFeedState {
  /** 最近的事件（最新在前，最多 `maxEvents` 条）。 */
  events: ServerEvent[]
  /** 世界状态徽标来源（困难模式 / 血月 / …）；插件缺失或未拉到时为 null。 */
  extra: ServerInfoExtra | null
  /** 信使插件可用性：null = 未知（不隐藏卡片），true = 可用，false = 未安装。 */
  available: boolean | null
  /** 上次成功刷新的本地时间戳；未刷新过为 null。 */
  refreshedAt: number | null
}

/**
 * 服务器动态（首页卡片 + 指令页「动态」tab 共用）。
 *
 * - 挂载即刷新一次（进入首页 / 指令模块即触发）；
 * - 之后每 `refreshInterval` 毫秒刷新（间隔在「设置 → 服务器动态刷新间隔」里选）；
 * - `refreshToken` 变化时也会立刻刷新（「页面数据刷新间隔」触发时连带刷新）；
 * - 刷新 = 拉一次增强状态（含游戏内时间）+ 事件流增量。
 */
export function useServerFeed(opts: {
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  /** 单次保留的最大事件条数（默认 20）。 */
  maxEvents?: number
  /** 自动刷新间隔（毫秒）。 */
  refreshInterval: number
  /** 外部触发刷新：数值变化即刷新一次（不重置已有事件）。 */
  refreshToken?: number
}): ServerFeedState {
  const { transport, authenticated, serverId, maxEvents = 20, refreshInterval, refreshToken } = opts
  const [events, setEvents] = useState<ServerEvent[]>([])
  const [extra, setExtra] = useState<ServerInfoExtra | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const lastSeqRef = useRef(0)
  const tickRef = useRef<() => void>(() => {})

  useEffect(() => {
    // 用同一套「清空」逻辑处理登出与切换服务器；用函数式更新保持空引用不变，避免无谓重渲染。
    const reset = () => {
      setExtra((prev) => (prev === null ? prev : null))
      setEvents((prev) => (prev.length === 0 ? prev : []))
      setAvailable((prev) => (prev === null ? prev : null))
      setRefreshedAt((prev) => (prev === null ? prev : null))
      lastSeqRef.current = 0
    }
    if (!authenticated) {
      reset()
      return
    }
    let cancelled = false
    let timer: number | undefined
    // 切换服务器 / 重新登录：清空上一条流，避免把两个服务器的事件拼在一起。
    reset()

    const tick = async () => {
      try {
        const info = await transport.serverInfoExtra()
        if (cancelled) return
        setExtra(info)
        const page = await transport.events(lastSeqRef.current)
        if (cancelled) return
        lastSeqRef.current = page.lastSeq
        setAvailable(true)
        setRefreshedAt(Date.now())
        if (page.events.length > 0) {
          setEvents((prev) => [...page.events, ...prev].slice(0, maxEvents))
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof TshockRequestError && err.kind === 'plugin_missing') {
          setAvailable(false)
          setExtra(null)
          if (timer) window.clearInterval(timer)
        }
      }
    }
    tickRef.current = () => void tick()
    void tick()
    timer = window.setInterval(() => void tick(), Math.max(10000, refreshInterval))
    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [authenticated, transport, serverId, maxEvents, refreshInterval])

  // 页面数据刷新间隔触发 → 连带刷新服务器动态（不重置已有事件）。
  const lastTokenRef = useRef(refreshToken ?? 0)
  useEffect(() => {
    if (refreshToken == null) return
    if (refreshToken === lastTokenRef.current) return
    lastTokenRef.current = refreshToken
    tickRef.current()
  }, [refreshToken])

  return { events, extra, available, refreshedAt }
}
