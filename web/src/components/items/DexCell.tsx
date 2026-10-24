import { memo } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { closeItemTooltip } from '@/components/ItemTooltip'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Atlas, Item } from '@/types'

/** 图标框统一 **64×64**（= 游戏 `sizeLimit` 32 的 2 倍）→ `mode='game'` 下是整数 2× 最近邻放大，不糊。 */
export const ICON_SIZE = 64
export const COMPACT_ICON_SIZE = 56

/** 整块物品格子是 hover / 选中视觉区域；图标本身不铺底色或描边。 */
export const CELL_CLASS =
  'grid cursor-pointer place-items-center gap-1 rounded-xl px-1 py-1 transition duration-150 hover:-translate-y-0.5 hover:bg-primary/10 focus-visible:-translate-y-0.5 focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
export const CELL_SELECTED = 'bg-primary/20'
export const ICON_SURFACE_CLASS = 'relative inline-flex'

/**
 * 单个格子（64px 图标）：**点击整张卡片打开详情抽屉**；**图标区域悬停显示物品提示**。
 *
 * 提示只绑在 `ItemIcon` 上（不是整张卡片），避免在名称 / ID 文字上滑过时盖住卡片。
 * 小尺寸图标（配方行里的材料 / 产物、掉落条目）仍不可点：悬停出提示、点提示里的「合成表」才开抽屉。
 */
export const DexCell = memo(function DexCell({
  item,
  atlas,
  selected,
  width,
  height,
  index,
  compact = false,
  hideMeta = false,
  onSelect,
}: {
  item: Item
  /** 只传图集（不传整个 dataset）：dataset 会因运行时指令刷新而换新对象，整表重绘没有意义。 */
  atlas: Atlas | undefined
  selected: boolean
  width: number
  height: number
  /** 在完整结果列表中的索引；用于方向键导航。 */
  index: number
  /** 手机端紧凑格子：缩小图标，把 ID 叠到图标角上。 */
  compact?: boolean
  /** 隐藏格子下方的 ID / 名称，只保留图标。 */
  hideMeta?: boolean
  onSelect: (item: Item) => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={item.name}
      aria-pressed={selected}
      onClick={() => {
        closeItemTooltip()
        onSelect(item)
      }}
      data-dex-index={index}
      className={cn(CELL_CLASS, compact && 'gap-0.5', selected && CELL_SELECTED)}
      style={{ width, height }}
    >
      <span data-testid="dex-icon-surface" className={ICON_SURFACE_CLASS}>
        <ItemIcon
          item={item}
          atlas={atlas}
          size={compact ? COMPACT_ICON_SIZE : ICON_SIZE}
          hideRecipeLink
        />
        {compact && !hideMeta && (
          <span className="absolute -top-1 -left-1 rounded-sm bg-background/95 px-1 py-0.5 font-pixel text-2xs leading-none text-muted-foreground shadow-sm">
            {item.id}
          </span>
        )}
      </span>
      {!hideMeta && !compact && (
        <span className="font-pixel text-2xs leading-none text-muted-foreground">{item.id}</span>
      )}
      {!hideMeta && (
        <span className="w-full truncate text-center text-xs leading-4 text-foreground">
          {item.name}
        </span>
      )}
    </Button>
  )
})
