import { Fragment, useMemo, useState } from 'react'
import { ArrowDown, RefreshCw } from 'lucide-react'
import { LoadEarlier } from '@/components/LoadEarlier'
import { RichText } from '@/components/RichText'
import { Badge, Button, Empty, EmptyDescription } from '@/components/ui'
import { useBottomList } from '@/hooks/useBottomList'
import { useNow } from '@/hooks/useNow'
import { useServerFeed } from '@/hooks/useServerFeed'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import type { BackendTransport, ServerEvent, ServerInfoExtra } from '@/lib/tshock'
import type { Atlas, Item, Prefix } from '@/types'

/** 「动态」tab 默认渲染最近 N 条，更早的用「加载更早」按钮按批展开。 */
const FEED_WINDOW = 30

/** 「动态」tab 的事件类型筛选。 */
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
function ServerFeedFlags({ extra }: { extra: ServerInfoExtra | null }) {
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
    <div className="flex flex-wrap gap-1.5">
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

/** 「刷新于 HH:MM:SS · 游戏内 HH:MM」。无数据时返回 null。 */
export function feedRefreshLabel(
  t: (key: string, vars?: Record<string, string | number>) => string,
  refreshedAt: number | null,
  extra: ServerInfoExtra | null,
): string | null {
  if (refreshedAt == null && !extra) return null
  const parts: string[] = []
  if (refreshedAt != null) {
    parts.push(t('home.feedRefreshedAt', { time: new Date(refreshedAt).toLocaleTimeString() }))
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
  /** 最多展示条数；不传则全部。 */
  limit?: number
  /** 事件为空时的占位文案。 */
  emptyText?: string
  /** 信使插件未安装时展示的文案（优先于 emptyText）。 */
  unavailableText?: string
  unavailable?: boolean
  /** 物品索引 / 前缀 / 图集：提供后聊天里的 `[i:..]` 渲染为图标。 */
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
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
  itemsById,
  prefixesById,
  atlas,
}: ServerFeedListProps) {
  const { t, lang } = useI18n()
  // 默认停在最新一条（贴底）；旧事件按批懒加载。
  const { ref, onScroll, start, hidden, loadEarlier, step, atBottom, scrollToBottom } =
    useBottomList<HTMLUListElement>(events.length, { initial: FEED_WINDOW })
  const now = useNow()
  if (unavailable) {
    return <p className="text-xs text-warning">{unavailableText ?? t('editor.eventsPluginMissing')}</p>
  }
  // 首页卡片只显示最近 `limit` 条；「动态」tab 显示窗口内的全部（可加载更早）。
  const shown = limit != null ? events.slice(-limit) : events.slice(start)
  const canLoadEarlier = limit == null && hidden > 0
  const refreshLabel = feedRefreshLabel(t, refreshedAt ?? null, extra)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ServerFeedFlags extra={extra} />
      {shown.length === 0 ? (
        <Empty size="sm">
          <EmptyDescription>{emptyText ?? t('home.eventsEmpty')}</EmptyDescription>
        </Empty>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ul
            ref={ref}
            onScroll={onScroll}
            className="min-h-0 flex-1 flex flex-col gap-1 overflow-y-auto pr-1"
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
                    <li className="my-1 flex items-center gap-2 text-2xs text-muted-foreground/70">
                      <span className="h-px flex-1 bg-border" />
                      <span className="shrink-0">{formatEventDay(lang, t, e.time, now)}</span>
                      <span className="h-px flex-1 bg-border" />
                    </li>
                  )}
                  <li className="flex items-start gap-2 text-xs">
                    <span
                      className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', eventDot(e.type, e.source))}
                    />
                    <span className="min-w-0 flex-1 break-words text-foreground/80">
                      <RichText text={e.text} itemsById={itemsById} prefixesById={prefixesById} atlas={atlas} />
                    </span>
                    {label && (
                      <time
                        dateTime={e.time}
                        title={new Date(e.time).toLocaleString()}
                        className="shrink-0 pt-0.5 text-2xs tabular-nums text-muted-foreground/70"
                      >
                        {label}
                      </time>
                    )}
                  </li>
                </Fragment>
              )
            })}
          </ul>
          {!atBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-2xs text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ArrowDown className="size-3" />
              {t('feed.jumpLatest')}
            </button>
          )}
        </div>
      )}
      {refreshLabel && (
        <span className="text-2xs text-muted-foreground">{refreshLabel}</span>
      )}
    </div>
  )
}

/**
 * 指令页右侧栏的「动态」tab：只在该 tab 挂载时才轮询，切走即停止。
 */
export function ServerFeedTab({
  transport,
  authenticated,
  serverId,
  refreshInterval,
  refreshToken,
  itemsById,
  prefixesById,
  atlas,
}: {
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  /** 服务器动态刷新间隔（毫秒）。 */
  refreshInterval: number
  /** 外部刷新令牌（例如底部聊天输入框发送成功后刷新）。 */
  refreshToken?: number
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
}) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<FeedFilter>('all')
  const { events, extra, available, refreshedAt, refresh } = useServerFeed({
    transport,
    authenticated,
    serverId,
    maxEvents: 500,
    refreshInterval,
    refreshToken,
  })
  const filtered = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => matchesFilter(e, filter))),
    [events, filter],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
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
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          onClick={refresh}
          aria-label={t('home.refresh')}
          title={t('home.refresh')}
        >
          <RefreshCw data-icon="inline-start" />
        </Button>
      </div>
      <ServerFeedList
        events={filtered}
        extra={extra}
        unavailable={available === false}
        unavailableText={t('editor.eventsPluginMissing')}
        refreshedAt={refreshedAt}
        itemsById={itemsById}
        prefixesById={prefixesById}
        atlas={atlas}
      />
    </div>
  )
}
