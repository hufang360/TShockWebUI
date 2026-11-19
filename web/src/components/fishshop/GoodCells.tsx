import { ItemIcon } from '@/components/ItemIcon'
import { SlotTooltip } from '@/components/SlotTooltip'
import { Button } from '@/components/ui'
import { parseRichText } from '@/lib/richtext'
import { RowTip } from '@/components/RowTip'
import { cn } from '@/lib/cn'
import { iconPlateClass, ROW_PLATE_CLASS, type IconGridSize } from '@/lib/iconGridSize'
import type { FishGood } from '@/lib/tshock'
import type { Dataset, Item } from '@/types'

/**
 * 鱼店商品格子 / 图标与相关解析（从 `FishShopPage` 抽出，见 docs/TODO.md U6）。
 * 纯展示 + 纯函数：不持有页面状态。
 */

/** 大号图标尺寸：**64×64**（= 游戏 `sizeLimit` 32 的 2 倍，`mode='game'` 下整数倍最近邻放大）。 */
export const CELL_ICON_SIZE = 64

/** 图标尺寸档位（页面设置「图标大小」：小 / 中 / 大）；档位名与「小档底色」等共用规则在 `lib/iconGridSize`。 */
export type GoodIconSize = IconGridSize

/** 鱼店默认「横条」：商品名都比较长，横排（图标 + 编号 + 名称）一眼能认全，也一屏能看更多件。 */
export const DEFAULT_GOOD_ICON_SIZE: GoodIconSize = 'row'

interface GoodSizeSpec {
  /** 图标边长：32 / 48 / 64，都是游戏 `sizeLimit` 32 的整数倍，放大不糊。 */
  icon: number
  /** 图标区（hover 底色）边长：比图标大 8px，四周留 4px 让底色不贴着图标。 */
  surface: number
  /** 格子宽度：与图标区同宽（列宽固定，不随窗口拉伸）。 */
  cell: number
  /** 是否显示 `#编号` 与名称：**小尺寸不显示**（32px 图标下两行字会把格子撑得又高又挤）。 */
  showMeta: boolean
}

/** 三档尺寸的唯一定义：图标 / 图标区 / 格子宽都从这里取，别在别处再写一遍数字。 */
export const GOOD_SIZES: Record<GoodIconSize, GoodSizeSpec> = {
  lg: { icon: CELL_ICON_SIZE, surface: 72, cell: 72, showMeta: true },
  md: { icon: 48, surface: 56, cell: 56, showMeta: true },
  sm: { icon: 32, surface: 40, cell: 40, showMeta: false },
  // 横条：图标在左、`#编号` 与名称在右竖排（名称单行截断）。图标 / 底板与小档一致，
  // 最小格宽 160 ≈ 8 个中文字（鱼店商品名普遍比物品 ID 长一截，比物品 ID / 数据 ID 的 120 更宽）。
  row: { icon: 32, surface: 40, cell: 160, showMeta: true },
}

/**
 * 货架网格：列宽固定 = 格子宽度（`auto-fill`，不拉伸撑满）；
 * `relative` 是给货架线那一层（`GoodGrid` 里绝对定位的子元素）当定位基准。
 * 间距（用户定）：大 = 列 16px / 行 24px，中 = 列 8px / 行 16px，小 / 横条 = 双向 8px。
 * 中 / 大的行距放宽是为了让「货架板」（`GoodGrid` + `.fish-shelf`）压在序号行上之后，
 * 名称下面还有呼吸空间，不会跟下一行的图标挤在一起。
 */
export const GOOD_GRID_CLASS: Record<GoodIconSize, string> = {
  lg: 'relative grid grid-cols-[repeat(auto-fill,4.5rem)] gap-x-4 gap-y-6',
  md: 'relative grid grid-cols-[repeat(auto-fill,3.5rem)] gap-x-2 gap-y-4',
  sm: 'relative grid grid-cols-[repeat(auto-fill,2.5rem)] gap-2',
  row: 'relative grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2',
}

/**
 * 格子本体：宽度由尺寸档位给（内联 style，见 `GOOD_SIZES`），hover 只上浮、**不铺整格底色**（底色由图标区自己给）。
 * 高度跟随内容：尺寸变体自带 `md:h-9`（媒体查询变体在后），只写 `h-auto` 在 ≥md 会被它盖回去，
 * 格子被锁成 36px 高、图标与名称溢出压到下一行（整片商品互相重叠）。所以 `h-auto` 要连 `md:h-auto` 一起写。
 */
const CELL_CLASS =
  'group/cell grid h-auto cursor-pointer place-items-center gap-1 rounded-container px-0 py-0 font-normal transition duration-150 hover:-translate-y-0.5 hover:bg-transparent hover:text-foreground focus-visible:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-auto'

/** 横条格子：横向排布（图标左、文字右），四边内边距 8px = 图标↔文字间距 = 行高与底板之差（56 vs 40）。 */
const ROW_CELL_CLASS =
  'group/cell flex h-14 cursor-pointer items-center gap-2 p-2 font-normal text-left transition duration-150 hover:-translate-y-0.5 hover:text-foreground focus-visible:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-14'

/** 图标区（格子底板）：底色 / 描边与 hover 提亮都来自 `lib/iconGridSize` 的试用配色。 */
const ICON_SURFACE_CLASS = 'relative flex items-center justify-center transition'

export interface GoodItemTag {
  itemId: number
  stack?: number
  prefix?: number
}

/** 解析一段富文本里的第一个 `[i:..]` 标签。 */
function firstItemTag(source: string | undefined): GoodItemTag | null {
  if (!source) return null
  for (const token of parseRichText(source)) {
    if (token.kind === 'item') {
      return { itemId: token.itemId, stack: token.stack, prefix: token.prefixId }
    }
  }
  return null
}

/** 是否**原生物品**（`desc` 带 `[i:..]`），决定悬停是否显示物品提示。 */
function goodIsNativeItem(good: FishGood): boolean {
  return firstItemTag(good.desc) !== null
}

/**
 * 商品对应的物品标签：优先 `icon` 字段，其次插件的 `iconId`，最后 `desc`。
 * `iconId` 是插件给的结构化图标 id（`0` = 没配图标），不用解析 `[i:..]` 字符串。
 *
 * 导出给「广告到游戏内」用：那个功能也要商户图标标签里的词缀 / 数量。
 */
export function goodIcon(good: FishGood): GoodItemTag | null {
  const tag = firstItemTag(good.icon) ?? firstItemTag(good.desc)
  if (tag) return tag
  return good.iconId ? { itemId: good.iconId } : null
}

/** 商品里物品的词缀名（若有）；用于提示与名称前的词缀显示。 */
export function goodPrefixName(good: FishGood, dataset: Dataset | null): string | undefined {
  const icon = goodIcon(good)
  return icon?.prefix != null ? dataset?.prefixesById.get(icon.prefix)?.name : undefined
}

/** 网格格子：图标 + 编号 + 名称。图标取自 icon 字段（其次 desc 的 [i:..] 标签）。 */
export function GoodCell({
  good,
  dataset,
  onSelect,
  size = DEFAULT_GOOD_ICON_SIZE,
  hideMeta = false,
}: {
  good: FishGood
  dataset: Dataset | null
  onSelect: (good: FishGood) => void
  /** 图标尺寸档位（小 / 中 / 大）。 */
  size?: GoodIconSize
  /** 只显示图标（「页面设置 → 隐藏编号和名称」，与物品 ID 的同一开关同义）。 */
  hideMeta?: boolean
}) {
  const prefixName = goodPrefixName(good, dataset)
  const iconTag = goodIcon(good)
  const item = iconTag ? dataset?.itemsById.get(iconTag.itemId) : undefined
  const spec = GOOD_SIZES[size]
  const row = size === 'row'
  // 小尺寸本来就只放图标；横条的意义就是带文字（开关也隐藏了），所以忽略 hideMeta。
  const showMeta = row || (spec.showMeta && !hideMeta)
  return (
    <Button
      variant="ghost"
      onClick={() => onSelect(good)}
      aria-label={good.name}
      data-size={size}
      className={row ? cn(ROW_CELL_CLASS, ROW_PLATE_CLASS) : CELL_CLASS}
      // 横条平分整行宽度：格子填满 1fr 轨道，别再写死格宽
      style={{ width: row ? '100%' : spec.cell }}
    >
      {row ? (
        // 横条：提示锚点放在整条格子上（图标只占左边一小块，挂在图标上等于没有提示）
        <RowTip
          item={item}
          atlas={dataset?.atlas}
          itemName={good.name}
          prefix={prefixName}
          prefixId={iconTag?.prefix}
          stack={iconTag?.stack}
          id={good.serial}
          name={good.name}
        >
          <span
            data-testid="good-icon-surface"
            className={cn(ICON_SURFACE_CLASS, iconPlateClass(size))}
            style={{ width: spec.surface, height: spec.surface }}
          >
            <GoodThumb good={good} dataset={dataset} size={spec.icon} silent />
          </span>
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
            <span className="font-pixel text-2xs leading-none text-muted-foreground">
              #{good.serial}
            </span>
            <span className="w-full truncate text-xs leading-4 text-foreground">
              {prefixName ? <span className="text-warning">{prefixName} </span> : null}
              {good.name}
            </span>
          </span>
        </RowTip>
      ) : (
        <>
          <span
            data-testid="good-icon-surface"
            className={cn(ICON_SURFACE_CLASS, iconPlateClass(size))}
            style={{ width: spec.surface, height: spec.surface }}
          >
            <GoodThumb good={good} dataset={dataset} size={spec.icon} />
          </span>
          {showMeta && (
            <>
              <span className="w-full truncate font-pixel text-2xs leading-none text-muted-foreground">
                #{good.serial}
              </span>
              <span className="w-full truncate text-center text-xs leading-4 text-foreground">
                {prefixName ? <span className="text-warning">{prefixName} </span> : null}
                {good.name}
              </span>
            </>
          )}
        </>
      )}
    </Button>
  )
}

/**
 * 商品图标：有物品标签用图集图标，否则用名称首字占位。
 *
 * 悬停提示分两种：
 * - **原生物品**（`desc` 带 `[i:..]`）：用 `ItemIcon` 自带的物品提示（图标 + 词缀 + 名称 + 数量）；
 * - **非原生物品 / 服务类**：`icon` / `iconId` 只是**借来的识别图**（鱼池借水桶、钓棚借图鉴），
 *   弹出物品属性会让人以为买的就是那件东西。这种情况改成一句「`#编号` + 商品名」。
 */
export function GoodThumb({
  good,
  dataset,
  size,
  tooltip = true,
  silent = false,
}: {
  good: FishGood
  dataset: Dataset | null
  size: number
  /** 关掉「编号 + 商品名」提示（详情页图标下方已经写着编号和名称时用）。 */
  tooltip?: boolean
  /** 提示由外层负责（横条档把锚点放在整条格子上，见 `components/RowTip`）。 */
  silent?: boolean
}) {
  const icon = goodIcon(good)
  const item: Item | undefined = icon ? dataset?.itemsById.get(icon.itemId) : undefined
  const native = item !== undefined && goodIsNativeItem(good)
  const thumb = item ? (
    <ItemIcon
      item={item}
      atlas={dataset?.atlas}
      size={size}
      stack={icon?.stack}
      prefix={goodPrefixName(good, dataset)}
      prefixId={icon?.prefix}
      tooltip={native && !silent}
    />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-control bg-accent/60 text-sm text-foreground"
      style={{ width: size, height: size }}
    >
      {good.name.slice(0, 1) || '?'}
    </span>
  )
  if (silent || native || !tooltip) return thumb
  return (
    <SlotTooltip
      label={
        <>
          {/* 编号用像素字体（与格子里那行 `#编号` 同一号），名称用正文字号 */}
          <span className="block font-pixel text-2xs opacity-70">#{good.serial}</span>
          <span className="block font-semibold">{good.name}</span>
        </>
      }
    >
      {/* Tooltip 的触发器必须是单个元素：包一层与图标同尺寸的方框，不改变原来的排版 */}
      <span
        data-testid="good-tooltip"
        className="inline-flex shrink-0 align-middle"
        style={{ width: size, height: size }}
      >
        {thumb}
      </span>
    </SlotTooltip>
  )
}
