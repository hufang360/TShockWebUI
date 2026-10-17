import type { ComponentProps } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

/**
 * shadcn Popover（Radix）薄封装：点击 / 受控展开的浮层，用于承载富文本说明。
 *
 * 样式与 `DropdownMenuContent` / `DialogContent` 对齐：圆角 `rounded-xl`、`bg-popover`、
 * 细描边 + 阴影；`side` / `align` / `sideOffset` 透传给 Radix。
 */
export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  align = 'center',
  side = 'bottom',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-xl border border-border/60 bg-popover p-3 text-popover-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
