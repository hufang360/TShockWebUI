import type { ReactNode } from 'react'
import { useItemTooltip } from '@/components/ItemTooltip'
import { SlotTooltip } from '@/components/SlotTooltip'
import type { Atlas, Item } from '@/types'

/**
 * 横条档格子的悬停提示锚点：**整条（图标 + 编号 + 名称）**都是触发区。
 *
 * 为什么单独抽一层：横条里 32px 图标只占左边一小块，其余全是文字 ——
 * 提示还只挂在图标上，等于「这条格子没有提示」。
 *
 * 提示内容按数据来源选（与鱼店既有的规则一致）：
 * - 有真实物品（物品 ID、鱼店原生商品、图格的代表物品）→ 物品提示（图标 / 词缀 / 名称 / 数量）；
 * - 没有物品（NPC、Buff、鱼店借来的识别图）→ 一句「`#编号` + 名称」，免得弹出物品属性让人误会。
 */
export function RowTip({
  item,
  atlas,
  itemName,
  prefix,
  prefixId,
  stack,
  id,
  name,
  children,
}: {
  item?: Item
  atlas?: Atlas
  /** 提示里的物品名（鱼店商品名与物品名可能不同）。 */
  itemName?: string
  prefix?: string | null
  prefixId?: number
  stack?: number
  /** 无物品时那句提示里的编号（物品 / NPC / 图格 / Buff / 商品序号）。 */
  id: string | number
  /** 无物品时那句提示里的名称。 */
  name: string
  children: ReactNode
}) {
  const tip = useItemTooltip<HTMLSpanElement>({
    item,
    atlas,
    name: itemName,
    prefix,
    prefixId,
    stack,
    disabled: !item,
  })
  const inner = (
    <span ref={tip.ref} {...tip.props} className="flex min-w-0 flex-1 items-center gap-2">
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
        </>
      }
    >
      {inner}
    </SlotTooltip>
  )
}
