import { createContext, useContext, useMemo, type ComponentProps } from 'react'
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'
import { cn } from '@/lib/utils'

/**
 * shadcn `Drawer`（Base UI 版）——**可堆叠**抽屉。
 *
 * 与 `Sheet`（radix dialog）的区别：抽屉自己处理「拖拽 / 滑动关闭」，并且**支持嵌套**——
 * 在抽屉内容里再渲染一个 `Drawer`，父抽屉会留在原位（缩小 + 变暗 + 露出边缘），
 * 关掉子抽屉就回到父抽屉。面板样式（含堆叠所需 CSS 变量）取自 shadcn 官方 Base UI 版：
 * https://ui.shadcn.com/docs/components/base/drawer#nested
 *
 * 项目内只调整了配色（`bg-popover` / 与 `Sheet` 一致的遮罩）与标题排版。
 * 注意：Base UI 用 `render`（不是 radix 的 `asChild`）替换元素。
 */

type DrawerRootProps = DrawerPrimitive.Root.Props
/** 抽屉方向（四边）。 */
export type DrawerSwipeDirection = NonNullable<DrawerRootProps['swipeDirection']>

/** Root 把「方向 / 是否显示手柄」传给 Content（Base UI 的 Content 没有等价 prop）。 */
const DrawerConfigContext = createContext<{
  swipeDirection: DrawerSwipeDirection
  showSwipeHandle: boolean
}>({ swipeDirection: 'down', showSwipeHandle: false })

interface DrawerProps extends DrawerRootProps {
  /** 上 / 下抽屉在顶部显示一条可拖拽手柄（移动端更直观）。 */
  showSwipeHandle?: boolean
}

export function Drawer({ showSwipeHandle = false, swipeDirection = 'down', ...props }: DrawerProps) {
  const config = useMemo(
    () => ({ swipeDirection, showSwipeHandle }),
    [swipeDirection, showSwipeHandle],
  )
  return (
    <DrawerConfigContext.Provider value={config}>
      <DrawerPrimitive.Root data-slot="drawer" swipeDirection={swipeDirection} {...props} />
    </DrawerConfigContext.Provider>
  )
}

export function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

export function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

export function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

export function DrawerOverlay({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      // 遮罩不透明度随拖拽进度变化（Base UI 提供 --drawer-swipe-progress）。
      className={cn(
        'fixed inset-0 z-50 min-h-dvh bg-black/60 opacity-[max(var(--drawer-overlay-min-opacity,0),calc(1-var(--drawer-swipe-progress)))] transition-opacity duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] select-none data-ending-style:pointer-events-none data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-snap-points:[--drawer-overlay-min-opacity:0.5] data-starting-style:opacity-0 data-swiping:duration-0 supports-backdrop-filter:backdrop-blur-sm',
        className,
      )}
      {...props}
    />
  )
}

/** 拖拽手柄：竖向抽屉顶部一条横杠，横向抽屉靠外一侧一条竖杠。 */
export function DrawerSwipeHandle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-swipe-handle"
      aria-hidden="true"
      className={cn(
        'relative z-10 flex shrink-0 cursor-grab transition-opacity duration-200 group-data-nested-drawer-open/drawer-popup:opacity-0 group-data-nested-drawer-swiping/drawer-popup:opacity-100 after:block after:shrink-0 after:rounded-full after:bg-muted active:cursor-grabbing',
        // 竖向（上 / 下）
        'group-data-[swipe-axis=y]/drawer-popup:h-3 group-data-[swipe-axis=y]/drawer-popup:w-full group-data-[swipe-axis=y]/drawer-popup:justify-center group-data-[swipe-direction=down]/drawer-popup:items-end group-data-[swipe-direction=up]/drawer-popup:items-start group-data-[swipe-direction=up]/drawer-popup:order-last group-data-[swipe-axis=y]/drawer-popup:after:h-1 group-data-[swipe-axis=y]/drawer-popup:after:w-24',
        // 横向（左 / 右）
        'group-data-[swipe-axis=x]/drawer-popup:h-full group-data-[swipe-axis=x]/drawer-popup:w-3 group-data-[swipe-axis=x]/drawer-popup:items-center group-data-[swipe-direction=left]/drawer-popup:justify-start group-data-[swipe-direction=left]/drawer-popup:order-last group-data-[swipe-direction=right]/drawer-popup:justify-end group-data-[swipe-axis=x]/drawer-popup:after:h-24 group-data-[swipe-axis=x]/drawer-popup:after:w-1',
        className,
      )}
      {...props}
    />
  )
}

/** 抽屉面板 = portal + 遮罩 + 视口 + 弹层；堆叠所需的 CSS 变量都在这里。 */
export function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  const { swipeDirection, showSwipeHandle } = useContext(DrawerConfigContext)
  const swipeAxis = swipeDirection === 'up' || swipeDirection === 'down' ? 'y' : 'x'
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      {/* 视口铺满窗口，但自身不吃事件（只有面板可交互）。 */}
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className="pointer-events-none fixed inset-0 z-50 select-none"
      >
        <DrawerPrimitive.Popup
          data-slot="drawer-popup"
          data-swipe-axis={swipeAxis}
          className={cn(
            // 基础：固定定位 + 竖向 flex + 主题底色
            'group/drawer-popup pointer-events-auto fixed z-50 m-(--drawer-inset,0px) flex h-(--drawer-content-height) max-h-(--drawer-content-max-height,none) min-h-0 w-(--drawer-content-width,auto) transform-[translate3d(var(--translate-x,0px),var(--translate-y,0px),0)_scale(var(--stack-scale))] flex-col bg-popover text-sm text-popover-foreground shadow-2xl transition-[transform,height,opacity,filter] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform outline-none select-none [interpolate-size:allow-keywords] data-[swipe-direction=down]:rounded-t-modal data-[swipe-direction=down]:border-t data-[swipe-direction=left]:rounded-r-modal data-[swipe-direction=left]:border-r data-[swipe-direction=right]:rounded-l-modal data-[swipe-direction=right]:border-l data-[swipe-direction=up]:rounded-b-modal data-[swipe-direction=up]:border-b',
            // 嵌套：子抽屉打开时父抽屉隐藏内容（缩放后不留文字叠影）
            'data-nested-drawer-open:overflow-hidden data-nested-drawer-open:brightness-95',
            // 拖拽溢出补边（拖动时别露出遮罩）
            'after:pointer-events-none after:absolute after:bg-(--drawer-bleed-background,var(--color-popover)) data-[swipe-axis=x]:after:inset-y-0 data-[swipe-axis=x]:after:w-(--bleed) data-[swipe-axis=y]:after:inset-x-0 data-[swipe-axis=y]:after:h-(--bleed) data-[swipe-direction=down]:after:top-full data-[swipe-direction=left]:after:right-full data-[swipe-direction=right]:after:left-full data-[swipe-direction=up]:after:bottom-full',
            // 尺寸：竖向按内容高度（最多 100dvh-6rem）；横向 75% 宽，sm 起 24rem
            '[--drawer-content-height:var(--drawer-height,auto)] data-[swipe-axis=x]:[--drawer-content-width:75%] data-[swipe-axis=y]:[--drawer-content-max-height:calc(100dvh-6rem)] data-[swipe-axis=y]:data-snap-points:[--drawer-content-height:100dvh] data-[swipe-axis=x]:sm:[--drawer-content-width:24rem]',
            // 堆叠：父抽屉按嵌套层数缩小、露出 --peek 的边；随子抽屉拖拽进度复原
            '[--bleed:3rem] [--peek:1rem] [--stack-height:var(--drawer-frontmost-height,var(--drawer-height,0px))] [--stack-peek-offset:max(0px,calc((var(--nested-drawers)-var(--stack-progress))*var(--peek)))] [--stack-progress:clamp(0,var(--drawer-swipe-progress),1)] [--stack-scale-base:max(0,calc(1-(var(--nested-drawers)*var(--stack-step))))] [--stack-scale:clamp(0,calc(var(--stack-scale-base)+(var(--stack-step)*var(--stack-progress))),1)] [--stack-shrink:calc(1-var(--stack-scale))] [--stack-step:0.05]',
            // 进出场动画
            'data-ending-style:transform-(--closed-transform) data-ending-style:opacity-[0.9999] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-nested-drawer-swiping:duration-0 data-ending-style:data-nested-drawer-swiping:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:transform-(--closed-transform) data-swiping:duration-0 data-ending-style:data-swiping:duration-[calc(var(--drawer-swipe-strength)*400ms)]',
            // 竖向：左右贴边；有子抽屉时高度收到子抽屉高度（叠成卡片）
            'data-[swipe-axis=y]:inset-x-0 data-[swipe-axis=y]:data-nested-drawer-open:h-(--stack-height)',
            // 横向：上下贴边 + 横向排列（手柄在侧边）
            'data-[swipe-axis=x]:inset-y-0 data-[swipe-axis=x]:flex-row',
            // 方向：下
            'data-[swipe-direction=down]:bottom-0 data-[swipe-direction=down]:origin-bottom data-[swipe-direction=down]:[--closed-transform:translate3d(0,calc(100%+var(--drawer-inset,0px)+2px),0)] data-[swipe-direction=down]:[--translate-y:calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y)-var(--stack-peek-offset)-(var(--stack-shrink)*var(--stack-height)))]',
            // 方向：上
            'data-[swipe-direction=up]:top-0 data-[swipe-direction=up]:origin-top data-[swipe-direction=up]:[--closed-transform:translate3d(0,calc(-100%-var(--drawer-inset,0px)-2px),0)] data-[swipe-direction=up]:[--translate-y:calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y)+var(--stack-peek-offset)+(var(--stack-shrink)*var(--stack-height)))]',
            // 方向：左
            'data-[swipe-direction=left]:left-0 data-[swipe-direction=left]:origin-left data-[swipe-direction=left]:[--closed-transform:translate3d(calc(-100%-var(--drawer-inset,0px)-2px),0,0)] data-[swipe-direction=left]:[--translate-x:calc(var(--drawer-swipe-movement-x)+var(--stack-peek-offset)+(var(--stack-shrink)*100%))]',
            // 方向：右
            'data-[swipe-direction=right]:right-0 data-[swipe-direction=right]:origin-right data-[swipe-direction=right]:[--closed-transform:translate3d(calc(100%+var(--drawer-inset,0px)+2px),0,0)] data-[swipe-direction=right]:[--translate-x:calc(var(--drawer-swipe-movement-x)-var(--stack-peek-offset)-(var(--stack-shrink)*100%))]',
            className,
          )}
          {...props}
        >
          {showSwipeHandle && <DrawerSwipeHandle />}
          <DrawerPrimitive.Content
            data-slot="drawer-content"
            // 内容容器：flex 列；内部滚动区用 flex-1 + overflow-y-auto（不要用 h-full）
            className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain rounded-[inherit] transition-opacity duration-300 ease-[cubic-bezier(0.45,1.005,0,1.005)] select-text group-data-nested-drawer-open/drawer-popup:opacity-0 group-data-nested-drawer-swiping/drawer-popup:opacity-100 group-data-swiping/drawer-popup:select-none"
          >
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  )
}

export function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        'flex shrink-0 flex-col gap-0.5 group-data-[swipe-axis=y]/drawer-popup:text-center md:gap-1 md:text-left',
        className,
      )}
      {...props}
    />
  )
}

export function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('mt-auto flex shrink-0 flex-col gap-2', className)}
      {...props}
    />
  )
}

export function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  )
}

export function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-xs text-balance text-muted-foreground', className)}
      {...props}
    />
  )
}
