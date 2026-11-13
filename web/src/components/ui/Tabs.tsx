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

/**
 * `variant` **只写在 `TabsList` 上**：list 带 `data-variant`，trigger 用
 * `group-data-[variant=…]/tabs-list:` 继承（与 shadcn 一致）。调用点不要给 trigger 传变体。
 */
export function TabsList({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variant?: 'default' | 'line' }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        'group/tabs-list inline-flex h-9 items-center justify-center',
        variant === 'line' ? 'gap-2 rounded-none bg-transparent p-0' : 'rounded-menu bg-accent p-1',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex flex-1 cursor-pointer items-center justify-center gap-2 px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors',
        'text-muted-foreground hover:text-foreground',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5',
        'disabled:pointer-events-none disabled:opacity-50',
        // 下划线（line）：贴在 list 底边的一条 2px 伪元素，激活时淡入，字重不变。
        'group-data-[variant=line]/tabs-list:h-full',
        'group-data-[variant=line]/tabs-list:rounded-none',
        'group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground',
        'group-data-[variant=line]/tabs-list:after:absolute',
        'group-data-[variant=line]/tabs-list:after:inset-x-0',
        'group-data-[variant=line]/tabs-list:after:bottom-0',
        'group-data-[variant=line]/tabs-list:after:h-0.5',
        'group-data-[variant=line]/tabs-list:after:bg-foreground',
        'group-data-[variant=line]/tabs-list:after:opacity-0',
        'group-data-[variant=line]/tabs-list:after:transition-opacity',
        'group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100',
        // 下划线 tab 的焦点环内缩且很淡：Radix 点 tab 会把焦点移到 trigger 上，
        // 外圈 ring 会画成一个整块的「黑框」，看着像误触。
        'group-data-[variant=line]/tabs-list:focus-visible:outline-1',
        'group-data-[variant=line]/tabs-list:',
        'group-data-[variant=line]/tabs-list:focus-visible:outline-ring/40',
        // 胶囊（default）：白底 + 阴影浮起。
        'group-data-[variant=default]/tabs-list:rounded-control',
        'group-data-[variant=default]/tabs-list:data-[state=active]:bg-card',
        'group-data-[variant=default]/tabs-list:data-[state=active]:font-semibold',
        'group-data-[variant=default]/tabs-list:data-[state=active]:text-foreground',
        'group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm',
        'group-data-[variant=default]/tabs-list:focus-visible:outline-2 focus-visible:outline-offset-2',
        'group-data-[variant=default]/tabs-list:focus-visible:outline-ring',
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
