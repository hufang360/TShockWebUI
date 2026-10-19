import { ItemIcon } from '@/components/ItemIcon'
import { useItemTooltip } from '@/components/ItemTooltip'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Dataset, Item } from '@/types'

/** 图标框统一 **64×64**（= 游戏 `sizeLimit` 32 的 2 倍）→ `mode='game'` 下是整数 2× 最近邻放大，不糊。 */
export const ICON_SIZE = 64

/** 格子：无底色（不铺白底），hover / 选中用主题色加深，hover 时整体上移一点。 */
export const CELL_CLASS =
  'grid cursor-pointer place-items-center gap-1 rounded-xl px-1.5 py-1.5 transition duration-150 hover:-translate-y-0.5 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
export const CELL_SELECTED = 'bg-primary/20'

/** 单个格子：提示绑在**整张卡片**上（不只是图标画框），提示样式与别处完全一致。 */
export function DexCell({
  item,
  dataset,
  selected,
  width,
  height,
  onSelect,
}: {
  item: Item
  dataset: Dataset
  selected: boolean
  width: number
  height: number
  onSelect: (item: Item) => void
}) {
  const { ref, props, node } = useItemTooltip<HTMLButtonElement>({
    item,
    atlas: dataset.atlas,
    stat: dataset.itemStats.items[String(item.id)],
  })
  return (
    <>
      <Button
        variant="ghost"
        aria-label={item.name}
        aria-pressed={selected}
        onClick={() => onSelect(item)}
        ref={ref}
        {...props}
        className={cn(CELL_CLASS, selected && CELL_SELECTED)}
        style={{ width, height }}
      >
        <ItemIcon item={item} atlas={dataset.atlas} size={ICON_SIZE} tooltip={false} />
        <span className="font-pixel text-2xs leading-none text-muted-foreground">{item.id}</span>
        <span className="w-full truncate text-center text-xs leading-4 text-foreground">
          {item.name}
        </span>
      </Button>
      {node}
    </>
  )
}
