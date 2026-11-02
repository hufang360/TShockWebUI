import { Info, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconAction } from '@/components/IconAction'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'

interface HelpCardProps {
  /** 标题，默认「使用说明」。 */
  title?: string
  children: ReactNode
  /** 关闭回调（不给就不显示 ✕）。 */
  onClose?: () => void
  className?: string
}

/**
 * 「使用说明」卡片：`Info` 图标 + 标题 + 小字正文 +（可选）右上角 ✕。
 *
 * 抽屉底部、页面弹层、以及「本页卡片全被隐藏」时的正文区都用这一份，样式与文案保持一致。
 */
export function HelpCard({ title, children, onClose, className }: HelpCardProps) {
  const { t } = useI18n()
  return (
    <div className={cn('flex gap-2.5 rounded-container border border-border/60 p-3', className)}>
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{title ?? t('cards.helpTitle')}</p>
        <div className="mt-1 text-2xs leading-5 whitespace-pre-line text-muted-foreground">
          {children}
        </div>
      </div>
      {onClose && (
        <IconAction
          label={t('action.close')}
          icon={X}
          size="icon-xs"
          className="-mt-1 -mr-1 shrink-0"
          onClick={onClose}
        />
      )}
    </div>
  )
}
