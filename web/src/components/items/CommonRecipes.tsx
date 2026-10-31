import { useMemo } from 'react'
import { RecipeRow } from '@/components/RecipePanel'
import { Empty, EmptyDescription } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import type { Dataset, Item, Recipe } from '@/types'

/** 一件常用物品 + 它的合成记录（`byResult`）与用途（`byIngredient`）。 */
export interface CommonRecipeEntry {
  id: number
  item: Item
  /** 怎么合成它。 */
  make: Recipe[]
  /** 它用于合成什么（材料视角）。 */
  use: Recipe[]
}

/**
 * 「收藏 → 常用」：常用合成表 —— **直接把合成记录一条条列出来**（不分物品分组、
 * 不加「用于合成」小标题）：清单见 `lib/commonRecipes.ts`。
 *
 * 顺序 = 清单顺序：每件物品先「怎么造它」（`byResult`）再「它能造什么」（`byIngredient`）。
 * 条目行与图鉴详情里的完全一致（`RecipeRow`，hover 可 ⭐ 收藏 / 复制）。
 */
export function CommonRecipes({
  dataset,
  entries,
  iconOnly,
  twoColumn,
}: {
  dataset: Dataset
  entries: CommonRecipeEntry[]
  /** 只显示图标（页面设置「显示物品名称」没勾时）。 */
  iconOnly: boolean
  /** 两列（页面设置「两列视图-收藏页」）。 */
  twoColumn: boolean
}) {
  const { t } = useI18n()
  // 平铺：同一件物品的 make 在前、use 在后，整体按清单顺序。
  const rows = useMemo(() => entries.flatMap((e) => [...e.make, ...e.use]), [entries])

  if (rows.length === 0) {
    return (
      <Empty className="min-h-40 border border-dashed">
        <EmptyDescription>{t('dex.noMatch')}</EmptyDescription>
      </Empty>
    )
  }

  return (
    <div
      data-testid="common-recipes"
      className={cn(
        // `p-1`：条目 hover 的浮起 / 聚焦光圈画在行外，不留内边距会被裁掉。
        'grid gap-1 p-1',
        twoColumn ? 'grid-cols-2 max-sm:grid-cols-1' : 'grid-cols-1',
      )}
    >
      {rows.map((recipe, i) => (
        <RecipeRow
          key={i}
          recipe={recipe}
          dataset={dataset}
          iconOnly={iconOnly}
          copyTags={false}
        />
      ))}
    </div>
  )
}
