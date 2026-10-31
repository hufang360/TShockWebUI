import type { Dataset, Recipe, RecipeFavorite } from '@/types'

/** 合成记录收藏上限（与物品收藏一致：写满只丢最旧，不报错）。 */
export const RECIPE_FAVORITES_LIMIT = 200

/**
 * 合成记录的内容键：`fwd|rev : 产物 x 数量 @ 制作站 : 材料… : 环境… : 阵营…`。
 *
 * 为什么不用配方下标：`data/recipes.json` 重新生成后下标会整体错位，收藏会指向别的配方。
 * 用内容键则只有「这条配方本身没了」时才失配（渲染时直接跳过，不显示错的东西）。
 * 材料按字符串排序后拼接：材料顺序只是排版，不构成不同的配方。
 */
export function recipeFavoriteKey(recipe: Recipe, reverse = false): string {
  const ingredients = recipe.ingredients
    .map((i) => `${i.group ? `g${i.group}` : i.id}x${i.stack}`)
    .sort()
    .join(',')
  const env = [...(recipe.env ?? [])].sort().join('+')
  const flags = [...(recipe.flags ?? [])].sort().join('+')
  return [
    reverse ? 'rev' : 'fwd',
    `${recipe.result.id}x${recipe.result.stack}`,
    String(recipe.station),
    ingredients,
    env,
    flags,
  ].join(':')
}

/** 内容键里的产物 ID（`fwd:29x1:…` → `29`）；解析不出来时返回 null。 */
function keyResultId(key: string): number | null {
  const result = key.split(':')[1] ?? ''
  const id = Number(/^(\d+)x/.exec(result)?.[1] ?? NaN)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 按内容键找回收藏的那条配方（找不到 = 数据里已经没有这条配方了）。
 * 只在产物的配方里找：正向 / 反向记录展示的都是 `byResult` 里的配方。
 */
export function findFavoriteRecipe(
  dataset: Dataset,
  key: string,
): { recipe: Recipe; reverse: boolean } | null {
  const resultId = keyResultId(key)
  if (resultId == null) return null
  const reverse = key.startsWith('rev:')
  const candidates = dataset.recipes.byResult[String(resultId)] ?? []
  for (const index of candidates) {
    const recipe = dataset.recipes.recipes[index]
    if (recipe && recipeFavoriteKey(recipe, reverse) === key) return { recipe, reverse }
  }
  return null
}

/** 从任意持久化数据恢复收藏：丢弃非法 / 重复项并按上限截断。 */
export function sanitizeRecipeFavorites(value: unknown): RecipeFavorite[] {
  if (!Array.isArray(value)) return []
  const out: RecipeFavorite[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const key = (raw as { key?: unknown }).key
    if (typeof key !== 'string' || key.length === 0 || seen.has(key)) continue
    const rawTs = (raw as { ts?: unknown }).ts
    const ts = typeof rawTs === 'number' && Number.isFinite(rawTs) ? rawTs : Date.now()
    seen.add(key)
    out.push({ key, ts })
  }
  return out.slice(0, RECIPE_FAVORITES_LIMIT)
}

export function isRecipeFavorited(list: RecipeFavorite[], key: string): boolean {
  return list.some((f) => f.key === key)
}

/** 收藏（已存在则置顶并刷新时间）。 */
export function addRecipeFavorite(
  list: RecipeFavorite[],
  key: string,
  ts = Date.now(),
): RecipeFavorite[] {
  if (!key) return list
  return [{ key, ts }, ...list.filter((f) => f.key !== key)].slice(0, RECIPE_FAVORITES_LIMIT)
}

export function removeRecipeFavorite(list: RecipeFavorite[], key: string): RecipeFavorite[] {
  return list.filter((f) => f.key !== key)
}
