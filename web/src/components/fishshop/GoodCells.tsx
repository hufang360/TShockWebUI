import { ItemIcon } from '@/components/ItemIcon'
import { Button } from '@/components/ui'
import { parseRichText } from '@/lib/richtext'
import type { FishGood } from '@/lib/tshock'
import type { Dataset, Item } from '@/types'

/**
 * 鱼店商品格子 / 图标与相关解析（从 `FishShopPage` 抽出，见 docs/TODO.md U6）。
 * 纯展示 + 纯函数：不持有页面状态。
 */

/** 网格格子统一图标尺寸：**64×64**（= 游戏 `sizeLimit` 32 的 2 倍，`mode='game'` 下整数倍最近邻放大）。 */
export const CELL_ICON_SIZE = 64

/** 格子宽 / 图标区宽：**72**（`w-18`），沿用「物品 ID」的格子尺寸。 */
export const CELL_WIDTH = 72

/**
 * 货架网格：列宽固定 72px（不拉伸撑满），间距 `gap-2`。
 * 与「物品 ID」的 `grid-cols-[repeat(auto-fill,4.5rem)]` 用法一致，只是间距取 8px。
 */
export const GOOD_GRID = 'grid grid-cols-[repeat(auto-fill,4.5rem)] gap-2'

/**
 * 格子本体：固定 72 宽，hover 只上浮、**不铺整格底色**（底色由图标区自己给）。
 * 高度跟随内容：尺寸变体自带 `md:h-9`（媒体查询变体在后），只写 `h-auto` 在 ≥md 会被它盖回去，
 * 格子被锁成 36px 高、图标与名称溢出压到下一行（整片商品互相重叠）。所以 `h-auto` 要连 `md:h-auto` 一起写。
 */
const CELL_CLASS =
  'group/cell grid h-auto w-18 cursor-pointer place-items-center gap-1 rounded-xl px-0 py-0 font-normal transition duration-150 hover:-translate-y-0.5 hover:bg-transparent hover:text-foreground focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:h-auto'

/** 图标区：默认无底色，72×72（内置 64px 图标）；hover / 键盘聚焦时才铺 `bg-primary/10`（与物品 / NPC 格子一致）。 */
const ICON_SURFACE_CLASS =
  'relative flex size-18 items-center justify-center rounded-lg transition-colors group-hover/cell:bg-primary/10 group-focus-visible/cell:bg-primary/10'

interface GoodItemTag {
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
 */
function goodIcon(good: FishGood): GoodItemTag | null {
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
}: {
  good: FishGood
  dataset: Dataset | null
  onSelect: (good: FishGood) => void
}) {
  const prefixName = goodPrefixName(good, dataset)
  return (
    <Button
      variant="ghost"
      onClick={() => onSelect(good)}
      aria-label={good.name}
      className={CELL_CLASS}
    >
      <span data-testid="good-icon-surface" className={ICON_SURFACE_CLASS}>
        <GoodThumb good={good} dataset={dataset} size={CELL_ICON_SIZE} />
      </span>
      <span className="w-full truncate font-pixel text-2xs leading-none text-muted-foreground">
        #{good.serial}
      </span>
      <span className="w-full truncate text-center text-xs leading-4 text-foreground">
        {prefixName ? <span className="text-warning">{prefixName} </span> : null}
        {good.name}
      </span>
    </Button>
  )
}

/**
 * 商品图标：有物品标签用图集图标，否则用名称首字占位。
 * 只有**原生物品**（`desc` 带 `[i:..]`）悬停才显示物品提示；借来的识别图不显示。
 */
export function GoodThumb({
  good,
  dataset,
  size,
}: {
  good: FishGood
  dataset: Dataset | null
  size: number
}) {
  const icon = goodIcon(good)
  const item: Item | undefined = icon ? dataset?.itemsById.get(icon.itemId) : undefined
  if (item) {
    return (
      <ItemIcon
        item={item}
        atlas={dataset?.atlas}
        size={size}
        stack={icon?.stack}
        prefix={goodPrefixName(good, dataset)}
        tooltip={goodIsNativeItem(good)}
      />
    )
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg bg-accent/60 text-sm text-foreground"
      style={{ width: size, height: size }}
    >
      {good.name.slice(0, 1) || '?'}
    </span>
  )
}
