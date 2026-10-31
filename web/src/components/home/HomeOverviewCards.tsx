import type { ComponentProps, ReactNode } from 'react'
import {
  Activity,
  ArrowRight,
  BookOpen,
  Fish,
  History,
  RefreshCw,
  Server,
  Settings,
  Terminal,
  Users,
} from 'lucide-react'
import { ServerFeedList } from '@/components/ServerFeed'
import { IconAction } from '@/components/IconAction'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'
import { isModuleEnabled, type ModulesPrefs } from '@/lib/modules'
import type { ServerStatus } from '@/lib/tshock'
import type { Dataset, HistoryEntry, TabId } from '@/types'

/**
 * 首页右栏「概览卡片」（从 `HomePage` 抽出，见 docs/TODO.md U6）：
 * 服务器状态 / 服务器动态 / 快捷入口 / 最近执行。纯展示，数据与回调由 `HomePage` 注入。
 */

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-foreground tabular-nums">{value}</dd>
    </div>
  )
}

/** 服务器状态卡片。 */
export function ServerStatusCard({
  status,
  lastStatusAt,
}: {
  status: ServerStatus | null
  lastStatusAt: number | null
}) {
  const { t, lang } = useI18n()
  const reachable = status?.reachable === true
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server />
          {t('home.server')}
        </CardTitle>
        <Badge tone={status === null ? 'neutral' : reachable ? 'success' : 'danger'}>
          {status === null ? t('home.connecting') : reachable ? t('status.online') : t('home.offline')}
        </Badge>
      </CardHeader>
      <CardBody className="flex-1">
        {status === null ? (
          <p className="text-xs text-muted-foreground">{t('home.connecting')}</p>
        ) : !reachable ? (
          <p className="text-sm text-destructive">{t('home.offline')}</p>
        ) : (
          <dl className="flex flex-col">
            {(
              [
                { label: t('home.nameLabel'), value: status?.name || '—' },
                { label: t('home.serverVersionLabel'), value: status?.serverversion ?? '—' },
                { label: t('home.tshockVersionLabel'), value: status?.tshockversion ?? '—' },
                { label: t('home.worldLabel'), value: status?.world || '—' },
                {
                  label: t('home.playersLabel'),
                  value: `${status?.playercount ?? 0} / ${status?.maxplayers ?? 0}`,
                },
                { label: t('home.port'), value: status?.port ?? '—' },
                { label: t('home.uptime'), value: status?.uptime || '—' },
                {
                  label: t('home.password'),
                  value: (
                    <Badge tone={status?.serverpassword ? 'warn' : 'neutral'}>
                      {status?.serverpassword ? t('home.passwordRequired') : t('home.passwordNone')}
                    </Badge>
                  ),
                },
              ] as { label: string; value: ReactNode }[]
            ).map((row, index) => (
              <div key={row.label}>
                {index > 0 && <Separator />}
                <InfoRow label={row.label} value={row.value} />
              </div>
            ))}
          </dl>
        )}
        {lastStatusAt && (
          <p className="mt-2 text-2xs text-muted-foreground tabular-nums">
            {t('home.lastRefresh', { time: formatClock(lang, lastStatusAt) })}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

/** 服务器动态卡片（事件流）。 */
export function EventsCard({
  events,
  extra,
  refreshedAt,
  switchedAt,
  eventsPlugin,
  dataset,
  onRefresh,
  onNavigate,
}: {
  events: ComponentProps<typeof ServerFeedList>['events']
  extra: ComponentProps<typeof ServerFeedList>['extra']
  refreshedAt: number | null
  /** 最近一次「上游换了服」的时间戳（短暂提示）。 */
  switchedAt: number | null
  /** 信使插件可用性；false = 未安装（隐藏「查看全部」）。 */
  eventsPlugin: boolean | null
  dataset: Dataset
  onRefresh: () => void
  onNavigate: (tab: TabId) => void
}) {
  const { t } = useI18n()
  return (
    <Card className="flex flex-col">
      <CardHeader className="group/header">
        <CardTitle className="flex items-center gap-2">
          <Activity />
          {t('home.events')}
        </CardTitle>
        {/* 刷新 / 箭头默认隐藏，hover（或键盘聚焦）表头才淡入；触屏常显。 */}
        <div className="flex touch-visible items-center gap-1 opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100">
          <IconAction label={t('home.refresh')} icon={RefreshCw} onClick={onRefresh} />
          {eventsPlugin !== false && (
            // 只要箭头（文字去掉）：tooltip / aria-label 仍然是「查看全部」。
            <IconAction
              label={t('home.viewAll')}
              icon={ArrowRight}
              onClick={() => {
                // 直接落到「聊天」页（服务器动态在那里）。
                onNavigate('chat')
              }}
            />
          )}
        </div>
      </CardHeader>
      <CardBody className="flex-1 flex flex-col gap-2">
        <ServerFeedList
          events={events}
          extra={extra}
          refreshedAt={refreshedAt}
          switchedAt={switchedAt}
          limit={6}
          emptyText={t('home.eventsEmpty')}
          itemsById={dataset.itemsById}
          prefixesById={dataset.prefixesById}
          atlas={dataset.atlas}
        />
      </CardBody>
    </Card>
  )
}

/**
 * 最近执行卡片。
 *
 * 高度跟着内容走（`HomePage` 最多取 5 条）：之前是固定 `xl:h-64` + 内部滚动，
 * 右侧多出一条几乎不可见的滚动条，看着像内容被截断了。滚动条没了，列表整段露出来。
 * 右端显示的是这条指令的执行时间（与「指令 → 历史」面板同一格式），不再是右箭头——
 * 整行都可点：跳到指令页、填进输入框、光标落进去。
 * 指令长了会被截断，所以 hover 整行用 `Tooltip` 出全文（不是 `title`，那个要等一两年才弹）。
 */
export function RecentCard({
  recent,
  onOpen,
}: {
  recent: HistoryEntry[]
  onOpen: (cmd: string) => void
}) {
  const { t, lang } = useI18n()
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History />
          {t('home.recent')}
        </CardTitle>
      </CardHeader>
      <CardBody>
        {recent.length === 0 ? (
          <Empty size="sm">
            <EmptyDescription>{t('home.recentEmpty')}</EmptyDescription>
          </Empty>
        ) : (
          <TooltipProvider delayDuration={200}>
            <ul className="flex flex-col gap-1">
              {recent.map((h) => (
                <li key={h.cmd}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-auto w-full justify-start gap-2 px-2 py-1 font-normal"
                        onClick={() => onOpen(h.cmd)}
                      >
                        <code
                          className={cn(
                            'min-w-0 flex-1 truncate text-left font-pixel text-xs',
                            h.ok ? 'text-foreground' : 'text-destructive',
                          )}
                        >
                          {h.cmd}
                        </code>
                        <span className="shrink-0 font-sans text-2xs text-muted-foreground tabular-nums">
                          {formatClock(lang, h.ts)}
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-72 text-left font-pixel text-2xs break-all whitespace-pre-wrap"
                    >
                      {h.cmd}
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </TooltipProvider>
        )}
      </CardBody>
    </Card>
  )
}

/** 快捷入口卡片（按模块开关显示鱼店 / 玩家管理）。 */
export function QuickLinksCard({
  modules,
  serverId,
  onNavigate,
}: {
  modules: ModulesPrefs
  serverId: string
  onNavigate: (tab: TabId) => void
}) {
  const { t } = useI18n()
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal />
          {t('home.quick')}
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col justify-center gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="justify-start"
            onClick={() => onNavigate('editor')}
          >
            <Terminal data-icon="inline-start" />
            {t('nav.editor')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="justify-start"
            onClick={() => onNavigate('items')}
          >
            <BookOpen data-icon="inline-start" />
            {t('nav.items')}
          </Button>
          {isModuleEnabled(modules, serverId, 'store') && (
            <Button
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={() => onNavigate('store')}
            >
              <Fish data-icon="inline-start" />
              {t('nav.store')}
            </Button>
          )}
          {isModuleEnabled(modules, serverId, 'players') && (
            <Button
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={() => onNavigate('players')}
            >
              <Users data-icon="inline-start" />
              {t('nav.players')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="justify-start"
            onClick={() => onNavigate('settings')}
          >
            <Settings data-icon="inline-start" />
            {t('settings.title')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
