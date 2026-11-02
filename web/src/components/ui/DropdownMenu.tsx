import type { ComponentProps } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[8rem] overflow-hidden rounded-menu bg-popover p-1 text-popover-foreground shadow-lg',
          'border border-border/60',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: 'default' | 'danger' }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-control px-2 py-2 text-xs outline-none select-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5',
        variant === 'danger' && 'text-destructive focus:bg-destructive/10 focus:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2 py-2 text-xs font-semibold text-foreground', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto text-2xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  )
}

const itemBase =
  'relative flex cursor-pointer items-center gap-2 rounded-control py-2 pr-2 text-xs outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5'

/** 勾选项（多选，如卡片管理里的「自动执行」）。左侧对勾指示当前状态。 */
export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  indicator = true,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  /** `false` = 不画左侧对勾列（右侧自带 `Switch` 时用）。 */
  indicator?: boolean
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemBase, indicator ? 'pl-7' : 'pl-2', className)}
      checked={checked}
      {...props}
    >
      {indicator && (
        <span className="absolute left-2 flex size-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <Check className="size-3" />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
      )}
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

/** 单选项（互斥，如卡片的宽度）。左侧圆点指示当前选中项。 */
export function DropdownMenuRadioItem({
  className,
  children,
  indicator = true,
  indicatorPosition = 'left',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  /** `false` = 不画对勾列。 */
  indicator?: boolean
  /** 对勾位置，默认左侧（左侧时留出 7 列缩进，右侧时靠右对齐）。 */
  indicatorPosition?: 'left' | 'right'
}) {
  const onRight = indicator && indicatorPosition === 'right'
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemBase, indicator && !onRight ? 'pl-7' : 'pl-2', className)}
      {...props}
    >
      {indicator && !onRight && (
        <span className="absolute left-2 flex size-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <Check className="size-3" />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
      )}
      {children}
      {onRight && (
        <span className="ml-auto flex size-3.5 items-center justify-center">
          <DropdownMenuPrimitive.ItemIndicator>
            <Check className="size-3" />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
      )}
    </DropdownMenuPrimitive.RadioItem>
  )
}
