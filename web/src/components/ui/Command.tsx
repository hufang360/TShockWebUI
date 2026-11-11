import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '@/lib/utils'

/**
 * Command（shadcn/ui，基于 cmdk）：多分组结果列表 + 键盘导航 + 无障碍
 * （`role=listbox/option`、`aria-activedescendant`）。
 *
 * 与 shadcn 默认实现的两处差异：
 * - 根节点**不加** `overflow-hidden`：它会把内部 `InputGroup` 的 `focus-within:ring-2`（画在盒子外侧）裁掉，
 *   表现成聚焦时描边残缺。列表自己就是滚动容器，不需要外层再裁。
 * - `CommandInput` **不带** shadcn 那个带放大镜与 `border-b` 的包裹层：项目里搜索框一律是
 *   `InputGroup`（圆角、底色、清空键都在它上面），所以这里只导出裸 input，放进 `InputGroup` 里用。
 *
 * 搜索排序**不交给 cmdk**（`shouldFilter={false}`）：分组与打分在 `lib/globalSearch.ts`，
 * cmdk 只负责高亮与键盘。圆角 / 字号走项目令牌，不另造一套尺寸。
 */

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn('flex w-full flex-col bg-popover text-popover-foreground', className)}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Input
    ref={ref}
    className={cn(
      'h-full w-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none',
      'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-[inherit] overflow-x-hidden overflow-y-auto', className)}
    {...props}
  />
))
CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn('px-3 py-4 text-xs text-muted-foreground', className)}
    {...props}
  />
))
CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden text-foreground',
      '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1',
      '[&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-muted-foreground',
      className,
    )}
    {...props}
  />
))
CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator ref={ref} className={cn('h-px bg-border', className)} {...props} />
))
CommandSeparator.displayName = CommandPrimitive.Separator.displayName

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      // 高亮 / 悬停是**圆角块**：左右各内缩 4px（`mx-1`）、`px-2` 补回来 → 文字仍与分组标题的 12px 对齐。
      'relative mx-1 flex cursor-pointer select-none items-center gap-2 rounded-control px-2 py-2 text-xs outline-none md:py-1.5',
      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
      '[&_svg]:pointer-events-none [&_svg]:shrink-0',
      className,
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

export { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator }
