import type { CSSProperties } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { cn } from '@/lib/cn'
import { rarityColor } from '@/lib/items'
import type { Atlas, Item, ItemStatEntry } from '@/types'

/**
 * 游戏同款物品提示（**全项目唯一的一套样式**：图标 28px / 名称 15px semibold / 属性行 14px / 页脚 12px）。
 *
 * 事实来源：`Terraria.Main.MouseText_DrawItemTooltip_GetLinesInfo`（属性行文本由 tools/gen-item-stats.mjs 生成）；
 * 底色为半透明黑 `bg-black/85`（**不加模糊**），左下角固定显示 `ID · key`。
 */
interface ItemTooltipContentProps {
  item: Item
  atlas?: Atlas
  stat?: ItemStatEntry
  prefix?: string | null
  stack?: number
  /** 覆盖显示名（默认 item.name）。 */
  name?: string
  /** tooltip：深色浮层（默认）；panel：浅色内联区域（详情页可复用）。 */
  variant?: 'tooltip' | 'panel'
  /** 隐藏顶部「图标 + 名称」行（只留属性行 + ID · key 时用）。 */
  hideHeader?: boolean
  /** 额外类名（如抽屉/详情里改为通栏：`w-full max-w-none`）。 */
  className?: string
  style?: CSSProperties
}

export function ItemTooltipContent({
  item,
  atlas,
  stat,
  prefix,
  stack,
  name,
  variant = 'tooltip',
  hideHeader = false,
  className,
  style,
}: ItemTooltipContentProps) {
  // tip 行在载入数据集时已按当前界面语言解析好。
  const lines = stat?.tip ?? []
  const rare = typeof stat?.stats?.rare === 'number' ? stat.stats.rare : 0
  const showStack = stack != null && stack > 1

  if (variant === 'panel') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ItemIcon item={item} atlas={atlas} size={28} tooltip={false} />
          <span className="text-[15px] font-semibold" style={{ color: rarityColor(rare) }}>
            {prefix ? <span className="text-amber-300">{prefix} </span> : null}
            {name ?? item.name}
          </span>
          {showStack ? (
            <span className="font-pixel text-sm text-muted-foreground">x{stack}</span>
          ) : null}
        </div>
        {lines.length > 0 && (
          <div className="flex flex-col gap-0.5 text-sm leading-5 text-foreground/80">
            {lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
        <IdKeyFooter item={item} className="text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      data-testid="item-tooltip"
      className={cn(
        // 半透明黑（**不加模糊**：与游戏一样是纯半透明，紧跟在物品旁边时不会把背景完全挖掉）
        'max-w-96 rounded-md border border-white/15 bg-black/85 px-3 py-2.5 text-[15px] font-medium text-zinc-100 shadow-xl',
        className,
      )}
      style={style}
    >
      {!hideHeader && (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <ItemIcon item={item} atlas={atlas} size={28} tooltip={false} />
          {prefix ? <span className="text-amber-300">{prefix}</span> : null}
          <span className="text-[15px] leading-6 font-semibold" style={{ color: rarityColor(rare) }}>
            {name ?? item.name}
          </span>
          {showStack ? <span className="font-pixel text-sm font-bold text-zinc-300">x{stack}</span> : null}
        </div>
      )}
      {lines.length > 0 && (
        <div
          className={cn(
            'flex flex-col gap-0.5 text-sm leading-5 text-zinc-300',
            !hideHeader && 'mt-1.5 border-t border-white/10 pt-1.5',
          )}
        >
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <IdKeyFooter item={item} className="text-zinc-400/90" />
    </div>
  )
}

/** 所有物品提示的左下角都显示「ID · key」（如 `2665 · GreenDungeonCandelabra`）。 */
function IdKeyFooter({ item, className }: { item: Item; className?: string }) {
  return (
    <p className={cn('mt-1 font-pixel text-xs tracking-wide break-all', className)}>
      {item.id} · {item.key}
    </p>
  )
}
