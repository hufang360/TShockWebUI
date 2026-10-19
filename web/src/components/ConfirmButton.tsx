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
  disabled,
  title,
  'aria-label': ariaLabel,
}: ConfirmButtonProps) {
  const { t } = useI18n()
  const [confirming, setConfirming] = useState(false)

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
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      <Button
        size={size}
        variant={confirmVariant}
        onClick={() => {
          setConfirming(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setConfirming(false)}>
        {t('action.cancel')}
      </Button>
    </span>
  )
}
