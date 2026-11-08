import { useState } from 'react'
import { ItemDetailPanel, type ItemDetailRecipeOptions } from '@/components/items/ItemDetailPanel'
import { Drawer, DrawerContent } from '@/components/ui'
import { useIsMobile } from '@/hooks/use-mobile'
import type { DetailEntry } from '@/lib/itemDetailContext'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset } from '@/types'

export type { ItemDetailRecipeOptions }

export interface ItemDetailDrawerProps {
  dataset: Dataset
  /** 抽屉栈：`[根物品, 子物品, 孙物品…]`。每层渲染一个 `Drawer`，父层留在原位。 */
  stack: DetailEntry[]
  /** 当前层下标（0 = 根）。 */
  index: number
  /** 当前登录玩家名（`/give` 指令用）；未登录为 null。 */
  username?: string | null
  /** 根抽屉的词缀选择（存在 `DexState.prefixId`，切模块回来会还原）。 */
  rootPrefixId: number
  onRootPrefixChange: (prefixId: number) => void
  recipe: ItemDetailRecipeOptions
  /** 网页发言（词缀分组里的「广播到游戏内」）；未提供则不渲染该按钮。 */
  transport?: BackendTransport | null
  /** 已登录才允许广播。 */
  authenticated?: boolean
  /**
   * 「正在关闭」的层下标：该层及以上开始收起动画（等动画结束再真正出栈，避免瞬间消失）。
   * `null` = 没有正在关闭的层。
   */
  closingFrom: number | null
  /** 请求关闭第 `index` 层及以上的抽屉（点 × / 返回 / 滑走 / Esc 都会走这里）。 */
  onCloseFrom: (index: number) => void
  /** 第 `index` 层收起动画结束：出栈（截断到该层之下）。 */
  onClosed: (index: number) => void
}

/**
 * 物品详情抽屉（**可堆叠**）。
 *
 * 用 shadcn 的 Base UI `Drawer`（见 `ui/Drawer.tsx`）替代原来的右侧 `Sheet`：
 * - 桌面从右侧滑入、移动端从底部滑入（带拖拽手柄，可下滑关闭）；
 * - 在抽屉里再打开物品（配方材料 / 产物的点击、提示右上角的 ⓘ「物品详情」入口）会**叠一层新抽屉**，
 *   父抽屉缩小留在后面，关掉子抽屉即回到上一层；
 * - 每一层是独立的 `ItemDetailDrawer`（各自维护词缀选择），根层的词缀仍记到 `DexState`。
 */
export function ItemDetailDrawer({
  dataset,
  stack,
  index,
  username = null,
  rootPrefixId,
  onRootPrefixChange,
  recipe,
  transport,
  authenticated = false,
  closingFrom,
  onCloseFrom,
  onClosed,
}: ItemDetailDrawerProps) {
  const entry = stack[index]
  const item = dataset.itemsById.get(entry.id) ?? null
  const isMobile = useIsMobile()
  /** 本层是否展开（父层开始关闭时，子层一起收起）。 */
  const open = closingFrom == null || index < closingFrom
  // 子层（index > 0）的词缀选择是本层局部状态；根层的走 DexState。
  const [localPrefixId, setLocalPrefixId] = useState(entry.prefixId ?? 0)
  const prefixId = index === 0 ? rootPrefixId : localPrefixId
  const setPrefixId = index === 0 ? onRootPrefixChange : setLocalPrefixId

  if (!item) return null

  return (
    <Drawer
      open={open}
      // 桌面端非模态：遮罩由 `ItemsPage` 画的 `ContentScrim` 只盖内容区，左侧边栏照样能点（可切页）。
      // 手机端保持模态：抽屉本来就铺满整屏，模态更省心（点外面 / 下滑关闭）。
      modal={isMobile}
      // 非模态时 Base UI 默认「点外面 / 焦点离开」就关：点左侧导航是要切页，不该顺手关详情。
      // 关闭走遮罩（`ContentScrim`）/ × / Esc / 下滑。
      disablePointerDismissal={!isMobile}
      onOpenChange={(next) => {
        if (!next) onCloseFrom(index)
      }}
      onOpenChangeComplete={(next) => {
        // 只有「开始关闭的那一层」负责出栈：它上面几层会随栈截断一起卸载。
        if (!next && index === closingFrom) onClosed(index)
      }}
      swipeDirection={isMobile ? 'down' : 'right'}
      showSwipeHandle={isMobile}
    >
      <DrawerContent
        data-testid="dex-detail"
        data-detail-index={index}
        // 桌面端用页面那层 `ContentScrim`（只盖内容区），所以不要自带的全屏遮罩。
        overlay={isMobile}
        // 标题 / 底部固定，仅中间（tips + 合成表）滚动；宽度沿用旧弹框（≤576px，窄屏占满）。
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl data-[swipe-axis=x]:[--drawer-content-width:min(100vw,36rem)]"
      >
        <ItemDetailPanel
          item={item}
          dataset={dataset}
          depth={index}
          username={username}
          prefixId={prefixId}
          onPrefixChange={setPrefixId}
          stack={entry.stack}
          recipe={recipe}
          transport={transport}
          authenticated={authenticated}
          onBack={() => onCloseFrom(index)}
          onCloseAll={() => onCloseFrom(0)}
          chrome="drawer"
        />
        {/* 下一层抽屉：必须渲染在本层内容里（Base UI 靠 React 树判定嵌套） */}
        {stack[index + 1] != null && (
          <ItemDetailDrawer
            dataset={dataset}
            stack={stack}
            index={index + 1}
            username={username}
            rootPrefixId={rootPrefixId}
            onRootPrefixChange={onRootPrefixChange}
            recipe={recipe}
            transport={transport}
            authenticated={authenticated}
            closingFrom={closingFrom}
            onCloseFrom={onCloseFrom}
            onClosed={onClosed}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}
