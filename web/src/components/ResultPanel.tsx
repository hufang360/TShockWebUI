import { useState } from 'react'
import { Check, Copy, Star, Terminal, Trash2 } from 'lucide-react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { LoadEarlier } from '@/components/LoadEarlier'
import { RichText } from '@/components/RichText'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from '@/components/ui'
import { useBottomList } from '@/hooks/useBottomList'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'

import { hasTextSelection } from '@/lib/selection'
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
  /** 是否折叠（表头整块可点击切换）；持久化后切换模块回来状态还在。 */
  collapsed?: boolean
}

function OutputBlock({
  output,
  itemsById,
  prefixesById,
  atlas,
}: {
  output: string[]
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
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
    <div className="group/rich relative">
      {/* 富文本正文 text-xs（12px 字号 / 20px 行高）：只缩字号，行内物品图标仍是 24px（游戏聊天占位框） */}
      <div className="flex flex-col gap-1 rounded-xl bg-accent/60 p-3 pr-9 font-pixel text-xs leading-5 break-words whitespace-pre-wrap text-foreground">
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
}: {
  result: CommandResult
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  showStatus?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2">
      {showStatus && (
        <Badge tone={STATUS_TONE[result.status]}>{t(`status.${result.status}`)}</Badge>
      )}
      <OutputBlock output={result.output} itemsById={itemsById} prefixesById={prefixesById} atlas={atlas} />
      {/* 失败原因放在富文本下方：用 Alert 说明「为什么没执行」，与输出区分开。 */}
      {result.message && (
        <Alert variant={STATUS_TONE[result.status] === 'danger' ? 'destructive' : 'warning'}>
          <AlertDescription className="text-xs">{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function ResultItem({
  entry,
  itemsById,
  prefixesById,
  atlas,
  onRemove,
  isFavorite,
  onToggleFavorite,
  onToggleCollapse,
}: {
  entry: ResultEntry
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  onRemove?: (seq: number) => void
  isFavorite?: (cmd: string) => boolean
  onToggleFavorite?: (cmd: string) => void
  /** 切换折叠状态（传入后会持久化，切换模块回来仍保持）。 */
  onToggleCollapse?: (seq: number, collapsed: boolean) => void
}) {
  const { t, lang } = useI18n()
  const { result, command } = entry
  // 未提供持久化回调时退化为组件内 state。
  const [localCollapsed, setLocalCollapsed] = useState(false)
  const collapsed = entry.collapsed ?? localCollapsed
  const setCollapsed = (next: boolean) => {
    if (onToggleCollapse) onToggleCollapse(entry.seq, next)
    else setLocalCollapsed(next)
  }
  const abnormal = result.status !== 'ok'
  const favorited = isFavorite?.(command) ?? false
  const toggleLabel = collapsed ? t('result.expand') : t('result.collapse')
  return (
    <div className="group/result rounded-xl border border-border/60 bg-card/40 p-1.5">
      <Collapsible open={!collapsed} onOpenChange={(o) => setCollapsed(!o)}>
        {/* 表头整块可点击折叠：指令文本可鼠标选中复制（选中时不折叠）。 */}
        <CollapsibleTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-label={toggleLabel}
            className="group/title flex cursor-pointer items-center gap-1.5 text-left select-text"
            onClick={(e) => {
              if (hasTextSelection()) e.preventDefault()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setCollapsed(!collapsed)
              }
            }}
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-pixel text-sm font-semibold select-text',
                abnormal ? 'text-destructive' : 'text-foreground',
              )}
              title={command}
            >
              {command}
            </span>
            {/* 执行时间紧挨操作区（收藏 / 删除）左侧；与按钮一样**只在 hover / focus 时出现**
                （触屏没有 hover，`touch-visible` 保持常显，否则看不到时间）。 */}
            <span className="touch-visible shrink-0 text-2xs text-muted-foreground tabular-nums opacity-0 transition-opacity group-hover/result:opacity-100 group-focus-within/result:opacity-100">
              {formatClock(lang, entry.ts)}
            </span>
            {/* 收藏 / 删除：hover 卡片才出现；点击不触发展开 / 折叠。 */}
            <div
              className="touch-visible flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/result:opacity-100 focus-within:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              {onToggleFavorite && result.status === 'ok' && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-pressed={favorited}
                  aria-label={favorited ? t('editor.unfavorite') : t('editor.favorite')}
                  title={favorited ? t('editor.unfavorite') : t('editor.favorite')}
                  onClick={() => onToggleFavorite(command)}
                >
                  <Star className={cn(favorited && 'fill-current')} data-icon="inline-start" />
                </Button>
              )}
              {onRemove && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label={t('result.remove')}
                  title={t('result.remove')}
                  onClick={() => onRemove(entry.seq)}
                >
                  <Trash2 data-icon="inline-start" />
                </Button>
              )}
            </div>
            <CollapseChevron
              open={!collapsed}
              reveal="group-hover/result:opacity-100 group-focus-within/result:opacity-100"
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1.5 flex flex-col gap-2">
            {/* 异常状态 tag；执行成功不显示。执行时间已移到表头操作区左侧。 */}
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
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
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
  onToggleCollapse,
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
  /** 切换某条结果的折叠状态（传入后会持久化）。 */
  onToggleCollapse?: (seq: number, collapsed: boolean) => void
}) {
  const { t } = useI18n()
  // 默认停在最新一条（贴底），旧结果按批懒加载（jsdom 下赋值无副作用）。
  const { ref, contentRef, onScroll, start, hidden, loadEarlier, step } = useBottomList(entries.length, {
    initial: RESULT_WINDOW,
  })
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
    <div
      ref={ref}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
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
  )
}
