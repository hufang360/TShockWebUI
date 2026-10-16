import type { ComponentProps } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { Button } from './Button'
import { cn } from '@/lib/utils'

/**
 * shadcn/ui Pagination（radix base）。
 *
 * 与本项目一致：`PaginationLink` 直接复用 `Button`（默认渲染 `<button>`，支持 `disabled`）；
 * 需要链接语义时可在调用处 `asChild` 换成 `<a>`。图标统一走 `data-icon`，尺寸由 Button 控制。
 */
export function Pagination({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}

export function PaginationContent({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex items-center gap-1', className)}
      {...props}
    />
  )
}

export function PaginationItem(props: ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Partial<Pick<ComponentProps<typeof Button>, 'size' | 'variant'>> &
  ComponentProps<'button'>

export function PaginationLink({
  className,
  isActive,
  size = 'icon',
  variant,
  ...props
}: PaginationLinkProps) {
  return (
    <Button
      data-slot="pagination-link"
      data-active={isActive || undefined}
      aria-current={isActive ? 'page' : undefined}
      variant={variant ?? (isActive ? 'outline' : 'ghost')}
      size={size}
      className={cn('text-sm', className)}
      {...props}
    />
  )
}

export function PaginationPrevious({
  className,
  ...props
}: ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="icon"
      className={cn(className)}
      {...props}
    >
      <ChevronLeft data-icon="inline-start" />
    </PaginationLink>
  )
}

export function PaginationNext({
  className,
  ...props
}: ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="icon"
      className={cn(className)}
      {...props}
    >
      <ChevronRight data-icon="inline-end" />
    </PaginationLink>
  )
}

export function PaginationEllipsis({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden="true"
      data-slot="pagination-ellipsis"
      className={cn('flex size-9 items-center justify-center [&_svg]:size-4', className)}
      {...props}
    >
      <MoreHorizontal />
      <span className="sr-only">More pages</span>
    </span>
  )
}
