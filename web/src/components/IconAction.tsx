import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import {
  Button,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type ButtonProps,
} from '@/components/ui'
import { cn } from '@/lib/cn'

/** 图标按钮的三档尺寸：`icon-xs` 行内密集 / `icon-sm` 默认 / `icon` 主操作。尺寸由 Button 变体给出，调用点不要覆盖。 */
type IconActionSize = 'icon-xs' | 'icon-sm' | 'icon'

interface IconActionProps
  extends Omit<ComponentProps<'button'>, 'children' | 'className' | 'onClick' | 'size' | 'type'> {
  /** 按钮含义（同时作为 Tooltip 文本与 aria-label）。 */
  label: string
  icon: LucideIcon
  /** 图标的额外类名（如收藏星标 `fill-current`、折叠箭头 `-rotate-90`）。 */
  iconClassName?: string
  onClick?: ComponentProps<'button'>['onClick']
  disabled?: boolean
  /** 执行中：把图标换成 Spinner 并禁用。 */
  loading?: boolean
  /** 有开 / 关两态时（如全屏、工具面板）标记当前是否为开。 */
  pressed?: boolean
  /** 视觉上的「选中 / 打开」：底色抬升（Popover 打开、工具面板激活）。 */
  active?: boolean
  /** 尺寸档位，默认 `icon-sm`（手机 40px / 桌面 28px）。 */
  size?: IconActionSize
  /** 变体，默认 `ghost`。 */
  variant?: ButtonProps['variant']
  /**
   * 关闭 Tooltip。浮层内部的工具条不需要再叠一层提示，
   * 调用方自带 `title` 时也要关掉，否则原生提示与 Tooltip 会同时出现。
   */
  tooltip?: boolean
  className?: string
  /** 测试定位用（如 `terminal-topbar`）。 */
  testId?: string
}

export type { IconActionProps, IconActionSize }

/**
 * 图标按钮：`ghost` + `icon-sm` + 方形 `rounded-control`，悬停显示 shadcn `Tooltip`。
 *
 * 统一用它而不是手写 `<Button size="icon-sm" title=…>`：`title` 在触屏与快速划过的场景几乎不出现，
 * Tooltip 的可读性与一致性更好。
 *
 * 颜色统一为「次要图标」：常态 `text-muted-foreground`（比正文浅一档，不抢标题），
 * 悬停才变 `text-foreground`。顶栏右侧、卡片页头、各类工具条因此是同一档灰，
 * 不再出现「有的纯黑、有的灰」的混搭（需要更醒目的按钮就别用图标按钮，用带文字的 `Button`）。
 *
 * 需要当 Popover / DropdownMenu 的 `asChild` 触发器时，把 `<IconAction>` 套在触发器里即可
 * （内部 Button 会接住触发器传下来的 `onClick` / `ref` / `aria-*`）：
 *
 * ```tsx
 * <PopoverTrigger asChild>
 *   <IconAction label={t('dex.settings')} icon={Settings2} active={open} />
 * </PopoverTrigger>
 * ```
 */
export function IconAction({
  label,
  icon: Icon,
  iconClassName,
  onClick,
  disabled,
  loading,
  pressed,
  active,
  size = 'icon-sm',
  variant = 'ghost',
  tooltip = true,
  className,
  testId,
  ...rest
}: IconActionProps) {
  const button = (
    <Button
      {...rest}
      type="button"
      size={size}
      variant={variant}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled || loading}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'text-muted-foreground hover:text-foreground',
        active && 'bg-accent text-foreground',
        className,
      )}
    >
      {loading ? <Spinner aria-hidden /> : <Icon className={iconClassName} aria-hidden />}
      {/* 手机端 `…` 菜单里用 CSS 显示这个文字标签（顶栏横排时隐藏）。 */}
      <span data-action-label className="hidden truncate">
        {label}
      </span>
    </Button>
  )

  if (!tooltip) return button

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
