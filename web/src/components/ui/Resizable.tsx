import type { ComponentProps } from 'react'
import { GripVertical } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from '@/lib/utils'

/**
 * 可拖拽分栏（shadcn `Resizable`，底层 `react-resizable-panels`）。
 *
 * 用途：「指令」页宽屏时左右两栏（结果 / 聊天）的**宽度**由用户自己拖。
 * 只在宽屏分支里用（`useMediaQuery('(min-width: 1280px)')`），手机端仍然是上下 tab，不受影响。
 */
export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        'flex h-full w-full data-[panel-group-direction=vertical]:flex-col',
        className,
      )}
      {...props}
    />
  )
}

export function ResizablePanel({ ...props }: ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

/**
 * 分隔条：1px 细线 + 两侧各 2px 的抓取区（`after:` 伪元素把可点区域加宽，视觉上仍然很细）。
 * `withHandle` 打开时中间多一个方形把手（只在悬停 / 聚焦 / 拖动时显形，见调用处的 `className`）。
 */
export function ResizableHandle({
  withHandle,
  className,
  ...props
}: ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        'group/handle relative flex w-px items-center justify-center bg-border/60 transition-colors',
        // 视觉上 1px，但抓取区左右各 4px（伪元素），鼠标不用瞄准。
        'after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2',
        'hover:bg-border focus-visible:outline-ring focus-visible:outline-1 ',
        'data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full',
        'data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1',
        'data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2',
        'data-[panel-group-direction=vertical]:after:translate-x-0',
        '[&[data-panel-group-direction=vertical]>div]:rotate-90',
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div
          className={cn(
            'z-10 flex h-5 w-3 items-center justify-center rounded-chip border border-border bg-card',
            // 平时不显形：悬停 / 聚焦 / 拖动分栏时才出来（安静，不喧宾夺主）。
            'opacity-0 transition-opacity',
            'group-hover/handle:opacity-100 group-focus/handle:opacity-100 group-data-[resize-handle-state=drag]/handle:opacity-100',
          )}
        >
          <GripVertical className="size-2.5 text-muted-foreground" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  )
}
