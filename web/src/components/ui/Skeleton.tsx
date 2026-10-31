import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** shadcn Skeleton：加载占位统一用它，不要手写 animate-pulse 色块。 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-control bg-muted', className)}
      {...props}
    />
  )
}
