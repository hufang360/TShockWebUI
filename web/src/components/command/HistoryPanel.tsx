import { useEffect, useMemo } from 'react'
import { History, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'
import { IconAction } from '@/components/IconAction'
import { STATUS_TONE } from '@/components/ResultPanel'
import { SearchInput } from '@/components/SearchInput'
import { Badge, Button, Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'

import { usePanelMemory } from '@/hooks/useToolsMemory'
import type { HistoryEntry } from '@/types'

/**
 * 指令历史面板：
 * 搜索 + 列表（点一条载入编辑器）。
 *
 * 行内操作**只在悬停 / 聚焦时出现**：右侧的 ✕ 删掉这一条，时间让位给它 ——
 * 平时看时间，要动的时候才显示按钮，列表保持安静。
 * 「最多 N 条」+ 清空（垃圾桶）在**弹框底部 tab 栏的右侧**（`CommandToolsDialog` 渲染），
 * 不再单独占一行。
 */
export function HistoryPanel({
  history,
  onLoad,
  onRemove,
}: {
  history: HistoryEntry[]
  onLoad: (cmd: string) => void
  onRemove: (entry: HistoryEntry) => void
}) {
  const { t, lang } = useI18n()
  // 搜索词 + 滚动位置按页记忆（关掉弹框再打开还在）。
  const { query, setQuery, scrollRef, flushScroll } = usePanelMemory('history')
  // 关掉弹框时把滚动位置落盘。
  useEffect(() => flushScroll, [flushScroll])
  const keyword = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (keyword ? history.filter((h) => h.cmd.toLowerCase().includes(keyword)) : history),
    [history, keyword],
  )

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 flex-col gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('editor.historySearch')}
          aria-label={t('editor.historySearch')}
        />

        {history.length === 0 ? (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History />
              </EmptyMedia>
              <EmptyTitle>{t('editor.historyEmpty')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ul ref={scrollRef} className="min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1 flex">
              {filtered.map((h) => {
                // 旧数据可能缺 status：按 ok 兜底，避免渲染出 `status.undefined`。
                const status = h.status ?? (h.ok ? 'ok' : 'command_error')
                const key = `${h.ts}|${h.cmd}`
                return (
                  <li key={key} className="group/row relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          onClick={() => onLoad(h.cmd)}
                          className="h-auto w-full cursor-pointer justify-start gap-2 rounded-control bg-accent/40 py-1 pr-8 pl-2 font-pixel text-2xs font-normal hover:bg-accent"
                        >
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-left',
                              h.ok ? 'text-foreground' : 'text-destructive',
                            )}
                          >
                            {h.cmd}
                          </span>
                          {!h.ok && (
                            <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>
                          )}
                          {/* 悬停 / 聚焦时让位给 ✕（时间不是这一刻关心的事）。 */}
                          <span className="shrink-0 font-sans text-2xs text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden">
                            {formatClock(lang, h.ts)}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-80">
                        {h.cmd}
                      </TooltipContent>
                    </Tooltip>
                    {/* ✕ 浮在行右端（不占布局）：平时隐身，悬停 / 聚焦才出现。 */}
                    <IconAction
                      label={t('editor.historyRemove')}
                      icon={X}
                      size="icon-xs"
                      onClick={() => onRemove(h)}
                      className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                    />
                  </li>
                )
              })}
              {filtered.length === 0 && (
                <li className="px-2 py-2 text-2xs text-muted-foreground">
                  {t('editor.historyNoMatch')}
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
