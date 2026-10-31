import { useId, type ComponentProps, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, id, name, ...props }: ComponentProps<'input'>) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <input
      id={inputId}
      name={name ?? inputId}
      data-slot="input"
      className={cn(
        'h-9 w-full rounded-control bg-accent px-3 text-sm text-foreground',
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
        'inline-flex min-w-5 items-center justify-center rounded-chip bg-accent px-2 py-0.5',
        'font-pixel text-2xs text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
