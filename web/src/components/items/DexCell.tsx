import { memo } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { closeItemTooltip } from '@/lib/itemTooltipBus'
import { RowTip } from '@/components/RowTip'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { iconPlateClass, ROW_PLATE_CLASS, type IconGridSize } from '@/lib/iconGridSize'
import type { Atlas, Item } from '@/types'

/** 图标尺寸档位（页面设置 →「图标大小」）；档位名与容错来自 `lib/iconGridSize`，与数据 ID / 鱼店共用。 */
export type ItemIconSize = IconGridSize

/** 物品 ID 默认「横条」：图标在左、ID 与名称在右，一屏能看更多件也读得全（页面设置可改成小 / 中 / 大）。 */
export const DEFAULT_ITEM_ICON_SIZE: IconGridSize = 'row'

interface ItemSizeSpec {
  /**
   * 图标边长：64 = 游戏 `sizeLimit` 32 的 2 倍（`mode='game'` 下最近邻放大，不糊）、
   * 32 = 1 倍；48 是 1.5 倍（与鱼店货架同款折中）。
   */
  icon: number
  /** 图标区（hover 底色）边长：比图标大 8px，四周留 4px 让底色不贴着图标。 */
  surface: number
  /** 格子宽度 = 图标区边长（列宽固定，不随窗口拉伸）。 */
  cell: number
  /** 带 ID + 名称时的格高（大档 106 = 72 + 4 + ID 8 + 4 + 名称 16 + 2）。 */
  metaHeight: number
  /** 是否显示 ID / 名称：小尺寸不显示（32px 图标下两行字会把格子撑得又高又挤）。 */
  showMeta: boolean
  /** 列间距 */
  gapDesktop: number
  gapMobile: number
  /** 行间距（中 / 小档收紧，免得格子小、空得大） */
  gapY: number
}

/** 三档尺寸的唯一定义：图标 / 图标区 / 格子宽 / 间距都从这里取，别在别处再写一遍数字。 */
export const ITEM_SIZES: Record<ItemIconSize, ItemSizeSpec> = {
  lg: {
    icon: 64,
    surface: 72,
    cell: 72,
    metaHeight: 106,
    showMeta: true,
    gapDesktop: 16,
    gapMobile: 8,
    gapY: 16,
  },
  md: {
    icon: 48,
    surface: 56,
    cell: 56,
    metaHeight: 90,
    showMeta: true,
    gapDesktop: 12,
    gapMobile: 8,
    gapY: 12,
  },
  sm: {
    icon: 32,
    surface: 40,
    cell: 40,
    metaHeight: 40,
    showMeta: false,
    gapDesktop: 8,
    gapMobile: 8,
    gapY: 8,
  },
  // 横条：图标在左、`#ID` 与名称在右竖排（名称单行截断）。最小格宽 160（与鱼店一致），实际按容器平分后更宽。
  // 图标 / 底板与小档相同（32 / 40），格高 56 = 底板 40 + 上下各 8（与左右内边距、图标↔文字间距同一个 gap-2）。
  row: {
    icon: 32,
    surface: 40,
    cell: 160,
    metaHeight: 56,
    showMeta: true,
    gapDesktop: 8,
    gapMobile: 8,
    gapY: 8,
  },
}

/**
 * 横条格子：横向排布（图标左、文字右），所以不能复用 `CELL_CLASS` 的 `grid place-items-center`。
 * 其余反馈与竖排格子一致：整格微上浮、不铺整格底色。
 */
/** 横条格子的 hover 底色由 `ROW_PLATE_CLASS` 给（不能写 `hover:bg-transparent`，那会把底板盖成透明）。 */
const ROW_CELL_CLASS =
  'group/cell flex cursor-pointer items-center gap-2 p-2 text-left transition duration-150 hover:-translate-y-0.5 hover:text-foreground focus-visible:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring '

/** 兼容旧导入路径：大档图标框（= 游戏 `sizeLimit` 32 的 2 倍）。 */
export const ICON_SIZE = ITEM_SIZES.lg.icon

/**
 * 整块格子只负责 hover 上浮与焦点环；**底色只铺在图标区上**（与数据 ID 的 NPC 格子一致），
 * 平时没有底色。格子宽 / 图标区宽高由 `ITEM_SIZES` 给（内联 style），不再写死 `w-18`。
 */
export const CELL_CLASS =
  'group/cell grid cursor-pointer place-items-center gap-1 rounded-container transition duration-150 hover:-translate-y-0.5 hover:bg-transparent focus-visible:-translate-y-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring '
export const CELL_SELECTED = 'bg-primary/20'
/** 图标区（格子底板）：小档 / 横条垫底板，配色 / hover 都来自 `lib/iconGridSize` 的 `iconPlateClass`。 */
export const ICON_SURFACE_CLASS =
  'relative flex items-center justify-center transition'

/**
 * 单个格子：**点击整张卡片打开详情抽屉**；**图标区域悬停显示物品提示**。
 * 图标 / 格子尺寸由 `size`（大 / 中 / 小）决定，小档只显示图标。
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
  size = DEFAULT_ITEM_ICON_SIZE,
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
  /** 图标尺寸档位（小尺寸强制只显示图标，`showMeta=false`）。 */
  size?: ItemIconSize
  onSelect: (item: Item) => void
}) {
  const spec = ITEM_SIZES[size]
  const row = size === 'row'
  // 横条的意义就是带文字（开关在横条档下也隐藏了），所以忽略 `hideMeta`。
  const showMeta = row || (spec.showMeta && !hideMeta)
  const surface = (
    <span
      data-testid="dex-icon-surface"
      className={cn(ICON_SURFACE_CLASS, iconPlateClass(size))}
      style={{ width: spec.surface, height: spec.surface }}
    >
      {/* 横条档的提示挂在整条格子上（`RowTip`），图标自己就别再挂一个 */}
      <ItemIcon
        item={item}
        atlas={atlas}
        size={spec.icon}
        hideDetailLink
        tooltip={!row}
      />
    </span>
  )
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
      data-size={size}
      className={cn(
        row ? cn(ROW_CELL_CLASS, ROW_PLATE_CLASS) : CELL_CLASS,
        selected && CELL_SELECTED,
      )}
      style={{ width, height }}
    >
      {showMeta && row ? (
        <RowTip item={item} atlas={atlas} itemName={item.name} id={item.id} name={item.name}>
          {surface}
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
            <span className="font-pixel text-2xs leading-none text-muted-foreground">
              {item.id}
            </span>
            <span className="w-full truncate text-xs leading-4 text-foreground">{item.name}</span>
          </span>
        </RowTip>
      ) : (
        <>
          {surface}
          {showMeta && (
            <span className="font-pixel text-2xs leading-none text-muted-foreground">
              {item.id}
            </span>
          )}
          {showMeta && (
            <span className="w-full truncate text-center text-xs leading-4 text-foreground">
              {item.name}
            </span>
          )}
        </>
      )}
    </Button>
  )
})
