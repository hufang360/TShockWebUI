import { useState } from 'react'
import { ItemDetailPanel } from '@/components/items/ItemDetailPanel'
import { useLocalState } from '@/hooks/useLocalState'
import { StorageKeys } from '@/lib/storage'
import { Dialog, DialogContent } from '@/components/ui'
import {
  ItemDetailProvider,
  type DetailEntry,
  type ItemDetailApi,
  type ItemDetailOptions,
} from '@/lib/itemDetailContext'
import type { BackendTransport } from '@/lib/tshock'
import type { ItemDetailRecipeOptions } from '@/components/items/ItemDetailPanel'
import type { Dataset } from '@/types'

export interface ItemDetailDialogProps {
  dataset: Dataset
  /** 抽屉栈：`[根物品, 子物品…]`（配方材料 / 提示里的 ⓘ 会往里叠）。空数组 = 关闭。 */
  stack: DetailEntry[]
  /** 当前登录玩家名（`/give` 指令用）；未登录为 null。 */
  username?: string | null
  transport?: BackendTransport | null
  authenticated?: boolean
  /** 点配方材料 / 子物品的 ⓘ：叠一层。 */
  onPush: (entry: DetailEntry) => void
  /** 返回上一层。 */
  onBack: () => void
  /** 关掉整个弹框。 */
  onClose: () => void
}

/**
 * 物品详情**弹框**：物品图鉴以外的页面就地打开物品详情，不再跳到图鉴页。
 *
 * 内容与图鉴里的可堆叠抽屉完全同一份（`ItemDetailPanel`），只是外壳换成居中弹框：
 * - 从配方材料 / 提示里的 ⓘ 再点进别的物品时**叠一层**（左上角出现「返回」），不重开弹框；
 * - `DialogContent` 自带右上角 ×（= 关掉整个弹框）；
 * - 图鉴页仍然是 `ItemDetailDrawer`（可堆叠抽屉、状态记在 `DexState`），这里不接管。
 */
export function ItemDetailDialog({
  dataset,
  stack,
  username = null,
  transport,
  authenticated = false,
  onPush,
  onBack,
  onClose,
}: ItemDetailDialogProps) {
  // 合成表显示选项与图鉴页共用同一份本机设置（图鉴设置 Popover 改这里也生效）。
  const recipe = useRecipeOptions()
  const depth = stack.length - 1
  const entry = stack[depth]
  const item = entry ? dataset.itemsById.get(entry.id) ?? null : null

  // 打开时焦点落到主操作「复制ID」上（这个弹框最常见的用途就是拿 ID 去写指令）。
  // 用 `querySelector` 而不是透传 ref：按钮在 `ItemDetailPanel` 深处，透传要穿过整条渲染链。
  return (
    <Dialog
      open={stack.length > 0}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        data-testid="dex-detail-dialog"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          const target = document.querySelector<HTMLElement>('[data-testid="item-detail-copy-id"]')
          if (!target) return
          event.preventDefault()
          target.focus()
        }}
        // 标题栏 / 底部固定，只有中间滚动；宽度沿用图鉴详情的 ≤576px，窄屏左右各留 1rem。
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"
      >
        {entry && item && (
          // 这里再提供一次 Provider：弹框内点配方材料 / ⓘ 就叠一层，而不是重开一个弹框。
          <ItemDetailProvider api={toApi(entry, onPush)}>
            <DialogLayer
              // 每层一个新的组件实例：词缀选择是本层局部状态（与抽屉里一致）。
              key={depth}
              dataset={dataset}
              item={item}
              depth={depth}
              username={username}
              stackSize={entry.stack}
              recipe={recipe}
              transport={transport}
              authenticated={authenticated}
              onPrefixChange={() => {}}
              onBack={onBack}
              onCloseAll={onClose}
              initialPrefixId={entry.prefixId ?? 0}
            />
          </ItemDetailProvider>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 合成表 / 掉落列表的显示选项（与图鉴页共用本机设置）。 */
function useRecipeOptions(): ItemDetailRecipeOptions {
  const [showItemNames] = useLocalState<boolean>(StorageKeys.dexRecipeShowNames, false)
  const [twoColumn] = useLocalState<boolean>(StorageKeys.dexRecipeTwoColumn, false)
  return { showItemNames, twoColumn }
}

/** 把「打开某物品」转成往栈里 push（带着标签里的词缀 / 堆叠）。 */
function toApi(entry: DetailEntry, onPush: (entry: DetailEntry) => void): ItemDetailApi {
  return {
    open: (itemId: number, opts?: ItemDetailOptions) =>
      // 点自己不要叠（同一个物品在栈顶时忽略）。
      entry.id === itemId && (opts?.prefixId ?? 0) === (entry.prefixId ?? 0)
        ? undefined
        : onPush({ id: itemId, prefixId: opts?.prefixId, stack: opts?.stack }),
  }
}

/** 单层内容：词缀选择由本层自己维护，所以单独抽出来（`key` 换层时重建）。 */
function DialogLayer({
  dataset,
  item,
  depth,
  username,
  stackSize,
  recipe,
  transport,
  authenticated,
  onPrefixChange,
  onBack,
  onCloseAll,
  initialPrefixId,
}: {
  dataset: Dataset
  item: Parameters<typeof ItemDetailPanel>[0]['item']
  depth: number
  username: string | null
  stackSize?: number
  recipe: ItemDetailRecipeOptions
  transport?: BackendTransport | null
  authenticated: boolean
  onPrefixChange: (prefixId: number) => void
  onBack: () => void
  onCloseAll: () => void
  initialPrefixId: number
}) {
  const [prefixId, setPrefixId] = useState(initialPrefixId)
  return (
    <ItemDetailPanel
      item={item}
      dataset={dataset}
      depth={depth}
      username={username}
      prefixId={prefixId}
      onPrefixChange={(next) => {
        setPrefixId(next)
        onPrefixChange(next)
      }}
      stack={stackSize}
      recipe={recipe}
      transport={transport}
      authenticated={authenticated}
      onBack={onBack}
      onCloseAll={onCloseAll}
      chrome="dialog"
    />
  )
}
