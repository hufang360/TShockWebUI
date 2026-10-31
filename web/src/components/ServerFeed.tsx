import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, RefreshCw } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { LoadEarlier } from '@/components/LoadEarlier'
import { RichText } from '@/components/RichText'
import { TopBarActions } from '@/components/TopBar'
import { Badge, Button, Empty, EmptyDescription } from '@/components/ui'
import { useBottomList } from '@/hooks/useBottomList'
import { useNow } from '@/hooks/useNow'
import { useServerFeed } from '@/hooks/useServerFeed'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock, formatClockWithDate } from '@/lib/clock'
import type { Lang } from '@/lib/i18n'
import type { BackendTransport, ServerEvent, ServerInfoExtra } from '@/lib/tshock'
import type { Atlas, Item, Prefix } from '@/types'

/** 事件流默认渲染最近 N 条，更早的用「加载更早」按钮按批展开。 */
const FEED_WINDOW = 30

/** 换服提示显示多久（毫秒）。 */
const SWITCH_HINT_MS = 10_000

/** 「聊天」页的事件类型筛选。 */
const FEED_FILTERS = ['all', 'presence', 'boss', 'announce', 'npc', 'chat'] as const
type FeedFilter = (typeof FEED_FILTERS)[number]
const FEED_FILTER_LABEL: Record<FeedFilter, string> = {
  all: 'feed.filterAll',
  presence: 'feed.filterPresence',
  boss: 'feed.filterBoss',
  announce: 'feed.filterAnnounce',
  npc: 'feed.filterNpc',
  chat: 'feed.filterChat',
}

/** 事件是否属于某个筛选（旧插件的 `webui` 类型算进「聊天」）。 */
function matchesFilter(e: ServerEvent, filter: FeedFilter): boolean {
  if (filter === 'all') return true
  // 文案叫「进服」，但行为仍是「进服 + 退服」（历史上叫「进出服」，用户只要求改文字）。
  if (filter === 'presence') return e.type === 'join' || e.type === 'leave'
  if (filter === 'chat') return e.type === 'chat' || e.type === 'webui'
  return e.type === filter
}

/** 事件类型 → 圆点颜色（未知类型兜底为低对比灰）。`source=webui` 的聊天用主色区分。 */
function eventDot(type: string, source?: string): string {
  switch (type) {
    case 'join':
      return 'bg-success'
    case 'leave':
      return 'bg-muted-foreground'
    case 'boss':
      return 'bg-warning'
    // 世界公告（Boss 苏醒 / 事件开始 / 入侵）：用游戏内公告色（紫）。
    case 'announce':
      return 'bg-[#af4bff]'
    // NPC 到达 / 离开（旅商等）：用游戏内 NPC 旅行公告色（蓝）。
    case 'npc':
      return 'bg-[#327dff]'
    case 'chat':
      return source === 'webui' ? 'bg-primary' : 'bg-info'
    case 'webui':
      // 旧插件（未统一为 chat+source）的兼容。
      return 'bg-primary'
    default:
      return 'bg-foreground/40'
  }
}

/** 世界状态徽标（困难模式 / 血月 / 日食 / 下雨 / 入侵）。无状态时渲染 null。 */
function ServerFeedFlags({
  extra,
  className,
}: {
  extra: ServerInfoExtra | null
  className?: string
}) {
  const { t } = useI18n()
  if (!extra) return null
  const flags: string[] = []
  if (extra.hardMode) flags.push(t('home.hardMode'))
  if (extra.bloodMoon) flags.push(t('home.bloodMoon'))
  if (extra.eclipse) flags.push(t('home.eclipse'))
  if (extra.raining) flags.push(t('home.raining'))
  if (extra.invasionType > 0) flags.push(t('home.invasion'))
  if (flags.length === 0) return null
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {flags.map((f) => (
        <Badge key={f} tone="warn">
          {f}
        </Badge>
      ))}
    </div>
  )
}

/**
 * 把 Terraria 的游戏内时间（`Main.time`，0..54000）格式化成 `HH:MM`。
 * 白天 4:30 起算、夜晚 19:30 起算（见 plugin/WebUI/Extras.cs）。
 */
export function formatGameTime(extra: ServerInfoExtra | null): string | null {
  if (!extra || typeof extra.time !== 'number') return null
  const startMin = extra.dayTime ? 4 * 60 + 30 : 19 * 60 + 30
  const total = startMin + Math.floor(extra.time / 60)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * 「世界名 · 刷新于 HH:MM:SS · 游戏内 HH:MM」。无数据时返回 null。
 *
 * 世界名用来区分「同一个服务器地址下先后开的不同服」（换服后世界名会变）。
 */
export function feedRefreshLabel(
  t: (key: string, vars?: Record<string, string | number>) => string,
  refreshedAt: number | null,
  extra: ServerInfoExtra | null,
  lang: Lang = 'zh',
): string | null {
  if (refreshedAt == null && !extra) return null
  const parts: string[] = []
  const world = extra?.name?.trim()
  if (world) parts.push(world)
  if (refreshedAt != null) {
    parts.push(t('home.feedRefreshedAt', { time: formatClock(lang, refreshedAt) }))
  }
  const gt = formatGameTime(extra)
  if (gt) parts.push(t('home.feedGameTime', { time: gt }))
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 一条事件的时间文案：刚刚 / N 分钟前 / HH:MM / 昨天 HH:MM / M-D HH:MM。 */
export function formatEventTime(
  t: (key: string, vars?: Record<string, string | number>) => string,
  iso: string,
  now: number,
): string {
  const d = new Date(iso)
  const ms = d.getTime()
  if (Number.isNaN(ms)) return ''
  const diff = now - ms
  if (diff >= 0 && diff < 60_000) return t('feed.timeJustNow')
  if (diff >= 0 && diff < 3_600_000) return t('feed.timeMinutesAgo', { n: Math.floor(diff / 60_000) })
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000)
  if (dayDiff <= 0) return hhmm
  if (dayDiff === 1) return t('feed.timeYesterday', { time: hhmm })
  return `${d.getMonth() + 1}-${d.getDate()} ${hhmm}`
}

/** 本地日历日的 key（`Y-M-D`），用于按天分组。 */
function dayKeyOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 日期分隔文案：今天 / 昨天 / M月D日。 */
function formatEventDay(
  lang: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  iso: string,
  now: number,
): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86_400_000)
  if (dayDiff <= 0) return t('feed.dayToday')
  if (dayDiff === 1) return t('feed.dayYesterday')
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric' })
}

interface ServerFeedListProps {
  events: ServerEvent[]
  extra: ServerInfoExtra | null
  /** 上次刷新的本地时间戳（展示「刷新时间 + 游戏内时间」）。 */
  refreshedAt?: number | null
  /** 最近一次「上游换了服」的时间戳：短暂提示后自行消失。 */
  switchedAt?: number | null
  /** 最多展示条数；不传则全部。 */
  limit?: number
  /** 事件为空时的占位文案。 */
  emptyText?: string
  /** 信使插件未安装时展示的文案（优先于 emptyText）。 */
  unavailableText?: string
  unavailable?: boolean
  /**
   * 有新事件到达时**总是**贴到最新一条（聊天窗口手感）。
   *
   * 首页卡片不传：用户往上回看旧事件时，新事件不把视图拉走（`useBottomList` 的默认行为）。
   * 「聊天」页传 `true`：它是个聊天窗口，刷新出数据就该停在最新一条。
   */
  followNewest?: boolean
  /** 物品索引 / 前缀 / 图集：提供后聊天里的 `[i:..]` 渲染为图标。 */
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  /**
   * 是否在列表上方画世界状态徽标（困难模式 / 下雨…）。
   *
   * 「聊天」页关掉：徽标挪到输入框上方那一行的右侧，跟筛选 chips 同一行。
   */
  showFlags?: boolean
  /**
   * 由**页面级**滚动区滚动（浏览器右侧那条滚动条），列表自己不再溢出滚动。
   *
   * 「聊天」页用它：滚动交给 AppShell 的 `<main>`，列表吃满高度向上长，
   * 贴底跟随 / 回到底部 / 加载更早全部作用在 `<main>` 上。
   */
  pageScroll?: boolean
  /** `pageScroll` 时「回到底部」浮按钮的宿主（投到吸底的输入区上方）。 */
  jumpSlot?: HTMLElement | null
}

/** 事件流展示（徽标 + 列表）。滚动交给父容器的高度约束。 */
export function ServerFeedList({
  events,
  extra,
  limit,
  emptyText,
  unavailableText,
  unavailable,
  refreshedAt,
  switchedAt,
  followNewest = false,
  itemsById,
  prefixesById,
  atlas,
  showFlags = true,
  pageScroll = false,
  jumpSlot,
}: ServerFeedListProps) {
  const { t, lang } = useI18n()
  // 页面级滚动时真正在滚的是 `<main>`（AppShell 主内容区），列表只负责把内容铺开。
  // 用回调 ref + state 捕获（元素挂载后才能查到祖先），不用在 render 里读 ref。
  const [pageScroller, setPageScroller] = useState<HTMLElement | null>(null)
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    setPageScroller(node?.closest('main') ?? null)
  }, [])
  // 默认停在最新一条（贴底）；旧事件按批懒加载。
  const { ref, onScroll, start, hidden, loadEarlier, step, atBottom, scrollToBottom } =
    useBottomList<HTMLUListElement>(events.length, {
      initial: FEED_WINDOW,
      scroller: pageScroll ? pageScroller : null,
    })
  // 页面级滚动时 `<main>` 的 scroll 不会冒泡到 `ul` 上，得直接挂监听（用于「是否贴着底部」）。
  useEffect(() => {
    if (!pageScroll || !pageScroller) return
    pageScroller.addEventListener('scroll', onScroll, { passive: true })
    return () => pageScroller.removeEventListener('scroll', onScroll)
  }, [pageScroll, pageScroller, onScroll])
  const now = useNow()
  // 新事件到达就贴底（只在 `followNewest` 时）；条数没变（如只更新了世界状态）时不动滚动位置。
  const prevTotalRef = useRef(events.length)
  useLayoutEffect(() => {
    const prev = prevTotalRef.current
    prevTotalRef.current = events.length
    if (!followNewest || events.length <= prev) return
    scrollToBottom()
  }, [events.length, followNewest, scrollToBottom])
  // 换服提示只显示一小会儿：用户看到「列表自己换了」就知道原因，不必一直挂着。
  // 用「已关闭的那一次时间戳」派生，避免在 effect 里同步 setState（会多一轮渲染）。
  const [dismissedSwitchedAt, setDismissedSwitchedAt] = useState<number | null>(null)
  const showSwitched = switchedAt != null && switchedAt !== dismissedSwitchedAt
  useEffect(() => {
    if (switchedAt == null) return
    const id = window.setTimeout(() => setDismissedSwitchedAt(switchedAt), SWITCH_HINT_MS)
    return () => window.clearTimeout(id)
  }, [switchedAt])
  if (unavailable) {
    return <p className="text-xs text-warning">{unavailableText ?? t('editor.eventsPluginMissing')}</p>
  }
  // 首页卡片只显示最近 `limit` 条；「聊天」页显示窗口内的全部（可加载更早）。
  const shown = limit != null ? events.slice(-limit) : events.slice(start)
  const canLoadEarlier = limit == null && hidden > 0
  const refreshLabel = feedRefreshLabel(t, refreshedAt ?? null, extra, lang)
  // 「回到底部」：自滚动时浮在列表右下角；页面级滚动时投到吸底的输入区上方（否则它在视口外，用户看不到）。
  const jumpButton = (
    <button
      type="button"
      onClick={scrollToBottom}
      className={cn(
        'flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-2xs text-primary-foreground shadow-md',
        'hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        pageScroll && 'pointer-events-auto',
      )}
    >
      <ArrowDown className="size-3" />
      {t('feed.jumpLatest')}
    </button>
  )
  return (
    // 紧凑：徽标行与列表之间、底部「刷新于」上方都只留 4px（原来 8px）。
    <div
      ref={rootRef}
      className={cn('flex flex-1 flex-col gap-1', !pageScroll && 'min-h-0')}
    >
      {showFlags && <ServerFeedFlags extra={extra} />}
      {shown.length === 0 ? (
        <Empty size="sm">
          <EmptyDescription>{emptyText ?? t('home.eventsEmpty')}</EmptyDescription>
        </Empty>
      ) : (
        <div className={cn('relative flex flex-1 flex-col', !pageScroll && 'min-h-0')}>
          <ul
            ref={ref}
            onScroll={pageScroll ? undefined : onScroll}
            className={
              pageScroll
                ? 'flex flex-col gap-1'
                : 'min-h-0 flex-1 flex flex-col gap-1 overflow-y-auto pr-1'
            }
          >
            {canLoadEarlier && (
              <li className="flex justify-center">
                <LoadEarlier hidden={hidden} step={step} onLoad={loadEarlier} />
              </li>
            )}
            {shown.map((e, i) => {
              const label = formatEventTime(t, e.time, now)
              const dayKey = dayKeyOf(e.time)
              const prevKey = i > 0 ? dayKeyOf(shown[i - 1].time) : ''
              const showDay = dayKey !== '' && dayKey !== prevKey
              return (
                <Fragment key={e.seq}>
                  {showDay && (
                    <li className="my-1 flex items-center gap-2 text-2xs text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      <span className="shrink-0">{formatEventDay(lang, t, e.time, now)}</span>
                      <span className="h-px flex-1 bg-border" />
                    </li>
                  )}
                  <li className="flex items-start gap-2 text-xs">
                    <span
                      className={cn('mt-2 size-1.5 shrink-0 rounded-full', eventDot(e.type, e.source))}
                    />
                    <span className="min-w-0 flex-1 break-words text-foreground/80">
                      <RichText text={e.text} itemsById={itemsById} prefixesById={prefixesById} atlas={atlas} />
                    </span>
                    {label && (
                      <time
                        dateTime={e.time}
                        title={formatClockWithDate(lang, new Date(e.time))}
                        className="shrink-0 pt-0.5 text-2xs tabular-nums text-muted-foreground"
                      >
                        {label}
                      </time>
                    )}
                  </li>
                </Fragment>
              )
            })}
          </ul>
          {!atBottom &&
            (pageScroll
              ? jumpSlot
                ? createPortal(jumpButton, jumpSlot)
                : null
              : (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2">{jumpButton}</div>
              ))}
        </div>
      )}
      {(refreshLabel || showSwitched) && (
        <div className="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
          {refreshLabel && (
            <span className="min-w-0 truncate tabular-nums" title={refreshLabel}>
              {refreshLabel}
            </span>
          )}
          {showSwitched && (
            <span className="shrink-0 text-info" title={t('feed.switchedHint')}>
              {t('feed.switched')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 「聊天」页（`#/chat`）：页面挂载时才轮询，切走即停止。
 */
export function ServerFeedTab({
  transport,
  authenticated,
  serverId,
  refreshInterval,
  refreshToken,
  onTokenInvalid,
  itemsById,
  prefixesById,
  atlas,
  filtersSlot,
  jumpSlot,
  actionsSlot,
  pageScroll = false,
}: {
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  /** 服务器动态刷新间隔（毫秒）。 */
  refreshInterval: number
  /** 外部刷新令牌（例如底部聊天输入框发送成功后刷新）。 */
  refreshToken?: number
  /** 登录态失效时拉起统一重新登录流程（403 规则）。 */
  onTokenInvalid?: () => Promise<boolean>
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  /**
   * 筛选 chips（+ 右侧世界状态徽标）的挂载点。
   *
   * 「聊天」页把这一行放到**输入框正上方**（贴近列表底部），所以用 portal 投进去；
   * 不传则就地渲染（页面单测 / 其他场景）。
   */
  filtersSlot?: HTMLElement | null
  /** `pageScroll` 时「回到底部」按钮的宿主（吸底输入区上方）。 */
  jumpSlot?: HTMLElement | null
  /** 交给页面级滚动区（浏览器右侧滚动条），见 `ServerFeedList`。 */
  pageScroll?: boolean
  /** 刷新一簇（上次刷新 + 刷新按钮）的挂载点；不传则按 `pageScroll` 决定放顶栏或就地渲染。 */
  actionsSlot?: HTMLElement | null
}) {
  const { t, lang } = useI18n()
  const [filter, setFilter] = useState<FeedFilter>('all')
  const { events, extra, available, refreshedAt, switchedAt, refresh, refreshing } = useServerFeed({
    transport,
    authenticated,
    serverId,
    maxEvents: 500,
    refreshInterval,
    refreshToken,
    onTokenInvalid,
  })
  const filtered = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => matchesFilter(e, filter))),
    [events, filter],
  )

  // 世界状态徽标单独一行（在筛选 chips 上方，靠左、不换行）；chips 靠左。
  const filterRow = (
    <>
      <ServerFeedFlags extra={extra} className="flex-nowrap justify-start overflow-x-auto" />
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {FEED_FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'secondary' : 'ghost'}
            className={cn('px-2', filter !== f && 'text-muted-foreground')}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(FEED_FILTER_LABEL[f])}
          </Button>
        ))}
      </div>
    </>
  )

  // 刷新一簇（上次刷新文案 + 刷新按钮）：挂载点由页面决定——「聊天」页放在输入框发送按钮左边，
  // 其它场景退回顶栏。文案在手机端隐藏，只留图标。
  const refreshActions = (
    <>
      {refreshedAt != null && (
        <span
          className="hidden text-2xs text-muted-foreground tabular-nums sm:inline"
          title={formatClockWithDate(lang, refreshedAt)}
        >
          {t('home.lastRefresh', { time: formatClock(lang, refreshedAt) })}
        </span>
      )}
      {/* 强制重新同步：SSE 连接中也能点（会断开重连并重拉尾部事件），跑的时候转圈 + 禁用。 */}
      <IconAction
        label={refreshing ? t('home.refreshing') : t('feed.refresh')}
        icon={RefreshCw}
        loading={refreshing}
        onClick={refresh}
      />
    </>
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', pageScroll ? 'flex-1' : 'h-full min-h-0')}>
      {actionsSlot
        ? createPortal(refreshActions, actionsSlot)
        : pageScroll
          ? null
          : <TopBarActions>{refreshActions}</TopBarActions>}
      {filtersSlot ? createPortal(filterRow, filtersSlot) : pageScroll ? null : filterRow}
      <ServerFeedList
        events={filtered}
        extra={extra}
        unavailable={available === false}
        unavailableText={t('editor.eventsPluginMissing')}
        refreshedAt={refreshedAt}
        showFlags={false}
        pageScroll={pageScroll}
        jumpSlot={jumpSlot}
        switchedAt={switchedAt}
        followNewest
        itemsById={itemsById}
        prefixesById={prefixesById}
        atlas={atlas}
      />
    </div>
  )
}
