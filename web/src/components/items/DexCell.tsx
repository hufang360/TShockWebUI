import { memo } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { closeItemTooltip } from '@/components/ItemTooltip'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Atlas, Item } from '@/types'

/** 图标框统一 **64×64**（= 游戏 `sizeLimit` 32 的 2 倍）→ `mode='game'` 下是整数 2× 最近邻放大，不糊。 */
export const ICON_SIZE = 64

/**
 * 整块格子只负责 hover 上浮与焦点环；**底色只铺在 72×72 的图标区上**（与数据 ID 的 NPC 格子一致），
 * 平时没有底色。与「数据 ID → NPC」共用同一套尺寸：格子宽 72、图标 64。
 */
export const CELL_CLASS =
  'group/cell grid w-18 cursor-pointer place-items-center gap-1 rounded-container transition duration-150 hover:-translate-y-0.5 hover:bg-transparent focus-visible:-translate-y-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
export const CELL_SELECTED = 'bg-primary/20'
export const ICON_SURFACE_CLASS =
  'relative flex size-18 items-center justify-center rounded-control transition-colors group-hover/cell:bg-primary/10 group-focus-visible/cell:bg-primary/10'

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
      className={cn(CELL_CLASS, selected && CELL_SELECTED)}
      style={{ width, height }}
    >
      <span data-testid="dex-icon-surface" className={ICON_SURFACE_CLASS}>
        <ItemIcon item={item} atlas={atlas} size={ICON_SIZE} hideRecipeLink />
      </span>
      {!hideMeta && (
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
