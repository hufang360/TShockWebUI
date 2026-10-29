import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { BatchDeleteControls } from '@/components/BatchDeleteControls'
import { ConfirmButton } from '@/components/ConfirmButton'
import { STATUS_TONE } from '@/components/ResultPanel'
import { SearchInput } from '@/components/SearchInput'
import { SelectIndicator } from '@/components/SelectIndicator'
import { Badge, Button, Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui'
import { useBatchSelect } from '@/hooks/useBatchSelect'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatClock } from '@/lib/clock'

import { HISTORY_LIMIT } from '@/lib/history'
import type { HistoryEntry } from '@/types'

/**
 * 指令历史面板（从 `CommandPage` 抽出，见 docs/TODO.md U6）：
 * 搜索 + 批量选择 / 去重 / 清空 + 逐条加载 / 删除。
 */
export function HistoryPanel({
  history,
  onLoad,
  onRemove,
  onDedupe,
  onClear,
}: {
  history: HistoryEntry[]
  onLoad: (cmd: string) => void
  onRemove: (entry: HistoryEntry) => void
  onDedupe: () => void
  onClear: () => void
}) {
  const { t, lang } = useI18n()
  const [query, setQuery] = useState('')
  const batch = useBatchSelect()
  const keyword = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (keyword ? history.filter((h) => h.cmd.toLowerCase().includes(keyword)) : history),
    [history, keyword],
  )

  const handleBatchDelete = () => {
    for (const key of batch.selected) {
      const sep = key.indexOf('|')
      const ts = Number(key.slice(0, sep))
      const cmd = key.slice(sep + 1)
      const entry = history.find((h) => h.ts === ts && h.cmd === cmd)
      if (entry) onRemove(entry)
    }
    batch.cancel()
  }

  return (
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
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
              {batch.active ? t('batch.hint') : t('editor.historyNote', { n: HISTORY_LIMIT })}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {!batch.active && (
                <ConfirmButton onConfirm={onDedupe} confirmLabel={t('action.dedupeConfirm')}>
                  {t('editor.historyDedupe')}
                </ConfirmButton>
              )}
              <BatchDeleteControls
                active={batch.active}
                count={batch.count}
                disabled={history.length === 0}
                onEnter={batch.enter}
                onCancel={batch.cancel}
                onConfirm={handleBatchDelete}
              />
              {!batch.active && (
                <ConfirmButton onConfirm={onClear} confirmLabel={t('action.clearConfirm')}>
                  {t('editor.historyClear')}
                </ConfirmButton>
              )}
            </div>
          </div>
          <ul className="min-h-0 flex-1 flex flex-col gap-1 overflow-y-auto pr-1">
            {filtered.map((h) => {
              // 旧数据可能缺 status：按 ok 兜底，避免渲染出 `status.undefined`。
              const status = h.status ?? (h.ok ? 'ok' : 'command_error')
              const key = `${h.ts}|${h.cmd}`
              const checked = batch.has(key)
              return (
                <li key={key}>
                  <Button
                    variant="ghost"
                    aria-pressed={batch.active ? checked : undefined}
                    title={batch.active ? undefined : t('favorites.load')}
                    onClick={() => {
                      if (batch.active) {
                        batch.toggle(key)
                        return
                      }
                      onLoad(h.cmd)
                    }}
                    className={cn(
                      'h-auto w-full cursor-pointer justify-start gap-2 rounded-lg bg-accent/40 px-1.5 py-1 font-pixel text-2xs font-normal hover:bg-accent',
                      checked && 'bg-accent',
                    )}
                  >
                    {batch.active && <SelectIndicator checked={checked} />}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-left',
                        h.ok ? 'text-foreground' : 'text-destructive',
                      )}
                    >
                      {h.cmd}
                    </span>
                    {!h.ok && <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>}
                    <span className="shrink-0 font-sans text-2xs text-muted-foreground">
                      {formatClock(lang, h.ts)}
                    </span>
                  </Button>
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
  )
}
