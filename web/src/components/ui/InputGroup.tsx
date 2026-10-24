import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/* ── InputGroup（shadcn/ui）──────────────────────────────────────
 * 输入框内的图标 / 按钮一律走 InputGroup + InputGroupAddon，
 * 不再用 `relative` + 绝对定位的裸 button。 */

export function InputGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'group/input-group relative flex h-9 w-full min-w-0 items-center rounded-lg bg-accent',
        'focus-within:ring-2 focus-within:ring-ring focus-within:outline-none',
        'has-[[data-slot=input-group-control]:disabled]:cursor-not-allowed has-[[data-slot=input-group-control]:disabled]:opacity-50',
        'has-[>[data-align=inline-start]]:pl-1 has-[>[data-align=inline-end]]:pr-1',
        className,
      )}
      {...props}
    />
  )
}

export function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: ComponentProps<'div'> & { align?: 'inline-start' | 'inline-end' }) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        'flex h-full shrink-0 items-center justify-center gap-1 px-1.5 text-muted-foreground',
        '[&_button]:size-7 [&_button]:px-0',
        align === 'inline-end' && 'order-last',
        className,
      )}
      {...props}
    />
  )
}

export function InputGroupInput({ className, id, name, ...props }: ComponentProps<'input'>) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <input
      id={inputId}
      name={name ?? inputId}
      data-slot="input-group-control"
      className={cn(
        'h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground',
        'placeholder:text-muted-foreground focus:outline-none',
        'aria-invalid:text-destructive',
        className,
      )}
      {...props}
    />
  )
}
