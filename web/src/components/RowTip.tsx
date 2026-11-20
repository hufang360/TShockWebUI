import type { ReactNode } from 'react'
import { useItemTooltip } from '@/components/ItemTooltip'
import { SlotTooltip } from '@/components/SlotTooltip'
import { useItemStat } from '@/lib/datasetContext'
import type { Atlas, Item } from '@/types'

/**
 * 横条档格子的悬停提示锚点：**整条（图标 + 编号 + 名称）**都是触发区。
 *
 * 为什么单独抽一层：横条里 32px 图标只占左边一小块，其余全是文字 ——
 * 提示还只挂在图标上，等于「这条格子没有提示」。
 *
 * 提示内容与格子图标上的那份**完全同一套参数**（`useItemTooltip` + `useItemStat`，别只传一半）
 * ——同一件东西在横条和方块档下弹出的内容必须一样：
 * - 有真实物品（物品 ID、鱼店原生商品、图格的代表物品）→ 物品提示（图标 / 词缀 / 名称 / 数量 / 属性行）；
 * - 没有物品（NPC、Buff、鱼店借来的识别图）→ 一句「`#编号` + 名称」，免得弹出物品属性让人误会。
 *
 * 唯一的按页差异是 `hideDetailLink`：点格子本身就能开这件物品的详情时（物品 ID）传 `true`，
 * 与方块档的 `ItemIcon` 保持一致。
 */
export function RowTip({
  item,
  atlas,
  itemName,
  prefix,
  prefixId,
  stack,
  hideDetailLink,
  id,
  name,
  /** 无物品时的补充说明（Buff 的游戏内描述）。 */
  note,
  children,
}: {
  item?: Item
  atlas?: Atlas
  /** 提示里的物品名（鱼店商品名与物品名可能不同）。 */
  itemName?: string
  prefix?: string | null
  prefixId?: number
  stack?: number
  /** 不显示提示右上角的「物品详情」入口（点格子本身就能开详情时用）。 */
  hideDetailLink?: boolean
  /** 无物品时那句提示里的编号（物品 / NPC / 图格 / Buff / 商品序号）。 */
  id: string | number
  /** 无物品时那句提示里的名称。 */
  name: string
  /** 无物品时的补充说明（Buff 描述）；没有就不显示。 */
  note?: string
  children: ReactNode
}) {
  const stat = useItemStat(item?.id)
  const tip = useItemTooltip<HTMLSpanElement>({
    item,
    atlas,
    stat,
    name: itemName,
    prefix,
    prefixId,
    stack,
    hideDetailLink,
    disabled: !item,
  })
  const inner = (
    <span
      ref={tip.ref}
      {...tip.props}
      data-testid="row-tip"
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      {children}
    </span>
  )
  if (item) {
    return (
      <>
        {inner}
        {tip.node}
      </>
    )
  }
  return (
    <SlotTooltip
      label={
        <>
          <span className="block font-pixel text-2xs opacity-70">#{id}</span>
          <span className="block font-semibold">{name}</span>
          {note && <span className="mt-1 block max-w-64 opacity-80">{note}</span>}
        </>
      }
    >
      {inner}
    </SlotTooltip>
  )
}
