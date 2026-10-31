import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      // shadcn 标准卡片表面：圆角 + 语义色边框 + 背景色，不使用投影。
      className={cn('rounded-container border bg-card text-card-foreground', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex items-center justify-between gap-2 px-2 py-2', className)}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { children: ReactNode }) {
  return (
    <h2
      data-slot="card-title"
      className={cn(
        'text-sm font-semibold tracking-wide text-foreground',
        '[&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className,
      )}
      {...props}
    >
      {children}
    </h2>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-body" className={cn('px-2 pb-2', className)} {...props} />
}
