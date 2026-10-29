import { useState } from 'react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { ItemIcon } from '@/components/ItemIcon'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'
import type { Dataset } from '@/types'

/** 掉落率按 Wiki 风格呈现：右大的显示 `≈1/N`（更直观），常见掉落回退百分比。 */
function formatRate(chance: number): string {
  if (!Number.isFinite(chance) || chance <= 0) return ''
  if (chance >= 0.5) return `${Math.round(chance * 100)}%`
  return `≈1/${Math.max(2, Math.round(1 / chance))}`
}

/**
 * 可开启物品（木匣等）的「掉落」分区：物品 + 数量范围 + 概率。
 *
 * 数据见 `data/item-drops.json`（gamedump 用**运行时模拟** `Player.OpenFishingCrate()`
 * 测出的概率，不是源码里的分数——所以底部标注了模拟次数）。
 */
export function ItemDropsPanel({
  itemId,
  dataset,
  iconOnly = false,
  twoColumn = false,
}: {
  itemId: number
  dataset: Dataset
  iconOnly?: boolean
  /** 固定两列显示掉落记录（与合成表同一个勾选框）。 */
  twoColumn?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  const drops = dataset.itemDropsById?.get(itemId)
  if (!drops || drops.length === 0) return null
  // 概率/模拟次数都是可选的：数据缺字段时就不显示，不让它把详情搞崩。
  const trials = dataset.itemDrops?.meta?.trials
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3 flex flex-col gap-1">
      <CollapsibleTrigger className="group/title flex w-full cursor-pointer items-center gap-1.5 text-sm font-medium">
        <ItemIcon
          item={dataset.itemsById.get(itemId)}
          atlas={dataset.atlas}
          size={20}
          tooltip={false}
        />
        <span className="text-info truncate">{t('drops.title', { n: drops.length })}</span>
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className={cn(
            'grid gap-1',
            // 与合成表一致：小屏（<sm）即使勾选两列也按单列排。
            twoColumn ? 'grid-cols-2 max-sm:grid-cols-1' : 'grid-cols-1',
          )}
        >
          {drops.map((drop) => {
            const item = dataset.itemsById.get(drop.id)
            const stack =
              drop.minStack === drop.maxStack ? String(drop.minStack) : `${drop.minStack}~${drop.maxStack}`
            const rowClass =
              'flex min-w-0 items-center gap-2 rounded-lg bg-accent/40 px-2.5 py-2'
            const body = (
              <>
                <ItemIcon item={item} atlas={dataset.atlas} size={24} />
                {!iconOnly && (
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                    {item?.name ?? `#${drop.id}`}
                  </span>
                )}
                <span className="font-pixel shrink-0 text-xs text-muted-foreground tabular-nums">
                  {stack}
                </span>
                {Number.isFinite(drop.chance) && (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatRate(drop.chance)}
                  </span>
                )}
              </>
            )
            // 小图标/条目本身不可点：要看详情就悬停出提示，点提示底部的「合成表」。
            return (
              <div key={drop.id} className={rowClass}>
                {body}
              </div>
            )
          })}
        </div>
        {Number.isFinite(trials) && (trials ?? 0) > 0 && (
          <p className={cn('mt-1 text-xs text-muted-foreground')}>
            {t('drops.note', { n: trials as number })}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
