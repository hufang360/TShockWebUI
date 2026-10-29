import { useEffect, useRef, useState } from 'react'
import {
  TshockRequestError,
  type BackendTransport,
  type ServerEvent,
  type ServerInfoExtra,
} from '@/lib/tshock'

/** 插件缺失时的慢速重试间隔：装好插件后能自动恢复，又不会狂打 404。 */
const MISSING_RETRY_MS = 30000

/**
 * 单次拉取下限：即使只保留少量事件（如首页 20 条），也至少请求 50 条，
 * 以便「加载更早」有足够的数据可用。
 */
const EVENTS_FETCH_MIN = 50

export interface ServerFeedState {
  /** 最近的事件（按 seq 升序：最旧在前、最新在后；最多 `maxEvents` 条）。 */
  events: ServerEvent[]
  /** 世界状态徽标来源（困难模式 / 血月 / …）；插件缺失或未拉到时为 null。 */
  extra: ServerInfoExtra | null
  /** 信使插件可用性：null = 未知（不隐藏卡片），true = 可用，false = 未安装。 */
  available: boolean | null
  /** 上次成功刷新的本地时间戳；未刷新过为 null。 */
  refreshedAt: number | null
  /**
   * 最近一次「上游换了服」的本地时间戳（同一个地址 / 端口下换了另一个服）；
   * 没发生过为 null。界面据此显示一小会儿提示，然后自行消失。
   */
  switchedAt: number | null
  /**
   * 手动**强制重新同步**：关掉 SSE、忘掉 lastSeq，按「首次打开」重拉尾部事件并重连。
   * 已有事件按 seq 去重合并，不会重复或清空。
   */
  refresh: () => void
  /** 手动刷新进行中（用于按钮转圈）；自动轮询不会置 true。 */
  refreshing: boolean
}

/**
 * 服务器动态（首页卡片 + 指令页「动态」tab 共用）。
 *
 * - 挂载即刷新一次：先取 `eventsTail`（最近 N 条，新插件走磁盘历史；旧插件 / 未实现则退回
 *   `events(since=0)`）并拉一次增强状态；
 * - **实时**：传输层实现 `eventsStream`（SSE）时优先长连接推送；连接失败 / 未实现则按
 *   `refreshInterval` 轮询插件事件；
 * - 世界状态（游戏内时间 / 徽标）仍按 `refreshInterval` 拉一次；
 * - `refreshToken` 变化时立刻刷新（「页面数据刷新间隔」触发）；
 * - 页面隐藏时断开 SSE，回到前台重连，省连接与 TShock REST 限额。
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
  /**
   * 登录态失效（token / 会话）时走统一的重新登录流程（AGENTS.md：任何 403 都回登录）。
   * 不传则按瞬时错误重试。
   */
  onTokenInvalid?: () => Promise<boolean>
}): ServerFeedState {
  const {
    transport,
    authenticated,
    serverId,
    maxEvents = 20,
    refreshInterval,
    refreshToken,
    onTokenInvalid,
  } = opts
  const [events, setEvents] = useState<ServerEvent[]>([])
  const [extra, setExtra] = useState<ServerInfoExtra | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const [switchedAt, setSwitchedAt] = useState<number | null>(null)
  // 手动刷新是否在跑：只有用户点按钮才置 true，自动轮询不算。
  const [refreshing, setRefreshing] = useState(false)
  const lastSeqRef = useRef(0)
  // 是否已经拉过一次「最近 N 条」历史；避免 lastSeq=0 时每次都重新 tail。
  const historyLoadedRef = useRef(false)
  // 上游事件库的实例标识（同一个地址 / 端口后面可能换了另一个服）。
  const instanceRef = useRef('')
  /** 普通「立刻跑一次 tick」：内部自动补拉用（实例切换 / 流断开 / 自动刷新令牌）。 */
  const refreshRef = useRef<() => void>(() => {})
  /** 用户点按钮的**强制重新同步**（会断开并重连 SSE）。 */
  const resyncRef = useRef<() => void>(() => {})

  useEffect(() => {
    // 用同一套「清空」逻辑处理登出与切换服务器；用函数式更新保持空引用不变，避免无谓重渲染。
    const reset = () => {
      setExtra((prev) => (prev === null ? prev : null))
      setEvents((prev) => (prev.length === 0 ? prev : []))
      setAvailable((prev) => (prev === null ? prev : null))
      setRefreshedAt((prev) => (prev === null ? prev : null))
      setSwitchedAt((prev) => (prev === null ? prev : null))
      lastSeqRef.current = 0
      historyLoadedRef.current = false
      instanceRef.current = ''
    }
    if (!authenticated) {
      reset()
      return
    }
    let cancelled = false
    let timer: number | undefined
    let running = false
    let pending = false
    let closeStream: (() => void) | null = null
    // SSE 失败后的冷却：避免后端不支持流式时每次 tick 都重试造成紧凑循环。
    let streamCooldownUntil = 0
    // 本次 tick 是否由用户点「刷新」触发（决定转圈什么时候停）。
    let manualSpin = false
    // 本次挂载是否已经拉起过重新登录（避免登录框被反复顶掉）。
    let authRequested = false
    const isAuthError = (err: unknown) =>
      err instanceof TshockRequestError && (err.kind === 'auth' || err.kind === 'token')
    /**
     * 登录态失效 → 拉起重新登录；返回 true 表示「已按登录态失效处理，不要再重试」。
     * 不 await 登录结果：登录成功后 `authenticated` 变化会让本 effect 重建并重新拉取；
     * 用户取消登录则保持未登录态（本 effect 随 authenticated=false 卸载）。
     */
    const requestReauth = (err: unknown): boolean => {
      if (!isAuthError(err) || !onTokenInvalid) return false
      if (!authRequested) {
        authRequested = true
        void onTokenInvalid().catch(() => {})
      }
      return true
    }
    // 切换服务器 / 重新登录：清空上一条流，避免把两个服务器的事件拼在一起。
    reset()

    /** 按 seq 升序合并、去重，只保留最近 maxEvents 条。 */
    const mergeEvents = (incoming: ServerEvent[]) => {
      if (incoming.length === 0) return
      setEvents((prev) => {
        const merged = [...prev, ...incoming].sort((a, b) => a.seq - b.seq)
        const deduped = merged.filter((e, i) => i === 0 || e.seq !== merged[i - 1].seq)
        return deduped.length > maxEvents ? deduped.slice(-maxEvents) : deduped
      })
    }

    /**
     * 上游换了实例（同一地址 / 端口后面换成另一个服）：
     * 手上的事件 / 世界状态都属于旧服，**静默作废并重拉**（不弹错误）。
     */
    const handleInstanceReset = () => {
      lastSeqRef.current = 0
      historyLoadedRef.current = false
      setEvents((prev) => (prev.length === 0 ? prev : []))
      setExtra((prev) => (prev === null ? prev : null))
      setSwitchedAt(Date.now())
      refreshRef.current()
    }

    /** 响应的实例标识与手头不同 → 需要重同步（首次看到只记录）。 */
    const instanceChanged = (instance?: string) => {
      if (!instance || instance === instanceRef.current) return false
      const first = instanceRef.current === ''
      instanceRef.current = instance
      return !first
    }

    const schedule = (ms: number) => {
      if (cancelled) return
      timer = window.setTimeout(() => void tick(), Math.max(10000, ms))
    }

    /** 打开 SSE（若有）；失败即关闭并立刻用轮询补一次。 */
    const openStream = () => {
      if (cancelled || closeStream || !transport.eventsStream || Date.now() < streamCooldownUntil) return
      closeStream = transport.eventsStream(
        {
          onEvent: (e) => {
            if (cancelled) return
            lastSeqRef.current = Math.max(lastSeqRef.current, e.seq)
            mergeEvents([e])
            setRefreshedAt(Date.now())
          },
          onError: (err) => {
            if (cancelled) return
            closeStream?.()
            closeStream = null
            streamCooldownUntil = Date.now() + 60000
            // 登录态失效：交给统一登录流程，别用轮询反复撞 403。
            if (requestReauth(err)) return
            // 立刻用轮询补一次，别等一个刷新间隔。
            refreshRef.current()
          },
          onWorld: (info) => {
            if (cancelled) return
            // 世界状态随流推送，不再单独轮询 /api/serverinfo。
            setExtra(info)
            setAvailable(true)
            setRefreshedAt(Date.now())
          },
          onReset: (instance) => {
            if (cancelled) return
            closeStream?.()
            closeStream = null
            if (instance) instanceRef.current = instance
            handleInstanceReset()
          },
        },
        lastSeqRef.current,
      )
    }

    const tick = async () => {
      // 已有请求在跑：记一个待办，跑完立刻再来一次（手动刷新 / 发言后触发）。
      if (running) {
        pending = true
        return
      }
      running = true
      // 清除已排期的自动轮询，避免手动刷新后出现两条定时链。
      if (timer) {
        window.clearTimeout(timer)
        timer = undefined
      }
      try {
        // SSE 活跃时：世界状态由流里的 world 帧推送，事件由流推进 —— 不再打插件。
        if (!closeStream) {
          const info = await transport.serverInfoExtra()
          if (cancelled) return
          setExtra(info)
          if (!historyLoadedRef.current && transport.eventsTail) {
            // 打开页面先看最近 N 条（新插件 = 磁盘历史；旧插件后端会自动降级取尾部）。
            const page = await transport.eventsTail(maxEvents)
            if (cancelled) return
            if (instanceChanged(page.instance)) {
              // 已经是另一个服的历史：丢掉旧列表，立刻按新实例重拉。
              handleInstanceReset()
              return
            }
            lastSeqRef.current = page.lastSeq
            historyLoadedRef.current = true
            mergeEvents(page.events.slice(-maxEvents))
          } else {
            const page = await transport.events(
              lastSeqRef.current,
              Math.max(maxEvents, EVENTS_FETCH_MIN),
            )
            if (cancelled) return
            // 新插件：实例标识变化即换服；旧插件（无 instance）退回「seq 回退」判定。
            if (instanceChanged(page.instance) || page.lastSeq < lastSeqRef.current) {
              handleInstanceReset()
              return
            }
            lastSeqRef.current = page.lastSeq
            mergeEvents(page.events)
          }
          // 「刷新于 …」只标记**真的拉取过**：SSE 活跃时数据由流推送（onEvent / onWorld 各自更新时间），
          // 这里再写一次就只是把时间戳改成当前时间——那正是「点了刷新却没拉」的假象来源。
          setAvailable(true)
          setRefreshedAt(Date.now())
        }
        openStream()
        schedule(refreshInterval)
      } catch (err) {
        if (cancelled) return
        if (err instanceof TshockRequestError && err.kind === 'plugin_missing') {
          setAvailable(false)
          setExtra(null)
          // 插件可能稍后才装 / 后端二进制过期：**不要永久停摆**，慢速重试直到恢复。
          schedule(MISSING_RETRY_MS)
        } else if (requestReauth(err)) {
          // 已拉起重新登录：等登录成功（authenticated 变化）后本 effect 重建并重拉。
        } else {
          // 瞬时错误（超时 / 服务不可用）：按正常间隔重试，避免卡死。
          schedule(refreshInterval)
        }
      } finally {
        running = false
        if (pending) {
          // 还有一次手动刷新在排队：交给那一轮收尾，转圈别提前停。
          pending = false
          void tick()
        } else if (manualSpin) {
          manualSpin = false
          setRefreshing(false)
        }
      }
    }

    // 页面隐藏 → 断开 SSE；回到前台 → 立刻刷新（含重连 SSE）。
    const onVisibility = () => {
      if (cancelled) return
      if (document.visibilityState === 'hidden') {
        closeStream?.()
        closeStream = null
      } else {
        void tick()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // 内部自动补拉：直接排队一次 tick（不碰 SSE 连接，避免自动刷新把长连接反复断掉）。
    refreshRef.current = () => void tick()

    /**
     * 手动刷新 = **强制重新同步**，而不是「等下一次轮询」：
     * 之前 SSE 已连接时 tick() 会整体跳过拉取（只改「刷新于」的时间戳），按钮等于安慰剂。
     * 这里先断开长连接、忘掉 lastSeq / 已加载历史、清掉流冷却，再按「首次打开」重拉尾部并重连。
     * 已有事件不会被清空（mergeEvents 按 seq 去重）。
     */
    resyncRef.current = () => {
      if (cancelled) return
      manualSpin = true
      setRefreshing(true)
      closeStream?.()
      closeStream = null
      lastSeqRef.current = 0
      historyLoadedRef.current = false
      streamCooldownUntil = 0
      void tick()
    }
    void tick()
    return () => {
      cancelled = true
      manualSpin = false
      setRefreshing(false)
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer) window.clearTimeout(timer)
      closeStream?.()
      closeStream = null
    }
  }, [authenticated, transport, serverId, maxEvents, refreshInterval, onTokenInvalid])

  // 页面数据刷新间隔触发 → 连带刷新服务器动态（不重置已有事件）。
  const lastTokenRef = useRef(refreshToken ?? 0)
  useEffect(() => {
    if (refreshToken == null) return
    if (refreshToken === lastTokenRef.current) return
    lastTokenRef.current = refreshToken
    refreshRef.current()
  }, [refreshToken])

  return {
    events,
    extra,
    available,
    refreshedAt,
    switchedAt,
    refreshing,
    refresh: () => resyncRef.current(),
  }
}
