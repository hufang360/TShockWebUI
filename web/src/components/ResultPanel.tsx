import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, Star, Terminal, Trash2 } from 'lucide-react'
import { LoadEarlier } from '@/components/LoadEarlier'
import { RichText } from '@/components/RichText'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useBottomList } from '@/hooks/useBottomList'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'

import type { Atlas, CommandResult, CommandStatus, Item, Prefix } from '@/types'

/** 结果卡片默认只渲染最近 N 条（与游戏内习惯一致），更早的用「加载更早」按钮按批展开。 */
const RESULT_WINDOW = 5

export const STATUS_TONE: Record<
  CommandStatus,
  'success' | 'danger' | 'warn' | 'neutral'
> = {
  ok: 'success',
  // 指令不存在多为「插件未安装」，不是玩家的输入错误，与 command_error 区分色调。
  command_not_found: 'warn',
  command_error: 'danger',
  no_permission: 'danger',
  token_invalid: 'warn',
  unavailable: 'warn',
  timeout: 'warn',
  bad_response: 'danger',
  rate_limited: 'warn',
  rejected: 'neutral',
}

/** 一条已完成的执行记录（追加到结果面板，不覆盖历史）。 */
export interface ResultEntry {
  /** 自增序号（1 起），用于稳定的 key 与「第 N 次」展示。 */
  seq: number
  ts: number
  command: string
  result: CommandResult
  /** 是否折叠（只留标题行）；随结果持久化，切走再回来仍保持。 */
  collapsed?: boolean
}

function OutputBlock({
  output,
  itemsById,
  prefixesById,
  atlas,
  fill = false,
}: {
  output: string[]
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  fill?: boolean
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  if (output.length === 0) {
    return <p className="text-xs text-foreground/60">{t('result.noOutput')}</p>
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className={cn('group/rich relative', fill && 'flex min-h-0 flex-1 flex-col')}>
      {/* 富文本正文 text-xs（12px 字号 / 20px 行高）：只缩字号，行内物品图标仍是 24px（游戏聊天占位框） */}
      <div
        className={cn(
          'flex flex-col gap-1 rounded-control bg-accent/60 p-2 pr-9 font-pixel text-xs leading-5 break-words whitespace-pre-wrap text-foreground',
          // 撑满时把多出来的高度留在灰底里（内容多则自己内部滚动），卡片底部就不会空一条。
          fill && 'min-h-0 flex-1 overflow-y-auto',
        )}
      >
        {output.map((line, index) => (
          <p key={index} className="min-h-5">
            {!line ? (
              '\u00a0'
            ) : (
              <RichText text={line} itemsById={itemsById} prefixesById={prefixesById} atlas={atlas} />
            )}
          </p>
        ))}
      </div>
      {/* hover 时右上角出现复制按钮：复制富文本区域的原始文本。 */}
      <Button
        size="icon-sm"
        variant="ghost"
        className="touch-visible absolute top-0.5 right-0.5 size-9 rounded-full opacity-0 transition-opacity group-hover/rich:opacity-100 focus-visible:opacity-100"
        aria-label={t('action.copy')}
        title={copied ? t('action.copied') : t('action.copy')}
        onClick={(e) => {
          e.stopPropagation()
          void copy()
        }}
      >
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      </Button>
    </div>
  )
}

/** 单独渲染一条指令结果（状态徽章 + 提示 + 富文本输出），供首页卡片复用。 */
export function CommandOutput({
  result,
  itemsById,
  prefixesById,
  atlas,
  showStatus = false,
  fill = false,
}: {
  result: CommandResult
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  showStatus?: boolean
  /** 撑满剩余高度（卡片被拉高时，多出来的空白留在**灰底正文区里面**，而不是卡片底部留一条裸空白）。 */
  fill?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className={cn('flex flex-col gap-2', fill && 'min-h-0 flex-1')}>
      {showStatus && (
        <Badge tone={STATUS_TONE[result.status]}>{t(`status.${result.status}`)}</Badge>
      )}
      <OutputBlock
        output={result.output}
        itemsById={itemsById}
        prefixesById={prefixesById}
        atlas={atlas}
        fill={fill}
      />
      {/* 失败原因放在富文本下方：用 Alert 说明「为什么没执行」，与输出区分开。 */}
      {result.message && (
        <Alert variant={STATUS_TONE[result.status] === 'danger' ? 'destructive' : 'warning'}>
          <AlertDescription className="text-xs">{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

/** 结果卡片右上角的图标按钮：统一 24px、统一 hover 才出现、统一带 Tooltip。 */
function ResultAction({
  label,
  icon,
  onClick,
  pressed,
  expanded,
  className,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  /** 只有可切换的操作（收藏）传，读屏能读到当前状态。 */
  pressed?: boolean
  /** 折叠开关传：读屏能读到展开 / 折叠状态。 */
  expanded?: boolean
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={cn('size-6 shrink-0 md:size-6', className)}
          aria-label={label}
          aria-pressed={pressed}
          aria-expanded={expanded}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * 一条执行结果 = 一张卡片（标题行：指令 / 时间 / 填充·收藏·删除·折叠）。
 * **可以折叠但不再是手风琴**：表头本身不可点（指令文字要能鼠标选中 / 复制），
 * 折叠是右上角一个独立的箭头按钮；折叠后只留标题行，且箭头**常显**（否则得先 hover 才能展开回来）。
 */
function ResultItem({
  entry,
  itemsById,
  prefixesById,
  atlas,
  onRemove,
  isFavorite,
  onToggleFavorite,
  onFillCommand,
  onToggleCollapse,
}: {
  entry: ResultEntry
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  onRemove?: (seq: number) => void
  isFavorite?: (cmd: string) => boolean
  onToggleFavorite?: (cmd: string) => void
  /** 把这条指令填回输入框（只填不执行）。 */
  onFillCommand?: (cmd: string) => void
  /** 切换折叠状态（传入后会随结果持久化，切换模块回来仍保持）。 */
  onToggleCollapse?: (seq: number, collapsed: boolean) => void
}) {
  const { t, lang } = useI18n()
  const { result, command } = entry
  // 未提供持久化回调时退化为组件内 state（单独渲染组件 / 测试用）。
  const [localCollapsed, setLocalCollapsed] = useState(false)
  const collapsed = entry.collapsed ?? localCollapsed
  const toggleCollapsed = () => {
    if (onToggleCollapse) onToggleCollapse(entry.seq, !collapsed)
    else setLocalCollapsed(!collapsed)
  }
  const abnormal = result.status !== 'ok'
  const favorited = isFavorite?.(command) ?? false
  return (
    <Card className="group/result bg-card/40">
      <CardHeader>
        {/* 指令本身用等宽体（是机器能读懂的字符串）；异常状态标红。 */}
        <CardTitle
          className={cn(
            'min-w-0 flex-1 truncate font-pixel text-sm font-semibold select-text',
            abnormal ? 'text-destructive' : 'text-foreground',
          )}
          title={command}
        >
          {command}
        </CardTitle>
        {/* 执行时间与右侧三个图标按钮一起**只在 hover / focus 时淡入**（触屏没有 hover，
            `touch-visible` 保持常显）；隐藏时仍占位，hover 不会让指令文字左右跳。 */}
        <span className="touch-visible shrink-0 text-2xs text-muted-foreground tabular-nums opacity-0 transition-opacity group-hover/result:opacity-100 group-focus-within/result:opacity-100">
          {formatClock(lang, entry.ts)}
        </span>
        <div className="touch-visible flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/result:opacity-100 group-focus-within/result:opacity-100">
          {onFillCommand && (
            <ResultAction
              label={t('result.fill')}
              icon={<Terminal data-icon="inline-start" />}
              onClick={() => onFillCommand(command)}
            />
          )}
          {onToggleFavorite && result.status === 'ok' && (
            <ResultAction
              label={favorited ? t('editor.unfavorite') : t('editor.favorite')}
              icon={<Star className={cn(favorited && 'fill-current')} data-icon="inline-start" />}
              pressed={favorited}
              onClick={() => onToggleFavorite(command)}
            />
          )}
          {onRemove && (
            <ResultAction
              label={t('result.remove')}
              icon={<Trash2 data-icon="inline-start" />}
              onClick={() => onRemove(entry.seq)}
            />
          )}
        </div>
        <ResultAction
          label={collapsed ? t('result.expand') : t('result.collapse')}
          expanded={!collapsed}
          icon={
            <ChevronDown
              className={cn('transition-transform', collapsed && '-rotate-90')}
              data-icon="inline-start"
            />
          }
          onClick={toggleCollapsed}
          // 折叠后常显；展开时跟其它操作一起 hover / 聚焦才淡入。
          className={cn(
            !collapsed &&
              'touch-visible opacity-0 transition-opacity group-hover/result:opacity-100 group-focus-within/result:opacity-100',
          )}
        />
      </CardHeader>
      {!collapsed && (
        <CardBody className="flex flex-col gap-2">
          {/* 异常状态 tag；执行成功不显示。 */}
          {abnormal && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[result.status]}>{t(`status.${result.status}`)}</Badge>
            </div>
          )}
          <CommandOutput
            result={result}
            itemsById={itemsById}
            prefixesById={prefixesById}
            atlas={atlas}
          />
        </CardBody>
      )}
    </Card>
  )
}

/**
 * 执行结果面板：每次执行追加到后面并保留，容器可滚动；
 * **默认停在最新一条**（贴底），用户向上回看时不打扰；更早的结果按批懒加载。
 */
export function ResultPanel({
  entries,
  running,
  itemsById,
  prefixesById,
  atlas,
  onRemove,
  isFavorite,
  onToggleFavorite,
  onFillCommand,
  onToggleCollapse,
  pageScroll = false,
}: {
  entries: ResultEntry[]
  running: boolean
  /** 物品索引；与 atlas 同时提供时，输出里的 [i:ID] 会渲染为图标。 */
  itemsById?: Map<number, Item>
  /** 词缀索引；用于图标提示里的词缀名。 */
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  /** 删除单条结果（传入后每条卡片右侧出现删除按钮）。 */
  onRemove?: (seq: number) => void
  /** 判断某条指令是否已收藏（成功执行的结果卡片会显示收藏按钮）。 */
  isFavorite?: (cmd: string) => boolean
  /** 收藏 / 取消收藏某条指令。 */
  onToggleFavorite?: (cmd: string) => void
  /** 把某条结果的指令填回输入框（传入后每条卡片右上角出现终端图标）。 */
  onFillCommand?: (cmd: string) => void
  /** 切换某条结果的折叠状态（传入后会持久化）。 */
  onToggleCollapse?: (seq: number, collapsed: boolean) => void
  /**
   * 由**页面级**滚动区滚动（浏览器右侧那条滚动条），结果自己不再溢出滚动。
   *
   * 「指令」页用它：结果越多页面越高，贴底跟随 / 回到底部 / 加载更早全部作用在 `<main>` 上。
   */
  pageScroll?: boolean
}) {
  const { t } = useI18n()
  // 页面级滚动时真正在滚的是 `<main>`（AppShell 主内容区），列表只负责把内容铺开。
  const [pageScroller, setPageScroller] = useState<HTMLElement | null>(null)
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    setPageScroller(node?.closest('main') ?? null)
  }, [])
  // 默认停在最新一条（贴底），旧结果按批懒加载（jsdom 下赋值无副作用）。
  const { ref, contentRef, onScroll, start, hidden, loadEarlier, step } = useBottomList(
    entries.length,
    { initial: RESULT_WINDOW, scroller: pageScroll ? pageScroller : null },
  )
  // 页面级滚动时 `<main>` 的 scroll 不会冒泡到列表上，得直接挂监听（判断用户是否还贴着底部）。
  useEffect(() => {
    if (!pageScroll || !pageScroller) return
    pageScroller.addEventListener('scroll', onScroll, { passive: true })
    return () => pageScroller.removeEventListener('scroll', onScroll)
  }, [pageScroll, pageScroller, onScroll])
  const shown = entries.slice(start)

  if (entries.length === 0 && !running) {
    return (
      <Empty className="min-h-40 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Terminal />
          </EmptyMedia>
          <EmptyTitle>{t('result.empty')}</EmptyTitle>
          <EmptyDescription>{t('editor.placeholder')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={rootRef}
        className={cn('flex min-w-0 flex-col', !pageScroll && 'min-h-0 flex-1')}
      >
        <div
          ref={ref}
          onScroll={pageScroll ? undefined : onScroll}
          className={
            pageScroll
              ? 'flex flex-col'
              : 'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1'
          }
        >
          {/* 内层容器由 useBottomList 观察：富文本结果在服务器返回后才长出内容，
              容器本身的尺寸不变，只观察容器抓不到这次高度变化。 */}
          <div ref={contentRef} className="flex flex-col gap-2">
            <LoadEarlier hidden={hidden} step={step} onLoad={loadEarlier} />
            {shown.map((entry) => (
              <ResultItem
                key={entry.seq}
                entry={entry}
                itemsById={itemsById}
                prefixesById={prefixesById}
                atlas={atlas}
                onRemove={onRemove}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
                onFillCommand={onFillCommand}
                onToggleCollapse={onToggleCollapse}
              />
            ))}
            {running && (
              <div className="flex items-center gap-2 pt-3 text-sm text-foreground">
                <Spinner className="size-3.5" />
                {t('result.running')}
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
