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
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'
import { isModuleEnabled, type ModulesPrefs } from '@/lib/modules'
import { StorageKeys, writeJson } from '@/lib/storage'
import type { ServerStatus } from '@/lib/tshock'
import type { Dataset, HistoryEntry, TabId } from '@/types'

/**
 * 首页右栏「概览卡片」（从 `HomePage` 抽出，见 docs/TODO.md U6）：
 * 服务器状态 / 服务器动态 / 快捷入口 / 最近执行。纯展示，数据与回调由 `HomePage` 注入。
 */

/** 「最近执行」卡片固定高度，内容超出时内部滚动。 */
const RECENT_CARD_HEIGHT = 'xl:h-64'

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity />
          {t('home.events')}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={onRefresh}
            aria-label={t('home.refresh')}
            title={t('home.refresh')}
          >
            <RefreshCw data-icon="inline-start" />
          </Button>
          {eventsPlugin !== false && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                // 直接落到「指令」页的「聊天」tab（服务器动态在那里）。
                writeJson(StorageKeys.commandPageTab, 'chat')
                onNavigate('editor')
              }}
            >
              {t('home.viewAll')}
              <ArrowRight data-icon="inline-end" />
            </Button>
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

/** 最近执行卡片。 */
export function RecentCard({
  recent,
  onOpen,
}: {
  recent: HistoryEntry[]
  onOpen: (cmd: string) => void
}) {
  const { t } = useI18n()
  return (
    <Card className={cn('flex flex-col', RECENT_CARD_HEIGHT)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History />
          {t('home.recent')}
        </CardTitle>
      </CardHeader>
      <CardBody className="flex-1 overflow-y-auto">
        {recent.length === 0 ? (
          <Empty size="sm">
            <EmptyDescription>{t('home.recentEmpty')}</EmptyDescription>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recent.map((h) => (
              <li key={h.cmd}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-1.5 py-1 font-normal"
                  onClick={() => onOpen(h.cmd)}
                  title={h.cmd}
                >
                  <code
                    className={cn(
                      'min-w-0 flex-1 truncate text-left font-pixel text-xs',
                      h.ok ? 'text-foreground' : 'text-destructive',
                    )}
                  >
                    {h.cmd}
                  </code>
                  <ArrowRight className="text-muted-foreground" data-icon="inline-end" />
                </Button>
              </li>
            ))}
          </ul>
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
