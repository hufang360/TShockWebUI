import type { ComponentProps } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

/**
 * shadcn Popover（Radix）薄封装：点击 / 受控展开的浮层，用于承载富文本说明。
 *
 * 样式与 `DropdownMenuContent` / `DialogContent` 对齐：圆角 `rounded-container`、`bg-popover`、
 * 细描边 + 阴影；`side` / `align` / `sideOffset` 透传给 Radix。
 */
/**
 * 「工具 / 选择」类浮层的统一宽度：聊天页的「物品 / 合成表」与指令页的
 * 「指令库 / 物品 / 收藏 / 历史」面板都套这一个，切换时不觉得宽窄在跳。
 */
export const PANEL_POPOVER_WIDTH = 'w-[min(32rem,calc(100vw-1rem))]'

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
          'z-50 w-72 rounded-container border border-border/60 bg-popover p-2 text-popover-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
