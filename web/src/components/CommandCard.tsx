import { type ReactNode } from 'react'
import { Play, RefreshCw } from 'lucide-react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { CommandOutput } from '@/components/ResultPanel'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useCollapsed } from '@/hooks/useCollapsed'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'

import { hasTextSelection } from '@/lib/selection'
import type { Atlas, CommandResult, Item, Prefix } from '@/types'

/**
 * 手动执行的卡片「多久算过时」：超过就把「执行于 09:12:03」标成 warning 色。
 *
 * 自动刷新的卡片有刷新间隔兜底，手动卡可能好几天没人点也完全合法 —— 颜色只负责提醒「这份快照可能不是现在的」。
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000
/** 带 help 字样的指令（`/help`、`/help Fishing`…）输出是教程 / 指令列表，不会随时间过时。 */
const HELP_COMMAND = /help/i

export interface CommandCardProps {
  title: ReactNode
  /** 标题前的图标（尺寸由 CardTitle 兜底）。 */
  icon?: ReactNode
  /** 卡片对应的指令（显示在底部）。 */
  command?: string | null
  result?: CommandResult
  loading?: boolean
  unavailable?: boolean
  /** 不可用时的文案（如「请先登录」）。 */
  unavailableText?: ReactNode
  /** 无结果时的文案。 */
  emptyText?: ReactNode
  /** 无结果时压成一行（默认开），避免首页出现多张高空白卡。 */
  compactEmpty?: boolean
  /** 底部命令右侧的弱化备注。 */
  footerNote?: ReactNode
  /** 右上角按钮语义：`refresh`（默认）显示刷新图标；`run` 表示手动执行，显示播放图标。 */
  action?: 'refresh' | 'run'
  onRefresh?: () => void
  /** 折叠状态记忆 key（不传则不持久化）；如 `home:status` / `world:relive` / `fish:rank`。 */
  collapseKey?: string
  /**
   * 卡片底部**左下角**是否显示「上次刷新 13:32:50」。
   *
   * `action="run"`（手动执行）的卡片**自动开启**：它不会自己跑，不给时间就无从判断这份数据是刚才的还是上次打开页面时的。
   * 自动刷新的卡片默认不显示（只看刷新按钮的 Tooltip）；目前只有首页「游戏时间」额外传 `true`：
   * 游戏内时间一直在走，看到现实里的刷新时刻才能判断卡片里的「当前时间是…」是不是已经过时了。
   */
  showLastRunAt?: boolean
  /** 结果里 [i:ID] 渲染图标所需的索引。 */
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  className?: string
}

/**
 * 指令结果卡片（首页 & 鱼店右侧共用）：
 * 标题 + 刷新按钮；结果区（富文本 / 空态 / 不可用）；底部「指令 + 备注」。
 */
export function CommandCard({
  title,
  icon,
  command,
  result,
  loading,
  unavailable,
  unavailableText,
  emptyText,
  compactEmpty = true,
  footerNote,
  action = 'refresh',
  onRefresh,
  collapseKey,
  showLastRunAt = false,
  itemsById,
  prefixesById,
  atlas,
  className,
}: CommandCardProps) {
  const { t, lang } = useI18n()
  // 展开 / 折叠状态按卡片记忆（切换模块回来仍保持）。
  const [open, setOpen] = useCollapsed(collapseKey)
  const lastRun = result?.ts ? new Date(result.ts) : null
  // 页面久开着不做任何事时，「过时」也要自己变红灯，不能等用户点一下才刷新配色。
  const now = useNow(30_000)
  // 手动执行的卡片（含用户加的自定义卡片）左下角常显执行时间。
  const showTime = showLastRunAt || action === 'run'
  const stale =
    action === 'run' &&
    lastRun != null &&
    !HELP_COMMAND.test(command ?? '') &&
    now - lastRun.getTime() > STALE_AFTER_MS
  // 底部那行时间：自动刷新的卡说「上次刷新」，手动执行的卡说「执行于」。
  const lastRunLabel =
    showTime && lastRun
      ? t(action === 'run' ? 'home.lastRun' : 'home.lastRefresh', {
          time: formatClock(lang, lastRun),
        })
      : null
  const refreshButton = (compact: boolean) =>
    onRefresh ? (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size={compact ? 'icon-sm' : 'sm'}
              variant="ghost"
              aria-label={action === 'run' ? t('home.run') : t('home.refresh')}
              disabled={unavailable || loading}
              onClick={onRefresh}
              // 卡片页头的图标按钮统一用「次要灰」（与顶栏 IconAction 同一档）；
              // 带文字的形态保持正文色，免得标签也跟着变淡。
              className={compact ? 'text-muted-foreground hover:text-foreground' : undefined}
            >
              {loading ? (
                <Spinner aria-hidden data-icon="inline-start" />
              ) : action === 'run' ? (
                <Play data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {!compact && (action === 'run' ? t('home.run') : t('home.refresh'))}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {lastRun ? t('home.lastRun', { time: formatClock(lang, lastRun) }) : t('home.neverRun')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : null

  if (compactEmpty && !result && !loading && !unavailable && onRefresh) {
    return (
      <Card className={cn('overflow-hidden', className)} data-command={command ?? undefined}>
        {/* 紧凑行也要把图标压到 `size-4`：这里少了这条规则，图标会按 SVG 默认的 24px 渲染，
            看起来比展开态的页头图标大一圈（鱼篓榜那种「画满画布」的图标尤其明显）。 */}
        <CardBody className="flex flex-wrap items-center gap-2 py-3 [&_svg:not([class*='size-'])]:size-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {icon}
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {emptyText ?? t('home.notRun')}
          </span>
          {refreshButton(false)}
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)} data-command={command ?? undefined}>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="flex min-h-0 flex-1 flex-col"
      >
        <CollapsibleTrigger asChild>
          {/* 整个头部可点击折叠；标题可鼠标选中复制（选中时不折叠）。 */}
          <CardHeader
            className="group/header shrink-0 cursor-pointer select-text [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            role="button"
            tabIndex={0}
            aria-label={open ? t('result.collapse') : t('result.expand')}
            onClick={(e) => {
              if (hasTextSelection()) e.preventDefault()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOpen(!open)
              }
            }}
          >
            {icon}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide text-foreground select-text">
              {title}
            </span>
            {/* 操作按钮：默认隐藏，hover 表头才显示；折叠时不显示；点击不触发折叠。 */}
            {open && (result || loading) && (
              <div
                className="flex shrink-0 touch-visible items-center gap-1 opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                {refreshButton(true)}
              </div>
            )}
            <CollapseChevron
              open={open}
              reveal="group-hover/header:opacity-100 group-focus-within/header:opacity-100"
            />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex min-h-0 flex-1 flex-col">
          <CardBody className="flex min-h-0 flex-1 flex-col gap-2">
            {/* 撑满剩余高度：卡片被同行更高的卡拉高时，多出来的空间留在灰底正文区里，
                正文与卡片底部（或页脚备注 / 「上次刷新」）之间的间距保持和「Boss 进度」一样紧。 */}
            <div className="flex min-h-0 flex-1 flex-col">
              {unavailable ? (
                <p className="text-xs text-muted-foreground">
                  {unavailableText ?? t('home.needLogin')}
                </p>
              ) : result ? (
                <CommandOutput
                  result={result}
                  showStatus={result.status !== 'ok'}
                  itemsById={itemsById}
                  prefixesById={prefixesById}
                  atlas={atlas}
                  fill
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {loading ? t('home.refreshing') : (emptyText ?? t('home.notRun'))}
                  </p>
                  {!loading && refreshButton(false)}
                </div>
              )}
            </div>
            {(footerNote || lastRunLabel) && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                {/* 时间在左：只有一项时 `justify-between` 不会把它推到右边。 */}
                {lastRunLabel &&
                  (stale ? (
                    // 变黄要能解释为什么：悬停 / 聚焦给出「可能已过时」，不另加一行文案。
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            data-stale="true"
                            className="shrink-0 cursor-help rounded-chip tabular-nums text-warning focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {lastRunLabel}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{t('home.maybeStale')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <span className="shrink-0 tabular-nums">{lastRunLabel}</span>
                  ))}
                {footerNote}
              </div>
            )}
          </CardBody>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
