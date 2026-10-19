import { useState } from 'react'
import { ChevronRight, ListOrdered, X } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Spinner,
} from '@/components/ui'
import { useExecutionQueue, type QueueTask } from '@/lib/executionQueue'
import { useI18n } from '@/lib/i18n'

/**
 * 侧栏「执行队列」：只占一行，右侧显示正在执行 / 等待的数量。
 * 点击整行弹出弹框，弹框里才展示队列的实际内容，并可逐条禁止尚未执行的等待项。
 */
export function ExecutionQueuePanel() {
  const { t } = useI18n()
  const { current, pending, cancel, clear } = useExecutionQueue()
  const [open, setOpen] = useState(false)
  const total = pending.length + (current ? 1 : 0)

  const labelFor = (task: QueueTask) => (task.labelKey ? t(task.labelKey) : task.label)

  // 队列为空时完全隐藏，有请求时才出现（界面调整）。
  if (total === 0) return null

  return (
    <div className="shrink-0">
      <Separator className="mb-1 bg-sidebar-border" />
      <Button
        variant="ghost"
        className="h-auto w-full justify-start gap-2 px-3 py-2 font-normal"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <ListOrdered className="text-muted-foreground" data-icon="inline-start" />
        <span className="min-w-0 flex-1 truncate text-left text-xs text-foreground/90">
          {t('queue.title')}
        </span>
        <Badge tone="accent">{total}</Badge>
        <ChevronRight className="text-muted-foreground" data-icon="inline-end" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('queue.title')}</DialogTitle>
            <DialogDescription>{t('queue.dialogDesc')}</DialogDescription>
          </DialogHeader>

          {total === 0 ? (
            <Empty className="border border-dashed py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListOrdered />
                </EmptyMedia>
                <EmptyTitle>{t('queue.empty')}</EmptyTitle>
                <EmptyDescription>{t('queue.dialogDesc')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
              {current && <QueueItem label={labelFor(current)} command={current.command} running />}
              {pending.map((task) => (
                <QueueItem
                  key={task.id}
                  label={labelFor(task)}
                  command={task.command}
                  onForbid={() => cancel(task.id)}
                />
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('queue.close')}
            </Button>
            <ConfirmButton
              variant="danger"
              disabled={pending.length === 0}
              onConfirm={clear}
              confirmLabel={t('action.clearConfirm')}
            >
              {t('queue.clear')}
            </ConfirmButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function QueueItem({
  label,
  command,
  running = false,
  onForbid,
}: {
  label: string
  command: string
  running?: boolean
  onForbid?: () => void
}) {
  const { t } = useI18n()
  return (
    <li className="flex items-start gap-2 rounded-xl bg-accent/40 p-2.5">
      {running ? (
        <Spinner className="mt-0.5 size-3.5 text-primary" />
      ) : (
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-2xs text-foreground">{label}</div>
        <code className="mt-0.5 block break-all font-pixel text-2xs text-muted-foreground">
          {command}
        </code>
      </div>
      {onForbid ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label={t('queue.forbid')}
          title={t('queue.forbid')}
          onClick={onForbid}
        >
          <X data-icon="inline-start" />
        </Button>
      ) : (
        <span className="shrink-0 text-2xs text-muted-foreground">{t('queue.running')}</span>
      )}
    </li>
  )
}
