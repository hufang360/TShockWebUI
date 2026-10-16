import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type NativeSelectProps = Omit<ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'md'
}

/**
 * shadcn/ui Native Select（无 JS 的原生 `<select>`）。
 *
 * `className` 作用在**外层容器**（宽度/对齐等布局），内部 `<select>` 的外观由组件决定；
 * `size="sm"` 用于翻页器/紧凑工具条。`aria-label` 等透传到 `<select>` 本身。
 */
export function NativeSelect({ className, size = 'md', children, ...props }: NativeSelectProps) {
  return (
    <div
      data-slot="native-select-wrapper"
      data-size={size}
      className={cn('group/native-select relative w-fit has-[select:disabled]:opacity-50', className)}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          'w-full appearance-none rounded-lg bg-accent text-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          'disabled:pointer-events-none disabled:cursor-not-allowed',
          size === 'sm' ? 'h-7 pr-7 pl-2 text-xs' : 'h-9 pr-8 pl-3 text-sm',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground select-none"
      />
    </div>
  )
}

export function NativeSelectOption({ className, ...props }: ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  )
}

export function NativeSelectOptGroup({ className, ...props }: ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  )
}
