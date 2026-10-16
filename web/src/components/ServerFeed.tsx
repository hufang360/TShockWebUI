import { RichText } from '@/components/RichText'
import { Badge } from '@/components/ui'
import { useServerFeed } from '@/hooks/useServerFeed'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import type { BackendTransport, ServerEvent, ServerInfoExtra } from '@/lib/tshock'
import type { Atlas, Item, Prefix } from '@/types'

/** 事件类型 → 圆点颜色（未知类型兜底为低对比灰）。 */
function eventDot(type: string): string {
  switch (type) {
    case 'join':
      return 'bg-success'
    case 'leave':
      return 'bg-muted-foreground'
    case 'boss':
      return 'bg-warning'
    case 'chat':
      return 'bg-info'
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
  const { t } = useI18n()
  if (unavailable) {
    return <p className="text-xs text-warning">{unavailableText ?? t('editor.eventsPluginMissing')}</p>
  }
  const shown = limit != null ? events.slice(0, limit) : events
  const refreshLabel = feedRefreshLabel(t, refreshedAt ?? null, extra)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ServerFeedFlags extra={extra} />
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText ?? t('home.eventsEmpty')}</p>
      ) : (
        <ul className="min-h-0 flex-1 flex flex-col gap-1 overflow-y-auto pr-1">
          {shown.map((e) => (
            <li key={e.seq} className="flex items-start gap-2 text-xs">
              <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', eventDot(e.type))} />
              <span className="min-w-0 flex-1 break-words text-foreground/80">
                <RichText text={e.text} itemsById={itemsById} prefixesById={prefixesById} atlas={atlas} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {refreshLabel && (
        <span className="text-[10px] text-muted-foreground">{refreshLabel}</span>
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
  itemsById,
  prefixesById,
  atlas,
}: {
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  /** 服务器动态刷新间隔（毫秒）。 */
  refreshInterval: number
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
}) {
  const { t } = useI18n()
  const { events, extra, available, refreshedAt } = useServerFeed({
    transport,
    authenticated,
    serverId,
    maxEvents: 100,
    refreshInterval,
  })
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <span className="text-[10px] text-muted-foreground">{t('editor.eventsNote')}</span>
      <ServerFeedList
        events={events}
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
