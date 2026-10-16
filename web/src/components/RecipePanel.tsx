import { useMemo } from 'react'
import { ArrowRight, Hammer } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { Badge } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { locText } from '@/lib/loc'
import { cn } from '@/lib/cn'
import type { Dataset, Recipe, RecipeIngredient } from '@/types'

const ENV_LABEL: Record<string, string> = {
  water: 'recipe.env.water',
  honey: 'recipe.env.honey',
  lava: 'recipe.env.lava',
  snow: 'recipe.env.snow',
  graveyard: 'recipe.env.graveyard',
  torchGod: 'recipe.env.torchGod',
  mechdusa: 'recipe.env.mechdusa',
}
const FLAG_LABEL: Record<string, string> = {
  crimson: 'recipe.flag.crimson',
  corruption: 'recipe.flag.corruption',
  notDecraftable: 'recipe.flag.notDecraftable',
}

function IngredientChip({
  ingredient,
  dataset,
}: {
  ingredient: RecipeIngredient
  dataset: Dataset
}) {
  const { t } = useI18n()
  const group = ingredient.group ? dataset.recipes.groups[ingredient.group] : undefined
  const groupName = group ? locText(dataset.loc, group.key) ?? group.key : undefined
  const item = dataset.itemsById.get(ingredient.id)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-card/70 px-2 py-1">
      <ItemIcon item={item} atlas={dataset.atlas} size={24} />
      <span className="text-sm text-foreground/90">
        {group ? t('recipe.groupAny', { name: groupName ?? group.key }) : item?.name ?? `#${ingredient.id}`}
      </span>
      {ingredient.stack > 1 ? (
        <span className="font-pixel text-xs text-muted-foreground">x{ingredient.stack}</span>
      ) : null}
    </span>
  )
}

function Station({ recipe, dataset }: { recipe: Recipe; dataset: Dataset }) {
  const { t } = useI18n()
  if (recipe.station < 0) {
    return <span className="text-sm text-muted-foreground">{t('recipe.hand')}</span>
  }
  const items = recipe.stationItems
    .map((id) => dataset.itemsById.get(id))
    .filter((it): it is NonNullable<typeof it> => Boolean(it))
  if (items.length === 0) {
    return <span className="text-sm text-muted-foreground">{t('recipe.station', { id: recipe.station })}</span>
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {items.slice(0, 2).map((item) => (
        <ItemIcon key={item.id} item={item} atlas={dataset.atlas} size={24} />
      ))}
      <span className="text-sm text-foreground/90">{items[0].name}</span>
    </span>
  )
}

function RecipeRow({ recipe, dataset }: { recipe: Recipe; dataset: Dataset }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-accent/40 px-2.5 py-2">
      <span className="flex flex-wrap items-center gap-1">
        {recipe.ingredients.map((ing, i) => (
          <IngredientChip key={i} ingredient={ing} dataset={dataset} />
        ))}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="inline-flex items-center gap-1">
        <ItemIcon
          item={dataset.itemsById.get(recipe.result.id)}
          atlas={dataset.atlas}
          size={24}
          stack={recipe.result.stack}
        />
        <span className="text-sm font-medium text-foreground">
          {dataset.itemsById.get(recipe.result.id)?.name ?? `#${recipe.result.id}`}
        </span>
      </span>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Hammer className="size-4 text-muted-foreground" />
        <Station recipe={recipe} dataset={dataset} />
      </span>
      {(recipe.env?.length || recipe.flags?.length) && (
        <span className="flex w-full flex-wrap gap-1">
          {recipe.env?.map((e) => (
            <Badge key={e}>{ENV_LABEL[e] ? t(ENV_LABEL[e]) : e}</Badge>
          ))}
          {recipe.flags?.map((f) => (
            <Badge key={f} tone="accent">
              {FLAG_LABEL[f] ? t(FLAG_LABEL[f]) : f}
            </Badge>
          ))}
        </span>
      )}
    </div>
  )
}

const MAX_ROWS = 60

/**
 * 合成表面板：本地数据渲染「怎么合成」+「能合成什么」，
 * 不依赖登录与 `/r` 指令（数据见 tools/gen-recipes.mjs / data/recipes.json）。
 */
export function RecipePanel({ itemId, dataset }: { itemId: number; dataset: Dataset }) {
  const { t } = useI18n()
  const make = useMemo(
    () => (dataset.recipes.byResult[String(itemId)] ?? []).map((i) => dataset.recipes.recipes[i]),
    [dataset.recipes, itemId],
  )
  const use = useMemo(
    () => (dataset.recipes.byIngredient[String(itemId)] ?? []).map((i) => dataset.recipes.recipes[i]),
    [dataset.recipes, itemId],
  )

  if (make.length === 0 && use.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">{t('recipe.none')}</p>
  }

  const section = (titleKey: string, rows: Recipe[], tone: string) => (
    <div className="flex flex-col gap-1">
      <p className={cn('text-sm font-medium', tone)}>{t(titleKey, { n: rows.length })}</p>
      <div className="flex flex-col gap-1">
        {rows.slice(0, MAX_ROWS).map((r, i) => (
          <RecipeRow key={i} recipe={r} dataset={dataset} />
        ))}
        {rows.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">
            {t('recipe.more', { n: rows.length - MAX_ROWS })}
          </p>
        )}
      </div>
    </div>
  )

  return (
    <div className="mt-3 flex flex-col gap-3">
      {make.length > 0 && section('recipe.make', make, 'text-success')}
      {use.length > 0 && section('recipe.use', use, 'text-warning')}
    </div>
  )
}
