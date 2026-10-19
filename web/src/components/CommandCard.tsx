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
  footerNote,
  action = 'refresh',
  onRefresh,
  collapseKey,
  itemsById,
  prefixesById,
  atlas,
  className,
}: CommandCardProps) {
  const { t } = useI18n()
  // 展开 / 折叠状态按卡片记忆（切换模块回来仍保持）。
  const [open, setOpen] = useCollapsed(collapseKey)
  const lastRun = result?.ts ? new Date(result.ts) : null
  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
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
            <div
              className={cn(
                'flex shrink-0 items-center gap-1',
                open ? 'opacity-0 transition-opacity group-hover/header:opacity-100' : 'hidden',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {onRefresh && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-sm"
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
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {lastRun
                        ? t('home.lastRun', { time: lastRun.toLocaleTimeString() })
                        : t('home.neverRun')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <CollapseChevron open={open} reveal="group-hover/header:opacity-100" />
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
                <div className="flex flex-col gap-1.5">
                  {/* 无权限：卡片保留，给出本地化提示（TShock 的原文可能不是当前语言）。 */}
                  {result.status === 'no_permission' && (
                    <p className="text-xs text-warning">{t('home.permissionDenied')}</p>
                  )}
                  <CommandOutput
                    result={
                      result.status === 'no_permission'
                        ? { ...result, message: undefined }
                        : result
                    }
                    itemsById={itemsById}
                    prefixesById={prefixesById}
                    atlas={atlas}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {loading ? t('home.refreshing') : (emptyText ?? t('home.empty'))}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <code className="font-pixel text-2xs text-muted-foreground">{command ?? '—'}</code>
              {footerNote}
            </div>
          </CardBody>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
