import { useCallback, useMemo } from 'react'
import { Star } from 'lucide-react'
import { RecipeRow, ReverseRecipeRow } from '@/components/RecipePanel'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { findFavoriteRecipe, recipeFavoriteKey } from '@/lib/recipeFavorites'
import { recipeToChatText, reverseRecipeToChatText } from '@/lib/recipeText'
import type { Dataset, RecipeFavorite } from '@/types'

/**
 * 收藏的合成记录列表：按收藏时间倒序，原样渲染成合成表条目。
 *
 * 用到的两处：「指令 → 收藏 → 合成表」与「物品图鉴 → ⭐ 收藏 → 合成表」。
 * 条目与图鉴详情里是**同一个组件**（`RecipeRow` / `ReverseRecipeRow`）：hover 右上角就是
 * 「⭐ 收藏 / 复制」，点 ⭐ 即就地取消收藏，不再另做逐行删除。
 * 数据重新生成后找不到的那条直接跳过（不显示错的配方），但收藏记录保留——数据回滚还能对上。
 */
export function FavoriteRecipesPanel({
  dataset,
  favorites,
  onPick,
  iconOnly = false,
  twoColumn = false,
  className,
}: {
  dataset: Dataset
  favorites: RecipeFavorite[]
  /**
   * 点整行时调用：回传这条记录的**带 `[i:ID]` 标签**的文本（聊天输入框用）。
   * 不传则行不可点（图鉴里只是浏览）。
   */
  onPick?: (text: string) => void
  /** 只显示图标（图鉴的「显示物品名称」没勾时）。 */
  iconOnly?: boolean
  /** 两列（图鉴的「两列视图」勾了之后）。 */
  twoColumn?: boolean
  className?: string
}) {
  const { t } = useI18n()
  /** 点行时交给调用方的文本：`[i:1][i:2] @ [i:31] -> [i:296]`（聊天里只认标签）。 */
  const pickText = useCallback(
    (recipe: Parameters<typeof recipeToChatText>[0], reverse: boolean) =>
      reverse
        ? reverseRecipeToChatText(recipe, recipe.result.id)
        : recipeToChatText(recipe),
    [],
  )
  const rows = useMemo(
    () =>
      [...favorites]
        .sort((a, b) => b.ts - a.ts) // 最近收藏的在最上面
        .map((f) => findFavoriteRecipe(dataset, f.key))
        .filter((r): r is NonNullable<typeof r> => r != null),
    [dataset, favorites],
  )

  if (favorites.length === 0) {
    return (
      <Empty className="min-h-40 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Star />
          </EmptyMedia>
          <EmptyTitle>{t('favorites.recipesEmpty')}</EmptyTitle>
          <EmptyDescription>{t('favorites.recipesEmptyHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2', className)}>
      {/* 内边距 `p-1`：条目 hover 的浮起 / 聚焦光圈画在行外，贴着滚动区边会被裁掉。 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.length === 0 ? (
          <Empty size="sm" className="p-3">
            <EmptyDescription>{t('favorites.recipesStale')}</EmptyDescription>
          </Empty>
        ) : (
          <div className={cn('grid gap-1', twoColumn ? 'grid-cols-2 max-sm:grid-cols-1' : 'grid-cols-1')}>
            {rows.map(({ recipe, reverse }) =>
              reverse ? (
                <ReverseRecipeRow
                  key={recipeFavoriteKey(recipe, true)}
                  recipe={recipe}
                  itemId={recipe.result.id}
                  dataset={dataset}
                  iconOnly={iconOnly}
                  copyTags={false}
                  onPick={onPick ? () => onPick(pickText(recipe, true)) : undefined}
                  pickLabel={t('recipe.pickHint')}
                />
              ) : (
                <RecipeRow
                  key={recipeFavoriteKey(recipe)}
                  recipe={recipe}
                  dataset={dataset}
                  iconOnly={iconOnly}
                  copyTags={false}
                  onPick={onPick ? () => onPick(pickText(recipe, false)) : undefined}
                  pickLabel={t('recipe.pickHint')}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  )
}
