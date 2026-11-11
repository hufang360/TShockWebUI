import type { ComponentProps } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-black/60 backdrop-blur-sm', className)}
      {...props}
    />
  )
}

export function DialogContent({
  className,
  children,
  /** 是否渲染暗色遮罩；`false` = 背景不变暗（更接近 popover 的行为，配 `modal={false}` 用）。 */
  overlay = true,
  /** 是否渲染右上角自带的关闭键（调用方自己提供更合适的关闭入口时用，如全宽搜索框）。 */
  hideClose = false,
  /**
   * 圆角档位：`modal`（默认，24px）适合内容型弹框；`container`（16px）给命令面板这类偏紧凑的。
   * 用属性而不是 `className` 覆盖：`rounded-modal` / `rounded-container` 是两个独立工具类，
   * twMerge 不会把它们当成同一组，同时写上只会由 CSS 顺序决定谁生效。
   */
  radius = 'modal',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  overlay?: boolean
  hideClose?: boolean
  radius?: 'modal' | 'container'
}) {
  return (
    <DialogPrimitive.Portal>
      {overlay && <DialogOverlay />}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
          'max-h-[calc(100dvh-2rem)] overflow-y-auto',
          radius === 'container' ? 'rounded-container' : 'rounded-modal',
          'bg-card p-4 text-card-foreground shadow-2xl',
          'focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-3 right-3 cursor-pointer rounded-control p-1 text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            )}
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

/**
 * 弹框底部操作区（shadcn AlertDialog 同款布局）。
 * 底色用 `bg-background`：**比卡片的 `bg-card` 深**（亮色/暗色主题下都比卡片暗），
 * 这样底部的操作按钮更醒目；用负外边距抵消 `DialogContent` 的 `p-5`，做成通栏。
 */
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end',
        '-mx-4 -mb-4 mt-1 rounded-b-modal border-t border-border/60 bg-background px-4 py-4',
        className,
      )}
      {...props}
    />
  )
}
