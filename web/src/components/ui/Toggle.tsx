import type { ComponentProps } from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * 单键开关（shadcn `Toggle`，底层 `@radix-ui/react-toggle`）。
 *
 * 与 `Switch` 的区别：`Switch` 是「设置项」那种滑块，`Toggle` 是**工具条上的按压按钮**
 * —— 按下时高亮，适合「临时改一下当前面板的行为」这种场景。
 * 尺寸与同排的 `Button` / `ToggleGroup` 对齐（`sm` = 手机 36 / 桌面 28 那一档）。
 */
const toggleVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-control text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5',
  {
    variants: {
      variant: {
        // 按下态用 `bg-foreground/10`：它在 `bg-card` / `bg-popover` / `bg-accent` 上都能读出来
        // （`bg-card` 那种写法放在 popover 上几乎和背景同色，看不出按没按下）。
        //
        // 选择器用 **`aria-pressed`**，不用 `data-state`：这两者 Toggle 都会设，但把 Toggle 包进
        // `TooltipTrigger asChild` 时，Tooltip 会把自己的 `data-state`（`closed` / `delayed-open`）
        // 写到同一个元素上把 Toggle 的覆盖掉 —— 按下态就永远不生效（踩过）。
        default:
          'text-muted-foreground hover:bg-foreground/5 hover:text-foreground aria-pressed:bg-foreground/10 aria-pressed:font-semibold aria-pressed:text-foreground',
        outline:
          'border border-border bg-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground aria-pressed:border-foreground/20 aria-pressed:bg-foreground/10 aria-pressed:text-foreground',
      },
      size: {
        sm: 'h-6 px-2',
        md: 'h-7 px-2.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
)

export type ToggleProps = ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>

export function Toggle({ className, variant, size, ...props }: ToggleProps) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  )
}
