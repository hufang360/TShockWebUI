import type { ComponentProps, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(
        'h-9 w-full rounded-lg bg-accent px-3 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  )
}

export function Kbd({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded bg-accent px-1.5 py-0.5',
        'font-pixel text-[10px] text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
