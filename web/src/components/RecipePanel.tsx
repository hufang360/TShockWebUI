import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Check, Copy, Hammer } from 'lucide-react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { ItemIcon } from '@/components/ItemIcon'
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Separator } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { formatItemTag } from '@/lib/items'
import { locText } from '@/lib/loc'
import { cn } from '@/lib/cn'
import type { Dataset, Recipe, RecipeIngredient } from '@/types'

type T = (key: string, vars?: Record<string, string | number>) => string

const ENV_LABEL: Record<string, string> = {
  water: 'recipe.env.water',
  honey: 'recipe.env.honey',
  lava: 'recipe.env.lava',
  snow: 'recipe.env.snow',
  mechdusa: 'recipe.env.mechdusa',
  graveyard: 'recipe.env.graveyard',
  torchGod: 'recipe.env.torchGod',
}
/** 环境条件用**物品图标**代替文字（用户指定）。 */
const ENV_ICON: Record<string, number> = {
  graveyard: 4358, // MusicBoxGraveyard（墓地的八音盒）
  torchGod: 5043, // TorchGodsFavor（火把神祝福）
  water: 206, // WaterBucket（水桶）
  honey: 1128, // HoneyBucket（蜂蜜桶）
  lava: 207, // LavaBucket（岩浆桶）
  snow: 593, // SnowBlock（雪块）
}
const FLAG_LABEL: Record<string, string> = {
  crimson: 'recipe.flag.crimson',
  corruption: 'recipe.flag.corruption',
}
/** 阵营条件用**物品图标**代替文字。 */
const FLAG_ICON: Record<string, number> = {
  crimson: 5533, // CrimsonAltar（猩红祭坛）
  corruption: 5532, // DemonAltar（恶魔祭坛）
}

/** 合成条目 → 描述性文本；`tags` 为 true 时用 `[i:ID]` 标签代替名称。 */
function recipeToText(recipe: Recipe, dataset: Dataset, t: T, tags: boolean): string {
  const label = (id: number) =>
    tags ? formatItemTag(id) : (dataset.itemsById.get(id)?.name ?? `#${id}`)
  const withStack = (s: string, n: number) => (n > 1 ? `${s} x${n}` : s)
  const ingredients = recipe.ingredients
    .map((i) => {
      const group = i.group ? dataset.recipes.groups[i.group] : undefined
      const groupName = group ? locText(dataset.loc, group.key) ?? group.key : undefined
      const base = group ? t('recipe.groupAny', { name: groupName ?? group.key }) : label(i.id)
      return withStack(base, i.stack)
    })
    .join(' + ')
  const result = withStack(label(recipe.result.id), recipe.result.stack)
  const stationId = recipe.stationItems[0]
  const station =
    recipe.station < 0
      ? t('recipe.hand')
      : stationId != null
        ? label(stationId)
        : t('recipe.station', { id: recipe.station })
  const conds = [...(recipe.env ?? []), ...(recipe.flags ?? [])]
    .filter((c) => c !== 'notDecraftable')
    .map((c) =>
      ENV_LABEL[c] ? t(ENV_LABEL[c]) : FLAG_LABEL[c] ? t(FLAG_LABEL[c]) : c,
    )
    .join(' ')
  return `${ingredients} → ${result} @ ${station}${conds ? ` (${conds})` : ''}`
}

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
  className,
}: {
  id: number
  dataset: Dataset
  iconOnly: boolean
  stack?: number
  /** 覆盖名称（如配方组的「任何XX」）。 */
  label?: string
  className?: string
}) {
  const item = dataset.itemsById.get(id)
  const name = label ?? item?.name ?? `#${id}`
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <ItemIcon item={item} atlas={dataset.atlas} size={24} stack={stack} />
      {/* 配方组（「任何XX」）即使开启仅图标也要显示文字 */}
      {(!iconOnly || !!label) && <span className="truncate text-sm text-foreground/90">{name}</span>}
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
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <ItemIcon item={items[0]} atlas={dataset.atlas} size={24} />
      {!iconOnly && <span className="truncate text-sm text-foreground/90">{items[0].name}</span>}
    </span>
  )
}

/** 「可丢微光分解」行内标记：5362 图标（无 tips）+ 文字；多件一组时注明「每 N 个分解一次」。 */
function DecraftTag({ dataset, stack }: { dataset: Dataset; stack: number }) {
  const { t } = useI18n()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <ItemIcon
        item={dataset.itemsById.get(5362)}
        atlas={dataset.atlas}
        size={22}
        tooltip={false}
      />
      <span className="text-xs text-muted-foreground">{t('dex.canDecraft')}</span>
      {stack > 1 && (
        <span className="text-xs text-muted-foreground">
          {t('dex.canDecraftStack', { n: stack })}
        </span>
      )}
    </span>
  )
}

/** 环境 / 阵营条件：紧跟在制作站后面；能用物品图标的都用图标，其余用文字标签。 */
function Conditions({ recipe, dataset }: { recipe: Recipe; dataset: Dataset }) {
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

function RecipeRow({
  recipe,
  dataset,
  iconOnly,
  copyTags,
  decraft,
}: {
  recipe: Recipe
  dataset: Dataset
  iconOnly: boolean
  copyTags: boolean
  /** 非空时在行尾追加「可丢微光分解」标记（只给「合成表」区的行）。 */
  decraft?: { stack: number } | null
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recipeToText(recipe, dataset, t, copyTags))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="group/recipe relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-accent/40 px-2.5 py-2">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        {recipe.ingredients.map((ing, i) => (
          <IngredientChip key={i} ingredient={ing} dataset={dataset} iconOnly={iconOnly} />
        ))}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <ItemChip
        id={recipe.result.id}
        dataset={dataset}
        iconOnly={iconOnly}
        stack={recipe.result.stack}
        className="text-foreground"
      />
      {/* 制作站左边加一条分割线 */}
      <Separator orientation="vertical" className="h-5 shrink-0" />
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Hammer className="size-3.5 shrink-0 text-muted-foreground" />
        <Station recipe={recipe} dataset={dataset} iconOnly={iconOnly} />
        <Conditions recipe={recipe} dataset={dataset} />
        {decraft && (
          <>
            <Separator orientation="vertical" className="h-5 shrink-0" />
            <DecraftTag dataset={dataset} stack={decraft.stack} />
          </>
        )}
      </span>
      {/* hover 时右上角出现复制按钮（绝对定位、不占位，避免把内容挤到第二行）。 */}
      <Button
        size="icon-sm"
        variant="ghost"
        className="absolute top-0.5 right-0.5 shrink-0 opacity-0 transition-opacity group-hover/recipe:opacity-100 focus-visible:opacity-100"
        aria-label={t('action.copy')}
        title={copied ? t('action.copied') : t('action.copy')}
        onClick={(e) => {
          e.stopPropagation()
          void copy()
        }}
      >
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      </Button>
    </div>
  )
}

/** 微光转换行：`[源] → [目标]`。 */
function ShimmerRow({
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
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-accent/40 px-2.5 py-2">
      <ItemChip id={fromId} dataset={dataset} iconOnly={iconOnly} />
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <ItemChip id={toId} dataset={dataset} iconOnly={iconOnly} />
    </div>
  )
}

/** 可折叠分区（默认展开）：[固定物品图标] 标题 + 折叠箭头；内容按「短条目自动多列」网格排列。 */
function RecipeSection({
  title,
  tone,
  iconId,
  dataset,
  singleColumn,
  children,
}: {
  title: string
  tone: string
  /** 固定图标（按用户指定）；不传则标题前无图标。 */
  iconId?: number
  dataset: Dataset
  /** 单列显示（默认多列自适应）。 */
  singleColumn?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1">
      <CollapsibleTrigger className="group/title flex w-full cursor-pointer items-center gap-1.5 text-sm font-medium">
        {iconId != null && (
          <ItemIcon
            item={dataset.itemsById.get(iconId)}
            atlas={dataset.atlas}
            size={20}
            tooltip={false}
          />
        )}
        <span className={cn('truncate', tone)}>{title}</span>
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className={cn(
            'grid gap-1',
            singleColumn ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]',
          )}
        >
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

const MAX_ROWS = 60

/** 配方行列表：超过 MAX_ROWS 时显示「N 条未显示」，点击再加载一批。 */
function RecipeRows({
  rows,
  dataset,
  iconOnly,
  copyTags,
  decraft,
}: {
  rows: Recipe[]
  dataset: Dataset
  iconOnly: boolean
  copyTags: boolean
  decraft?: { stack: number } | null
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
        <RecipeRow
          key={i}
          recipe={r}
          dataset={dataset}
          iconOnly={iconOnly}
          copyTags={copyTags}
          decraft={decraft}
        />
      ))}
      {hidden > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start text-xs text-muted-foreground"
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
  copyTags = true,
  singleColumn = false,
}: {
  itemId: number
  dataset: Dataset
  iconOnly?: boolean
  /** 复制的合成文本是否含 `[i:ID]` 标签。 */
  copyTags?: boolean
  /** 单列显示合成记录（默认多列自适应）。 */
  singleColumn?: boolean
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
  // 「可丢微光分解」与「合成表」的每条记录一起显示（只挂在 make 分区）。
  const stat = dataset.itemStats.items[String(itemId)]
  const decraft =
    stat?.stats?.canDecraft === true
      ? { stack: typeof stat.stats.decraftStack === 'number' ? stat.stats.decraftStack : 1 }
      : null
  const shimmerInto = dataset.shimmerToById.get(itemId)
  const shimmerFrom = dataset.shimmerFromById.get(itemId) ?? []
  const shimmerCount = (shimmerInto != null ? 1 : 0) + shimmerFrom.length

  if (make.length === 0 && use.length === 0 && shimmerCount === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">{t('recipe.none')}</p>
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {make.length > 0 && (
        <RecipeSection
          title={t('recipe.make', { n: make.length })}
          tone="text-success"
          iconId={531}
          dataset={dataset}
          singleColumn={singleColumn}
        >
          <RecipeRows
            rows={make}
            dataset={dataset}
            iconOnly={iconOnly}
            copyTags={copyTags}
            decraft={decraft}
          />
        </RecipeSection>
      )}
      {use.length > 0 && (
        <RecipeSection
          title={t('recipe.use', { n: use.length })}
          tone="text-warning"
          iconId={36}
          dataset={dataset}
          singleColumn={singleColumn}
        >
          <RecipeRows rows={use} dataset={dataset} iconOnly={iconOnly} copyTags={copyTags} />
        </RecipeSection>
      )}
      {shimmerCount > 0 && (
        <RecipeSection
          title={t('recipe.shimmer', { n: shimmerCount })}
          tone="text-info"
          iconId={5362}
          dataset={dataset}
          singleColumn={singleColumn}
        >
          {shimmerInto != null && (
            <ShimmerRow fromId={itemId} toId={shimmerInto} dataset={dataset} iconOnly={iconOnly} />
          )}
          {shimmerFrom.map((fromId) => (
            <ShimmerRow key={fromId} fromId={fromId} toId={itemId} dataset={dataset} iconOnly={iconOnly} />
          ))}
        </RecipeSection>
      )}
    </div>
  )
}
