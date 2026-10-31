import { useState, type ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

interface ConfirmButtonProps {
  /** 未确认时按钮上的内容（图标按钮可留空）。 */
  children?: ReactNode
  /** 二次确认按钮上的文案（如「确认清空」）。 */
  confirmLabel: ReactNode
  onConfirm: () => void
  /** 未确认时的图标（放进 Button，用 `data-icon` 控制尺寸）。 */
  icon?: ReactNode
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  /** 确认按钮的变体，默认 `danger`。 */
  confirmVariant?: ButtonProps['variant']
  className?: string
  /**
   * 确认态的容器类名（默认沿用 `className`）。
   * 图标按钮若用固定尺寸（如 `size-8`）对齐同排的发送键，确认态要传 `''`：
   * 否则 32px 的方框会把「确认 / 取消」两个文字按钮挤出去。
   */
  confirmClassName?: string
  disabled?: boolean
  title?: string
  'aria-label'?: string
}

/**
 * 就地二次确认按钮：第一次点击变成「确认 / 取消」，确认后才执行。
 * 用于清空结果 / 历史 / 收藏 / 队列这类不可撤销的批量操作。
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  icon,
  size = 'sm',
  variant = 'ghost',
  confirmVariant = 'danger',
  className,
  confirmClassName,
  disabled,
  title,
  'aria-label': ariaLabel,
}: ConfirmButtonProps) {
  const { t } = useI18n()
  const [confirming, setConfirming] = useState(false)
  // 图标按钮（`icon` / `icon-sm`）宽度是固定的，确认态的文字按钮退回 `sm`，否则「确认清空」会被挤爆。
  const confirmSize = size === 'icon' || size === 'icon-sm' ? 'sm' : size

  if (!confirming) {
    return (
      <Button
        size={size}
        variant={variant}
        className={className}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        onClick={() => setConfirming(true)}
      >
        {icon}
        {children}
      </Button>
    )
  }

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', confirmClassName ?? className)}>
      <Button
        size={confirmSize}
        variant={confirmVariant}
        onClick={() => {
          setConfirming(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={confirmSize} variant="ghost" onClick={() => setConfirming(false)}>
        {t('action.cancel')}
      </Button>
    </span>
  )
}
