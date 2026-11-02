import { useState, type ReactNode } from 'react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { ItemIcon } from '@/components/ItemIcon'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Dataset } from '@/types'

/**
 * 物品详情里的**可折叠分区**（唯一实现）：[固定图标] 彩色标题 + 折叠箭头，内容默认单列网格。
 *
 * 「合成来源 / 用于合成 / 微光嬗变」与「词缀」共用这一份，标题色取自 `lib/sectionTones.ts`，
 * 所以点标题折叠的交互、箭头位置、配色永远一致。
 */
export function DetailSection({
  title,
  tone,
  dataset,
  iconId,
  twoColumn = false,
  defaultOpen = true,
  children,
}: {
  title: string
  /** 标题语义色（`RECIPE_SECTION_TONE`）。 */
  tone: string
  dataset: Dataset
  /** 固定图标；不传则标题前无图标。 */
  iconId?: number
  /** 两列视图（默认单列）。 */
  twoColumn?: boolean
  /** 默认展开（词缀等主操作分区传 false 时可默认收起）。 */
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1">
      <CollapsibleTrigger className="group/title flex w-full cursor-pointer items-center gap-2 text-sm font-medium">
        {iconId != null && (
          <ItemIcon
            item={dataset.itemsById.get(iconId)}
            atlas={dataset.atlas}
            size={20}
            tooltip={false}
          />
        )}
        <span className={cn('truncate', tone)}>{title}</span>
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className={cn(
            'grid gap-1',
            // 小屏（<sm）两列太挤：即使勾选了「两列视图」也只排一列（对应开关在小屏隐藏）。
            twoColumn ? 'grid-cols-2 max-sm:grid-cols-1' : 'grid-cols-1',
          )}
        >
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
