import type { ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 加载指示器（shadcn/ui Spinner）。
 *
 * 规则：Button 没有 `isPending` / `isLoading`，需要 loading 时用
 * `<Button disabled><Spinner data-icon="inline-start" />保存中…</Button>`；
 * 独立展示时给 `aria-label`，纯装饰时传 `aria-hidden`。
 */
export function Spinner({ className, ...props }: ComponentProps<typeof Loader2>) {
  return (
    <Loader2
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}
