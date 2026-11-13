import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Copy, Star } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { DetailSection } from '@/components/DetailSection'
import { ItemIcon } from '@/components/ItemIcon'
import { Badge, Button } from '@/components/ui'
import { copyText } from '@/lib/clipboard'
import { useI18n } from '@/lib/i18n'
import { locText } from '@/lib/loc'
import { cn } from '@/lib/cn'
import { recipeFavoriteKey } from '@/lib/recipeFavorites'
import { RECIPE_SECTION_TONE } from '@/lib/sectionTones'
import { useRecipeFavorites } from '@/lib/recipeFavoritesContext'
import {
  ENV_ICON,
  ENV_LABEL,
  FLAG_ICON,
  FLAG_LABEL,
  recipeToText,
  reverseRecipeToText,
} from '@/lib/recipeText'
import type { Dataset, Recipe, RecipeIngredient } from '@/types'

/**
 * 图标 + 名称 + 数量角标（数量直接显示在图标右下角，**不再有外框 / `×N` 文字**）。
 * `iconOnly` 时只留图标（数量角标保留）。
 */
function ItemChip({
  id,
  dataset,
  iconOnly,
  stack,
  label,
  tooltip = true,
  className,
}: {
  id: number
  dataset: Dataset
  iconOnly: boolean
  stack?: number
  /** 覆盖名称（如配方组的「任何XX」）；`iconOnly` 时不显示文字，但仍用它做兜底名称。 */
  label?: string
  /** 是否显示物品提示（默认开；微光等「仅作标记」的图标传 false）。 */
  tooltip?: boolean
  className?: string
}) {
  const item = dataset.itemsById.get(id)
  const name = label ?? item?.name ?? `#${id}`
  // **小图标本身不可点**（避免误触弹抽屉）：要看详情就悬停出提示，点提示右上角的 ⓘ「物品详情」。
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <ItemIcon item={item} atlas={dataset.atlas} size={24} stack={stack} tooltip={tooltip} />
      {/* 仅图标模式下一律不显示名称，**包括配方组的「任何XX」**（用图标的代表物品识别类型）；
          名称仍保留在复制文本里。 */}
      {!iconOnly && <span className="truncate text-sm text-foreground/90">{name}</span>}
    </span>
  )
}

function IngredientChip({
  ingredient,
  dataset,
  iconOnly,
}: {
  ingredient: RecipeIngredient
  dataset: Dataset
  iconOnly: boolean
}) {
  const { t } = useI18n()
  const group = ingredient.group ? dataset.recipes.groups[ingredient.group] : undefined
  const groupName = group ? locText(dataset.loc, group.key) ?? group.key : undefined
  return (
    <ItemChip
      id={ingredient.id}
      dataset={dataset}
      iconOnly={iconOnly}
      stack={ingredient.stack}
      label={group ? t('recipe.groupAny', { name: groupName ?? group.key }) : undefined}
    />
  )
}

function Station({
  recipe,
  dataset,
  iconOnly,
}: {
  recipe: Recipe
  dataset: Dataset
  iconOnly: boolean
}) {
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
    <span className="inline-flex min-w-0 items-center gap-2">
      <ItemIcon item={items[0]} atlas={dataset.atlas} size={24} />
      {!iconOnly && <span className="truncate text-sm text-foreground/90">{items[0].name}</span>}
    </span>
  )
}

/** 环境 / 阵营条件：紧跟在制作站后面；能用物品图标的都用图标，其余用文字标签。 */
export function Conditions({ recipe, dataset }: { recipe: Recipe; dataset: Dataset }) {
  const { t } = useI18n()
  const env = recipe.env ?? []
  // `notDecraftable` 改为物品级的「可微分」徽章（见 ItemsPage 详情），不在配方行里重复。
  const flags = (recipe.flags ?? []).filter((f) => f !== 'notDecraftable')
  if (env.length === 0 && flags.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {env.map((e) => {
        const iconId = ENV_ICON[e]
        if (iconId != null) {
          return (
            <ItemIcon
              key={e}
              item={dataset.itemsById.get(iconId)}
              atlas={dataset.atlas}
              size={22}
              tooltip={false}
            />
          )
        }
        return <Badge key={e}>{ENV_LABEL[e] ? t(ENV_LABEL[e]) : e}</Badge>
      })}
      {flags.map((f) => {
        const iconId = FLAG_ICON[f]
        if (iconId != null) {
          return (
            <ItemIcon
              key={f}
              item={dataset.itemsById.get(iconId)}
              atlas={dataset.atlas}
              size={22}
              tooltip={false}
            />
          )
        }
        return (
          <Badge key={f} tone="accent">
            {FLAG_LABEL[f] ? t(FLAG_LABEL[f]) : f}
          </Badge>
        )
      })}
    </span>
  )
}

/**
 * 合成条目右上角的 hover 操作区：⭐ 收藏这条合成记录 + 复制文本。
 * 绝对定位、不占位（否则会把内容挤到第二行）；没有收藏 Provider 时不渲染 ⭐
 * （与物品提示的降级方式一致）；触屏上常显（`.touch-visible`）。
 */
function RecipeRowActions({
  recipe,
  reverse,
  copy,
  copied,
}: {
  recipe: Recipe
  /** 反向记录（微光分解）：收藏键带 `rev:` 前缀，与正向分开记。 */
  reverse?: boolean
  copy: () => void
  copied: boolean
}) {
  const { t } = useI18n()
  const favorites = useRecipeFavorites()
  const key = recipeFavoriteKey(recipe, reverse)
  const favorited = favorites ? favorites.isFavorited(key) : false
  const favoriteLabel = favorited ? t('recipe.unfavorite') : t('recipe.favorite')
  return (
    <span className="touch-visible absolute top-0.5 right-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/recipe:opacity-100 focus-within:opacity-100">
      {favorites && (
        <IconAction
          size="icon-xs"
          label={favoriteLabel}
          icon={Star}
          iconClassName={cn(favorited && 'fill-current text-warning')}
          pressed={favorited}
          onClick={(e) => {
            e.stopPropagation()
            favorites.toggle(key)
          }}
        />
      )}
      <IconAction
        size="icon-xs"
        label={copied ? t('action.copied') : t('action.copy')}
        icon={copied ? Check : Copy}
        onClick={(e) => {
          e.stopPropagation()
          copy()
        }}
      />
    </span>
  )
}

/** 可点整行的键盘操作：Enter / 空格等同点一下（行内 ⭐ / 复制按钮已 `stopPropagation`）。 */
function pickKeyDown(onPick?: () => void) {
  if (!onPick) return undefined
  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onPick()
  }
}

/**
 * 合成记录条目的统一外观：**无描边**、浅底（`bg-accent/40`）、悬停加深（`hover:bg-accent`）。
 *
 * 与「指令」页 / 收藏 / 历史里的条目同一套配色与圆角，三处（配方 / 反向配方 / 微光）
 * 加上物品详情里的合成记录都用这一份，避免「有的描边有的不描边」。
 */
const RECIPE_ROW_CLASS =
  'group/recipe relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 rounded-control bg-accent/40 px-3 py-2 transition-colors duration-150 hover:bg-accent'

export function RecipeRow({
  recipe,
  dataset,
  iconOnly,
  copyTags,
  onPick,
  pickLabel,
}: {
  recipe: Recipe
  dataset: Dataset
  iconOnly: boolean
  copyTags: boolean
  /** 点整行时调用（把它填进聊天输入框）；不传则行不可点。 */
  onPick?: () => void
  /** 可点时给读屏用的说明（如「填充到输入框」）。 */
  pickLabel?: string
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  /** 环境 / 阵营条件（`notDecraftable` 不算条件，已改成物品级的「可微分」）。 */
  const hasConditions =
    (recipe.env ?? []).length > 0 ||
    (recipe.flags ?? []).some((f) => f !== 'notDecraftable')
  /** 徒手（`station < 0`）不显示制作站；只有条件时（如「水中」）仍显示条件。 */
  const showStation = recipe.station >= 0
  const copy = async () => {
    try {
      await copyText(recipeToText(recipe, dataset, t, copyTags))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div
      data-testid="recipe-row"
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-label={onPick ? pickLabel : undefined}
      onClick={onPick}
      onKeyDown={pickKeyDown(onPick)}
      className={cn(
        RECIPE_ROW_CLASS,
        onPick && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ',
      )}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
        {recipe.ingredients.map((ing, i) => (
          <IngredientChip key={i} ingredient={ing} dataset={dataset} iconOnly={iconOnly} />
        ))}
      </span>
      {/* 制作站在箭头**前面**：`材料 @ 制作站(+条件) → 产物`；徒手制作不写制作站 */}
      {(showStation || hasConditions) && (
        <span className="inline-flex flex-wrap items-center gap-2">
          {showStation && (
            <>
              <span className="shrink-0 font-pixel text-sm text-muted-foreground">@</span>
              <Station recipe={recipe} dataset={dataset} iconOnly={iconOnly} />
            </>
          )}
          <Conditions recipe={recipe} dataset={dataset} />
        </span>
      )}
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <ItemChip
        id={recipe.result.id}
        dataset={dataset}
        iconOnly={iconOnly}
        stack={recipe.result.stack}
        className="text-foreground"
      />
      {/* hover 时右上角出现 ⭐ 收藏 + 复制（绝对定位、不占位，避免把内容挤到第二行）。 */}
      <RecipeRowActions recipe={recipe} copy={copy} copied={copied} />
    </div>
  )
}

/**
 * 可微光分解时的**反向记录**：`产物 @ 制作站 → 原材料`。
 * 与正向行同一套排版，只是材料 / 产物对调；可分解的物品才会有这一行。
 */
export function ReverseRecipeRow({
  recipe,
  itemId,
  dataset,
  iconOnly,
  copyTags,
  onPick,
  pickLabel,
}: {
  recipe: Recipe
  itemId: number
  dataset: Dataset
  iconOnly: boolean
  copyTags: boolean
  /** 点整行时调用（把它填进聊天输入框）；不传则行不可点。 */
  onPick?: () => void
  /** 可点时给读屏用的说明。 */
  pickLabel?: string
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await copyText(reverseRecipeToText(recipe, itemId, dataset, t, copyTags))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div
      data-testid="reverse-recipe-row"
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-label={onPick ? pickLabel : undefined}
      onClick={onPick}
      onKeyDown={pickKeyDown(onPick)}
      className={cn(
        // 反向配方只靠行内「微光」文案区分，不再用虚线边框（统一成同一种底色）。
        RECIPE_ROW_CLASS,
        onPick && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ',
      )}
    >
      <ItemChip id={itemId} dataset={dataset} iconOnly={iconOnly} className="text-foreground" />
      {/* 微光分解：`产物 @ 微光 → 原材料` */}
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="shrink-0 font-pixel text-sm text-muted-foreground">@</span>
        {/* 5362 只是微光的标记图标：文字固定「微光」，也不挂物品提示 */}
        <ItemChip
          id={5362}
          dataset={dataset}
          iconOnly={iconOnly}
          label={t('recipe.shimmerName')}
          tooltip={false}
        />
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
        {recipe.ingredients.map((ing, i) => (
          <IngredientChip key={i} ingredient={ing} dataset={dataset} iconOnly={iconOnly} />
        ))}
      </span>
      <RecipeRowActions recipe={recipe} reverse copy={copy} copied={copied} />
    </div>
  )
}

/** 微光转换行：`[源] → [目标]`。 */
export function ShimmerRow({
  fromId,
  toId,
  dataset,
  iconOnly,
}: {
  fromId: number
  toId: number
  dataset: Dataset
  iconOnly: boolean
}) {
  return (
    <div
      data-testid="shimmer-row"
      className={cn(RECIPE_ROW_CLASS, 'group/recipe')}
    >
      <ItemChip id={fromId} dataset={dataset} iconOnly={iconOnly} />
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <ItemChip id={toId} dataset={dataset} iconOnly={iconOnly} />
    </div>
  )
}

const MAX_ROWS = 60

/** 配方行列表：超过 MAX_ROWS 时显示「N 条未显示」，点击再加载一批。 */
function RecipeRows({
  rows,
  dataset,
  iconOnly,
  copyTags,
}: {
  rows: Recipe[]
  dataset: Dataset
  iconOnly: boolean
  copyTags: boolean
}) {
  const { t } = useI18n()
  const [limit, setLimit] = useState(MAX_ROWS)
  // 切物品时重置展开量：rows 是 useMemo 出来的（只在 itemId 变化时换引用），
  // 否则上一个物品点了几次「加载更多」会带到下一个物品。
  useEffect(() => setLimit(MAX_ROWS), [rows])
  const hidden = rows.length - limit
  return (
    <>
      {rows.slice(0, limit).map((r, i) => (
        <RecipeRow key={i} recipe={r} dataset={dataset} iconOnly={iconOnly} copyTags={copyTags} />
      ))}
      {hidden > 0 && (
        <Button
          size="sm"
          variant="ghost"
          // 样式与合成记录条目一致：浅底 `bg-accent/40`、悬停加深 `bg-accent`（`h-auto` 抵消 Button 的固定高度）
          className={cn(
            RECIPE_ROW_CLASS,
            'h-auto w-fit shrink-0 justify-self-start text-xs text-muted-foreground md:h-auto',
          )}
          onClick={() => setLimit((n) => n + MAX_ROWS)}
        >
          {t('recipe.more', { n: hidden })}
        </Button>
      )}
    </>
  )
}

/**
 * 合成表面板：本地数据渲染「怎么合成」+「能合成什么」+「微光转换」，
 * 不依赖登录与 `/r` 指令（数据见 tools/gen-recipes.mjs / tools/gen-shimmer.mjs）。
 * `iconOnly` 为 true 时只显示物品图标（不显示名称，数量以角标展示）。
 */
export function RecipePanel({
  itemId,
  dataset,
  iconOnly = false,
  copyTags = false,
  twoColumn = false,
}: {
  itemId: number
  dataset: Dataset
  iconOnly?: boolean
  /** 兼容旧调用；界面已取消复制标签功能，默认按名称复制。 */
  copyTags?: boolean
  /** 两列视图（默认单列）。 */
  twoColumn?: boolean
}) {
  const { t } = useI18n()
  const make = useMemo(
    () => (dataset.recipes.byResult[String(itemId)] ?? []).map((i) => dataset.recipes.recipes[i]),
    [dataset.recipes, itemId],
  )
  const use = useMemo(
    () => (dataset.recipes.byIngredient[String(itemId)] ?? []).map((i) => dataset.recipes.recipes[i]),
    [dataset.recipes, itemId],
  )
  // 可丢微光分解（`canDecraft`，数据见 tools/gamedump）：反向记录挂在「微光嬗变」分区。
  const decraft = dataset.itemStats.items[String(itemId)]?.stats?.canDecraft === true
  const shimmerInto = dataset.shimmerToById.get(itemId)
  const shimmerFrom = dataset.shimmerFromById.get(itemId) ?? []
  const shimmerCount = (shimmerInto != null ? 1 : 0) + shimmerFrom.length

  if (make.length === 0 && use.length === 0 && shimmerCount === 0 && !decraft) {
    return <p className="mt-2 text-xs text-muted-foreground">{t('recipe.none')}</p>
  }

  // 「微光分解」的反向记录（产物 @ 微光 → 原材料）挂在「微光嬗变」里：
  // 它本来就属于微光，放在「合成」里会让人以为是一种合成方式。
  const decraftRows = decraft ? make : []
  const shimmerTotal = shimmerCount + decraftRows.length

  return (
    <div className="mt-3 flex flex-col gap-3">
      {make.length > 0 && (
        <DetailSection
          title={t('recipe.make', { n: make.length })}
          tone={RECIPE_SECTION_TONE.make}
          iconId={36}
          dataset={dataset}
          twoColumn={twoColumn}
        >
          <RecipeRows rows={make} dataset={dataset} iconOnly={iconOnly} copyTags={copyTags} />
        </DetailSection>
      )}
      {use.length > 0 && (
        <DetailSection
          title={t('recipe.use', { n: use.length })}
          tone={RECIPE_SECTION_TONE.use}
          iconId={9}
          dataset={dataset}
          twoColumn={twoColumn}
        >
          <RecipeRows rows={use} dataset={dataset} iconOnly={iconOnly} copyTags={copyTags} />
        </DetailSection>
      )}
      {shimmerTotal > 0 && (
        <DetailSection
          title={t('recipe.shimmer', { n: shimmerTotal })}
          tone={RECIPE_SECTION_TONE.shimmer}
          iconId={5362}
          dataset={dataset}
          twoColumn={twoColumn}
        >
          {shimmerInto != null && (
            <ShimmerRow fromId={itemId} toId={shimmerInto} dataset={dataset} iconOnly={iconOnly} />
          )}
          {shimmerFrom.map((fromId) => (
            <ShimmerRow key={fromId} fromId={fromId} toId={itemId} dataset={dataset} iconOnly={iconOnly} />
          ))}
          {decraftRows.map((r, i) => (
            <ReverseRecipeRow
              key={`decraft-${i}`}
              recipe={r}
              itemId={itemId}
              dataset={dataset}
              iconOnly={iconOnly}
              copyTags={copyTags}
            />
          ))}
        </DetailSection>
      )}
    </div>
  )
}
