import type { ComponentProps } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * shadcn/ui Select（Radix `@radix-ui/react-select`）。
 *
 * 与项目里的 `NativeSelect` 并存：`NativeSelect` 用于**表单 / 紧凑无 JS**场景；
 * `Select` 用于需要**分组、分隔线、选中对勾**等富交互的场景（如物品图鉴的筛选）。
 */
export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

type SelectTriggerProps = ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}

export function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'flex w-fit cursor-pointer items-center justify-between gap-1.5 rounded-lg bg-accent whitespace-nowrap text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'data-[placeholder]:text-muted-foreground',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5',
        size === 'sm' ? 'h-7 py-1 pr-2 pl-2 text-xs' : 'h-9 px-3 py-2 text-sm',
        className,
      )}
      {...props}
    >
      <span className="line-clamp-1 flex items-center gap-1.5">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          'relative z-50 max-h-[min(24rem,60vh)] min-w-[8rem] overflow-x-hidden overflow-y-auto',
          'rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg',
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-pointer items-center rounded-lg py-1.5 pr-7 pl-2 text-xs outline-none select-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5',
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('flex items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUp className="size-3.5" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('flex items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDown className="size-3.5" />
    </SelectPrimitive.ScrollDownButton>
  )
}
