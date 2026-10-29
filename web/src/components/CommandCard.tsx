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
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'

import { hasTextSelection } from '@/lib/selection'
import type { Atlas, CommandResult, Item, Prefix } from '@/types'

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
  itemsById,
  prefixesById,
  atlas,
  className,
}: CommandCardProps) {
  const { t, lang } = useI18n()
  // 展开 / 折叠状态按卡片记忆（切换模块回来仍保持）。
  const [open, setOpen] = useCollapsed(collapseKey)
  const lastRun = result?.ts ? new Date(result.ts) : null
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
        <CardBody className="flex flex-wrap items-center gap-2 py-2.5">
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
            <div className="min-h-0 flex-1 overflow-y-auto">
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
            {footerNote && <div className="shrink-0 text-2xs text-muted-foreground">{footerNote}</div>}
          </CardBody>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
