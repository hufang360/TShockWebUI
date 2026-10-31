import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Sonner 提示条（shadcn/ui 结构的本地版本）。
 *
 * 与 shadcn 原版的差别只有一处：主题不走 `next-themes`，而是由 `<App>` 把
 * `settings.theme`（light / dark / auto）算好的结果传下来，避免多一个 Provider。
 *
 * 用法：App 里挂一次 `<Toaster />`，业务里 `toast.success('...')`；
 * 多条会堆叠，`closeButton` 给每一条一个关闭按钮，`duration` 秒级自动消失。
 */
export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      // 用语义色令牌（不是 sonner 内置配色），亮 / 暗主题自动跟着走。
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  )
}
