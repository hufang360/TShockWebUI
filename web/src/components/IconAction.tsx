import type { LucideIcon } from 'lucide-react'
import { Button, Spinner, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'

interface IconActionProps {
  /** 按钮含义（同时作为 Tooltip 文本与 aria-label）。 */
  label: string
  icon: LucideIcon
  onClick?: () => void
  disabled?: boolean
  /** 执行中：把图标换成 Spinner 并禁用。 */
  loading?: boolean
  /** 有开 / 关两态时（如全屏、工具面板）标记当前是否为开。 */
  pressed?: boolean
  className?: string
  /** 测试定位用（如 `terminal-topbar`）。 */
  testId?: string
}

/**
 * 顶栏 / 工具条上的图标按钮：默认 `ghost` + `icon-sm`，悬停显示 shadcn `Tooltip`。
 *
 * 统一用它而不是手写 `<Button title=…>`：`title` 在触屏与快速划过的场景几乎不出现，
 * Tooltip 的可读性与一致性更好。
 */
export function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  loading,
  pressed,
  className,
  testId,
}: IconActionProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled || loading}
            onClick={onClick}
            className={className}
            data-testid={testId}
          >
            {loading ? <Spinner aria-hidden /> : <Icon />}
            {/* 手机端 `…` 菜单里用 CSS 显示这个文字标签（顶栏横排时隐藏）。 */}
            <span data-action-label className="hidden truncate">
              {label}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
