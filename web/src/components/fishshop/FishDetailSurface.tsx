import type { ComponentProps, ReactNode } from 'react'
import { ContentScrim } from '@/components/ContentScrim'
import { Sheet, SheetContent } from '@/components/ui'

interface FishDetailSurfaceProps {
  /** 桌面端（≥768px）：遮罩只盖内容区、侧栏不动；否则普通模态抽屉。 */
  desktop: boolean
  open: boolean
  onClose: () => void
  onOpenAutoFocus: ComponentProps<typeof SheetContent>['onOpenAutoFocus']
  children: ReactNode
}

/**
 * 商品详情的抽屉。
 *
 * 桌面端：抽屉照旧贴右边整高，但**遮罩只盖内容区**（`--content-left` 是内容区左边界，
 * 见 `AppShell`）——左侧边栏不被盖住。遮罩会把内容区（含顶栏）压暗；
 * 侧栏收起时那个「展开侧栏」按钮由 `AppShell` 单独浮在遮罩之上（`z-46`）。
 * 遮罩只是半透黑，不做模糊。
 *
 * 为什么不用 `SheetContent` 自带的遮罩：它是 `inset-0`，会把侧栏一起压暗并挡住导航。
 * 所以这里自己画一层，点击它等同于「点抽屉外 → 关闭」（导航点击不算：见下面的 `preventDefault`）。
 *
 * 窄屏（<768px）保持普通模态抽屉：手机上抽屉铺满整屏，模态更省心。
 */
export function FishDetailSurface({
  desktop,
  open,
  onClose,
  onOpenAutoFocus,
  children,
}: FishDetailSurfaceProps) {
  return (
    <>
      {desktop && open && <ContentScrim onClick={onClose} testId="fish-detail-scrim" />}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        modal={!desktop}
      >
        <SheetContent
          side="right"
          overlay={!desktop}
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
          onOpenAutoFocus={onOpenAutoFocus}
          // 点「外面」不直接关：外面包括左侧导航（点它是要切页面，不是要关详情）。
          // 关闭走自己那层遮罩 / × / Esc。
          onInteractOutside={desktop ? (event) => event.preventDefault() : undefined}
          onPointerDownOutside={desktop ? (event) => event.preventDefault() : undefined}
        >
          {children}
        </SheetContent>
      </Sheet>
    </>
  )
}
