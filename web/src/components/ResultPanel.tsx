import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Star, Terminal, Trash2 } from 'lucide-react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { RichText } from '@/components/RichText'
import {
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
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import type { Atlas, CommandResult, CommandStatus, Item, Prefix } from '@/types'

export const STATUS_TONE: Record<
  CommandStatus,
  'success' | 'danger' | 'warn' | 'neutral'
> = {
  ok: 'success',
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
      <div className="flex flex-col gap-1 rounded-xl bg-accent/60 p-3 pr-9 font-pixel text-sm leading-6 break-words whitespace-pre-wrap text-foreground">
        {output.map((line, index) => (
          <p key={index} className="min-h-6">
            {!line ? '\u00a0' : <RichText text={line} itemsById={itemsById} prefixesById={prefixesById} atlas={atlas} />}
          </p>
        ))}
      </div>
      {/* hover 时右上角出现复制按钮：复制富文本区域的原始文本。 */}
      <Button
        size="icon-sm"
        variant="ghost"
        className="absolute top-1.5 right-1.5 rounded-full opacity-0 transition-opacity group-hover/rich:opacity-100 focus-visible:opacity-100"
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
      {result.message && <p className="text-xs text-foreground/90">{result.message}</p>}
      <OutputBlock output={result.output} itemsById={itemsById} prefixesById={prefixesById} atlas={atlas} />
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
}: {
  entry: ResultEntry
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
  onRemove?: (seq: number) => void
  isFavorite?: (cmd: string) => boolean
  onToggleFavorite?: (cmd: string) => void
}) {
  const { t } = useI18n()
  const { result, command } = entry
  const [collapsed, setCollapsed] = useState(false)
  const abnormal = result.status !== 'ok'
  const favorited = isFavorite?.(command) ?? false
  return (
    <div className="group/result rounded-xl border border-border/60 bg-card/40 p-3">
      <Collapsible open={!collapsed} onOpenChange={(o) => setCollapsed(!o)}>
        {/* 表头：指令 + 收藏 + 删除（垃圾桶）+ 折叠箭头（大字号指令）。 */}
        <div className="flex items-center gap-1.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group/title flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
              aria-label={collapsed ? t('result.expand') : t('result.collapse')}
            >
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-pixel text-sm',
                  abnormal ? 'text-destructive' : 'text-foreground',
                )}
                title={command}
              >
                {command}
              </span>
            </button>
          </CollapsibleTrigger>
          {/* 收藏 / 删除：hover 卡片才出现，与折叠箭头同时出现。 */}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/result:opacity-100 focus-within:opacity-100">
            {onToggleFavorite && result.status === 'ok' && (
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
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
                className="shrink-0"
                aria-label={t('result.remove')}
                title={t('result.remove')}
                onClick={() => onRemove(entry.seq)}
              >
                <Trash2 data-icon="inline-start" />
              </Button>
            )}
          </div>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="shrink-0 cursor-pointer"
              aria-label={collapsed ? t('result.expand') : t('result.collapse')}
            >
              <CollapseChevron open={!collapsed} reveal="group-hover/result:opacity-100" />
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* 执行成功不显示 tag；异常状态 tag 在最左。 */}
              {abnormal && (
                <Badge tone={STATUS_TONE[result.status]}>{t(`status.${result.status}`)}</Badge>
              )}
              <span className="text-[10px] text-muted-foreground">
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
            </div>
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
 * 执行结果面板：把每次执行追加到后面并保留，容器可滚动，
 * 新结果出现时自动滚动到底部（不覆盖上次结果）。
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
}) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  // 新结果或执行状态变化时滚到底部（jsdom 下只是赋值，无副作用）。
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length, running])

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
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
      {entries.map((entry) => (
        <ResultItem
          key={entry.seq}
          entry={entry}
          itemsById={itemsById}
          prefixesById={prefixesById}
          atlas={atlas}
          onRemove={onRemove}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
      {running && (
        <div className="flex items-center gap-2 pt-3 text-sm text-foreground">
          <Spinner className="size-3.5" />
          {t('result.running')}
        </div>
      )}
    </div>
  )
}
