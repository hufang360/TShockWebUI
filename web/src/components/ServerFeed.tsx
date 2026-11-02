import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, RefreshCw } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { LoadEarlier } from '@/components/LoadEarlier'
import { RichText } from '@/components/RichText'
import { TopBarActions } from '@/components/TopBar'
import { Badge, Button, Empty, EmptyDescription } from '@/components/ui'
import { useIsMobile } from '@/hooks/use-mobile'
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

/** 世界状态文案（困难模式 / 血月 / 日食 / 下雨 / 入侵），无状态时返回空数组。 */
function feedFlagLabels(
  t: (key: string) => string,
  extra: ServerInfoExtra | null,
): string[] {
  if (!extra) return []
  const flags: string[] = []
  if (extra.hardMode) flags.push(t('home.hardMode'))
  if (extra.bloodMoon) flags.push(t('home.bloodMoon'))
  if (extra.eclipse) flags.push(t('home.eclipse'))
  if (extra.raining) flags.push(t('home.raining'))
  if (extra.invasionType > 0) flags.push(t('home.invasion'))
  return flags
}

/**
 * 事件流底部的两行小字（**紧凑版**，「指令」页聊天栏与首页「最新动态」卡片共用）：
 *
 * ```
 * 困难模式 · 下雨                    ← 世界状态（纯文字，过长截断，悬停给完整状态）
 * 上次刷新 03:19:09  ·  游戏内 12:00  ← 刷新时间（悬停给带日期的完整时间）
 * ```
 *
 * `showWorld` 控制世界名要不要带上：**首页不带**（同一屏的「服务器状态」「最近执行」已经写了世界名，
 * 重复三遍没意义）；「指令」页的聊天栏带，因为那一栏没有别的世界名可看。
 */
export function FeedFootLines({
  extra,
  refreshedAt,
  switchedAt = null,
  showWorld = false,
  showRefresh = true,
  className,
}: {
  extra: ServerInfoExtra | null
  refreshedAt?: number | null
  /** 最近一次「上游换了服」的时间戳：短暂显示，随后自行消失。 */
  switchedAt?: number | null
  /** 状态行是否带世界名（`『世界名』 · 困难模式`）。 */
  showWorld?: boolean
  /**
   * 是否渲染「上次刷新 · 游戏内」那一行。
   *
   * 关掉时**连游戏内时间一起不画**：页头右侧已经有完整的一行时，这里再留半行（只剩「游戏内」）更乱。
   */
  showRefresh?: boolean
  className?: string
}) {
  const { t, lang } = useI18n()
  const worldName = extra?.name?.trim() ?? ''
  const flagLabels = feedFlagLabels(t, extra)
  const statusText = [
    showWorld && worldName ? `『${worldName}』` : '',
    ...flagLabels,
  ]
    .filter(Boolean)
    .join(' · ')
  const refreshParts: string[] = []
  if (showRefresh && refreshedAt != null) {
    refreshParts.push(t('home.lastRefresh', { time: formatClock(lang, refreshedAt) }))
  }
  const gameTime = showRefresh ? formatGameTime(extra) : null
  if (gameTime) refreshParts.push(t('home.feedGameTime', { time: gameTime }))

  // 换服提示只显示一小会儿：用户看到「列表自己换了」就知道原因，不必一直挂着。
  const [dismissedSwitchedAt, setDismissedSwitchedAt] = useState<number | null>(null)
  const showSwitched = switchedAt != null && switchedAt !== dismissedSwitchedAt
  useEffect(() => {
    if (switchedAt == null) return
    const id = window.setTimeout(() => setDismissedSwitchedAt(switchedAt), SWITCH_HINT_MS)
    return () => window.clearTimeout(id)
  }, [switchedAt])

  if (!statusText && refreshParts.length === 0 && !showSwitched) return null

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {statusText && (
        <p
          className="min-w-0 truncate text-2xs text-muted-foreground"
          // 悬停给完整状态（**不含**世界名）：截断时才知道后面还有哪些。
          title={flagLabels.length > 0 ? flagLabels.join(' · ') : undefined}
        >
          {statusText}
        </p>
      )}
      {(refreshParts.length > 0 || showSwitched) && (
        <p
          className="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground tabular-nums"
          title={refreshedAt != null ? formatClockWithDate(lang, refreshedAt) : undefined}
        >
          {refreshParts.length > 0 && <span className="min-w-0 truncate">{refreshParts.join('  ·  ')}</span>}
          {showSwitched && (
            <span className="shrink-0 text-info" title={t('feed.switchedHint')}>
              {t('feed.switched')}
            </span>
          )}
        </p>
      )}
    </div>
  )
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
  const flags = feedFlagLabels(t, extra)
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
  /**
   * 底部信息区的排法：
   *
   * - `default`：「世界名 · 刷新于 HH:MM:SS · 游戏内 HH:MM」一行（「聊天」页）；
   * - `text`：紧凑两行 —— 世界状态一行 + 「上次刷新 HH:MM:SS · 游戏内 HH:MM」一行（首页「最新动态」卡片）。
   *   不带世界名（同屏的其它卡片已经写了）。
   */
  footerVariant?: 'default' | 'text'
  /** 是否画「今天 / 昨天 / M月D日」分隔线（首页卡片关掉：只显示最近几条，分隔线是噪声）。 */
  showDayDivider?: boolean
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
  footerVariant = 'default',
  showDayDivider = true,
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
                  {showDay && showDayDivider && (
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
      {footerVariant === 'text' ? (
        <FeedFootLines extra={extra} refreshedAt={refreshedAt ?? null} switchedAt={switchedAt} />
      ) : (
        refreshLabel ||
        showSwitched ? (
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
        ) : null
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
  footerVariant = 'default',
  footerSlot,
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
  /**
   * 底部信息区的排法（「指令」页的聊天栏用，聊天页不传）：
   *
   * - `default`：世界徽标（Badge）一行 + 筛选 chips 一行，各自用 `filtersSlot` / `actionsSlot` 投放；
   * - `stacked`：三行贴底 —— ①`世界名 · 困难模式, 下雨`（文字，不占 Badge，过长截断 + `title` 给完整状态）
   *   ②`上次刷新 HH:MM:SS · 游戏内 HH:MM` ③`[⟳] │ 全部 进服 Boss …`（刷新按钮在 chips 左边，中间一条竖线）。
   *   `stacked` 下整个信息区可通过 `footerSlot` 投到吸底输入区上方（窄屏）或就地贴在列表下方（宽屏）。
   */
  footerVariant?: 'default' | 'stacked'
  /** `stacked` 时底部信息区的挂载点（窄屏投到吸底区；不传则就地渲染在列表下方）。 */
  footerSlot?: HTMLElement | null
}) {
  const { t, lang } = useI18n()
  // 手机端顶栏右侧会折进 `…` 菜单（`TopBarSlot` 用同一个断点），所以「上次刷新」改由底部那小字显示。
  const isMobile = useIsMobile()
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

  const chips = FEED_FILTERS.map((f) => (
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
  ))

  // 默认：世界状态徽标单独一行（在筛选 chips 上方，靠左、不换行）；chips 靠左。
  const filterRow = (
    <>
      <ServerFeedFlags extra={extra} className="flex-nowrap justify-start overflow-x-auto" />
      <div className="flex min-w-0 flex-wrap items-center gap-1">{chips}</div>
    </>
  )

  // 刷新一簇（上次刷新文案 + 刷新按钮）：挂载点由页面决定——「聊天」页放在输入框发送按钮左边，
  // 其它场景退回顶栏。文案在手机端隐藏，只留图标。
  const refreshButton = (
    /* 强制重新同步：SSE 连接中也能点（会断开重连并重拉尾部事件），跑的时候转圈 + 禁用。 */
    <IconAction
      label={refreshing ? t('home.refreshing') : t('feed.refresh')}
      icon={RefreshCw}
      loading={refreshing}
      onClick={refresh}
    />
  )
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
      {refreshButton}
    </>
  )

  // `stacked`（「指令」页）：底部只剩两行 —— `『世界名』 · 困难模式 · 下雨` 与筛选 chips；
  // 「上次刷新 HH:MM:SS · 游戏内 HH:MM」+ 刷新按钮挪到**顶栏右侧**（与其它模块同位置，
  // 差别只在这页有聊天内容，所以多带一个游戏内时间）。
  const refreshParts: string[] = []
  if (refreshedAt != null) {
    refreshParts.push(t('home.lastRefresh', { time: formatClock(lang, refreshedAt) }))
  }
  const gameTime = formatGameTime(extra)
  if (gameTime) refreshParts.push(t('home.feedGameTime', { time: gameTime }))
  const refreshLine = refreshParts.join('  ·  ')
  const stackedFooter = (
    <div className="flex min-w-0 flex-col gap-1">
      {/* 状态行（带世界名）：与首页「最新动态」卡片共用 `FeedFootLines`，样式完全一致。
          「上次刷新 … · 游戏内 …」平时不在这里重复（页头右侧已经有了）；**手机端顶栏折进 `…`**，
          那里看不到刷新时间，所以这一行在窄屏补上。 */}
      <FeedFootLines
        extra={extra}
        refreshedAt={refreshedAt}
        // 只在窄屏（顶栏折叠）画那一行；宽屏页头右侧已经有完整的「上次刷新 · 游戏内」。
        showRefresh={isMobile}
        showWorld
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1">{chips}</div>
    </div>
  )

  if (footerVariant === 'stacked') {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1', pageScroll ? 'flex-1' : 'h-full min-h-0')}>
        {/* 上次刷新（带游戏内时间）+ 刷新按钮在**顶栏右侧**，与其它模块同一位置。 */}
        <TopBarActions>
          {refreshLine && (
            <span
              className="hidden text-2xs text-muted-foreground tabular-nums sm:inline"
              title={refreshedAt != null ? formatClockWithDate(lang, refreshedAt) : undefined}
            >
              {refreshLine}
            </span>
          )}
          {refreshButton}
        </TopBarActions>
        {/* 状态行 / chips 由 `stackedFooter` 统一画：`extra` 与 `refreshedAt` 不再传给列表，
            否则列表底部会再画一遍「世界名 · 游戏内」。列表只保留「已切换服务器」这条临时提示。 */}
        <ServerFeedList
          events={filtered}
          extra={null}
          unavailable={available === false}
          unavailableText={t('editor.eventsPluginMissing')}
          showFlags={false}
          pageScroll={pageScroll}
          jumpSlot={jumpSlot}
          switchedAt={switchedAt}
          followNewest
          itemsById={itemsById}
          prefixesById={prefixesById}
          atlas={atlas}
        />
        {footerSlot ? createPortal(stackedFooter, footerSlot) : stackedFooter}
      </div>
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', pageScroll ? 'flex-1' : 'h-full min-h-0')}>
      {actionsSlot ? (
        createPortal(refreshActions, actionsSlot)
      ) : pageScroll ? null : (
        <TopBarActions>{refreshActions}</TopBarActions>
      )}
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
