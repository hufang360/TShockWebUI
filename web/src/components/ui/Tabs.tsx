import type { ComponentProps } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

export function TabsList({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variant?: 'default' | 'line' }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex h-9 items-center justify-center',
        variant === 'line'
          ? 'gap-2 rounded-none border-b border-border/60 bg-transparent p-0'
          : 'rounded-lg bg-accent p-1',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: 'default' | 'line' }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors',
        'text-muted-foreground hover:text-foreground',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5',
        variant === 'line'
          ? 'rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-foreground'
          : 'rounded-md data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  )
}
