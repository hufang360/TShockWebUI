/**
 * 合成记录的**文本与展示常量**（纯函数 / 纯数据，不含 JSX）。
 *
 * 从 `components/RecipePanel.tsx` 抽出来：一是让组件文件只导出组件（Fast Refresh 不整页刷新），
 * 二是这些格式化函数被「聊天 · 合成表」等处复用，放在 `lib/` 更像工具。
 */
import { formatItemTag } from '@/lib/items'
import { locText } from '@/lib/loc'
import type { Dataset, Recipe } from '@/types'

type T = (key: string, vars?: Record<string, string | number>) => string

/** 环境条件 → i18n 键（文案）。 */
export const ENV_LABEL: Record<string, string> = {
  water: 'recipe.env.water',
  honey: 'recipe.env.honey',
  lava: 'recipe.env.lava',
  snow: 'recipe.env.snow',
  mechdusa: 'recipe.env.mechdusa',
  graveyard: 'recipe.env.graveyard',
  torchGod: 'recipe.env.torchGod',
}
/** 环境条件用**物品图标**代替文字（用户指定）。 */
export const ENV_ICON: Record<string, number> = {
  graveyard: 4358, // MusicBoxGraveyard（墓地的八音盒）
  torchGod: 5043, // TorchGodsFavor（火把神祝福）
  water: 206, // WaterBucket（水桶）
  honey: 1128, // HoneyBucket（蜂蜜桶）
  lava: 207, // LavaBucket（岩浆桶）
  snow: 593, // SnowBlock（雪块）
}
/** 阵营条件 → i18n 键（文案）。 */
export const FLAG_LABEL: Record<string, string> = {
  crimson: 'recipe.flag.crimson',
  corruption: 'recipe.flag.corruption',
}
/** 阵营条件用**物品图标**代替文字。 */
export const FLAG_ICON: Record<string, number> = {
  crimson: 5533, // CrimsonAltar（猩红祭坛）
  corruption: 5532, // DemonAltar（恶魔祭坛）
}

/** 合成条目 → 描述性文本；`tags` 为 true 时用 `[i:ID]` 标签代替名称。
 *
 * 格式与界面一致：`材料1 + 材料2 @ 制作站[ 条件] → 产物`（制作站在箭头前面）；
 * **徒手制作不写制作站**（有条件时只写条件，如「(水中)」）。
 */
export function recipeToText(recipe: Recipe, dataset: Dataset, t: T, tags: boolean): string {
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
    stationId != null ? label(stationId) : t('recipe.station', { id: recipe.station })
  const conds = [...(recipe.env ?? []), ...(recipe.flags ?? [])]
    .filter((c) => c !== 'notDecraftable')
    .map((c) => (ENV_LABEL[c] ? t(ENV_LABEL[c]) : FLAG_LABEL[c] ? t(FLAG_LABEL[c]) : c))
    .join(' ')
  const head = [recipe.station < 0 ? null : `@ ${station}`, conds ? `(${conds})` : null]
    .filter((s): s is string => !!s)
    .join(' ')
  return `${ingredients}${head ? ` ${head}` : ''} → ${result}`
}

/** 反向记录（可微光分解）的复制文本：`产物 @ 制作站 → 原材料的反向组合`。 */
export function reverseRecipeToText(
  recipe: Recipe,
  itemId: number,
  dataset: Dataset,
  t: T,
  tags: boolean,
): string {
  const label = (id: number) =>
    tags ? formatItemTag(id) : (dataset.itemsById.get(id)?.name ?? `#${id}`)
  const withStack = (s: string, n: number) => (n > 1 ? `${s} x${n}` : s)
  const outputs = recipe.ingredients
    .map((i) => {
      const group = i.group ? dataset.recipes.groups[i.group] : undefined
      const groupName = group ? locText(dataset.loc, group.key) ?? group.key : undefined
      const base = group ? t('recipe.groupAny', { name: groupName ?? group.key }) : label(i.id)
      return withStack(base, i.stack)
    })
    .join(' + ')
  // 第二条是微光分解：制作站固定写作「微光」，不再沿用原配方的制作站 / 条件。
  return `${label(itemId)} @ ${t('recipe.shimmerName')} → ${outputs}`
}

/**
 * 聊天填充用文本：**只用 `[i:ID]` 标签**（聊天里只有标签能显示成物品图标），
 * 格式固定为 `[i:126][i:315][i:314][i:13] @ [i:31] -> [i:296]`（材料直接连写、`@` 制作站、`->` 产物）。
 * 徒手制作没有 `@` 段；数量不进文本（游戏里 `[i:..]` 不支持数量）。
 */
export function recipeToChatText(recipe: Recipe): string {
  const tag = (id: number) => formatItemTag(id)
  const ingredients = recipe.ingredients.map((i) => tag(i.id)).join('')
  const stationId = recipe.station < 0 ? undefined : recipe.stationItems[0]
  const station = stationId != null ? ` @ ${tag(stationId)}` : ''
  return `${ingredients}${station} -> ${tag(recipe.result.id)}`
}

/** 反向（微光分解）记录的聊天填充文本：`[i:产物] @ [i:5362] -> [i:材料]…`。 */
export function reverseRecipeToChatText(recipe: Recipe, itemId: number): string {
  const tag = (id: number) => formatItemTag(id)
  const outputs = recipe.ingredients.map((i) => tag(i.id)).join('')
  return `${tag(itemId)} @ ${tag(5362)} -> ${outputs}`
}
