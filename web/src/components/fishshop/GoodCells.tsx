import { ItemIcon } from '@/components/ItemIcon'
import { Button } from '@/components/ui'
import { parseRichText } from '@/lib/richtext'
import type { FishGood } from '@/lib/tshock'
import type { Dataset, Item } from '@/types'

/**
 * 鱼店商品格子 / 图标与相关解析（从 `FishShopPage` 抽出，见 docs/TODO.md U6）。
 * 纯展示 + 纯函数：不持有页面状态。
 */

/** 网格格子统一图标尺寸。 */
export const CELL_ICON_SIZE = 64

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

/** 商品对应的物品标签：优先 `icon` 字段，其次 `desc`。 */
function goodIcon(good: FishGood): GoodItemTag | null {
  return firstItemTag(good.icon) ?? firstItemTag(good.desc)
}

/** 商品里物品的词缀名（若有）；用于提示与名称前的词缀显示。 */
export function goodPrefixName(good: FishGood, dataset: Dataset | null): string | undefined {
  const icon = goodIcon(good)
  return icon?.prefix != null ? dataset?.prefixesById.get(icon.prefix)?.name : undefined
}

/** 网格格子：图标 + 名称 + 编号。图标取自 icon 字段（其次 desc 的 [i:..] 标签）。 */
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
      className="grid h-auto cursor-pointer place-items-center gap-1 rounded-xl px-1.5 py-1.5 font-normal hover:-translate-y-0.5 hover:bg-primary/10"
    >
      <GoodThumb good={good} dataset={dataset} size={CELL_ICON_SIZE} />
      <span className="w-full truncate text-center text-xs leading-4 text-foreground">
        {prefixName ? <span className="text-warning">{prefixName} </span> : null}
        {good.name}
      </span>
      <span className="font-pixel text-2xs leading-none text-muted-foreground">#{good.serial}</span>
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
