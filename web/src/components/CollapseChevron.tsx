import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 统一折叠箭头（全站唯一来源）：
 * - 展开：向下，默认隐藏，hover 触发元素时才淡入（用 `reveal` 指定 group-hover 类）；
 * - 折叠：向右（同一个图标旋转 -90°，带过渡动画），始终可见。
 * 箭头始终占位，避免 hover / 折叠时布局跳动。
 */
export function CollapseChevron({
  open,
  className,
  reveal = 'group-hover/title:opacity-100',
}: {
  open: boolean
  className?: string
  /** 展开态 hover 显示所用类（如 `group-hover/header:opacity-100`）。 */
  reveal?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('grid size-4 shrink-0 place-items-center text-muted-foreground', className)}
    >
      <ChevronDown
        className={cn(
          'size-4 transition-transform duration-200',
          open ? cn('touch-visible opacity-0', reveal) : '-rotate-90',
        )}
      />
    </span>
  )
}
