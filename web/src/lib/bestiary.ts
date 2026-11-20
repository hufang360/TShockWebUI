import type { BestiaryNpc, Lang, Npc } from '@/types'

/**
 * 「怪物图鉴」的排序 / 筛选规则（纯逻辑，便于用例覆盖）。
 *
 * 事实来源（Terraria 1.4.5.8）：
 * - 排序项：`Terraria.GameContent.Bestiary/BestiaryDatabaseNPCsPopulator.cs` 的 `RegisterSortSteps()`
 *   （`HiddenFromSortOptions=false` 的 7 个），顺序与游戏一致。
 * - **方向统一为倒序**（按本项目要求）：数值项与游戏 `SortingSteps` 一致（大的在前），
 *   ID / 名称也走倒序，界面里点哪一项都是「从大到小 / 从后到前」。
 * - 多个筛选器之间是**并集**（`EntryFilterer.FitsFilter`：任一命中即通过），不是交集。
 */

export type BestiarySortId = 'id' | 'name' | 'attack' | 'defense' | 'coins' | 'life' | 'rarity'

export interface BestiarySort {
  id: BestiarySortId
  /** 本地化 key（`loc.BestiaryInfo.Sort_*`）。 */
  labelKey: string
  dir: 'asc' | 'desc'
  /** 取排序键；`name` 需要外部给名字（本地化名，缩略号排序）。 */
  value: (entry: BestiaryNpc) => number
}

export const BESTIARY_SORTS: readonly BestiarySort[] = [
  // sortId 为 0 = 游戏图鉴里不单独排序的（旧变体 / ShouldHideBestiaryEntry）；
  // 这些在 sortNpcs 里始终接在图鉴条目之后，不参与正 / 倒序。
  { id: 'id', labelKey: 'BestiaryInfo.Sort_BestiaryID', dir: 'desc', value: (e) => e.sortId },
  // 「名称」按本地化名比较（游戏 `Alphabetical` 用 `Language.GetTextValue`），由 sortNpcs 特判。
  { id: 'name', labelKey: 'BestiaryInfo.Sort_Alphabetical', dir: 'desc', value: () => 0 },
  { id: 'attack', labelKey: 'BestiaryInfo.Sort_Attack', dir: 'desc', value: (e) => e.damage },
  { id: 'defense', labelKey: 'BestiaryInfo.Sort_Defense', dir: 'desc', value: (e) => e.defense },
  { id: 'coins', labelKey: 'BestiaryInfo.Sort_Coins', dir: 'desc', value: (e) => e.coins },
  { id: 'life', labelKey: 'BestiaryInfo.Sort_HitPoints', dir: 'desc', value: (e) => e.life },
  { id: 'rarity', labelKey: 'BestiaryInfo.Sort_Rarity', dir: 'desc', value: (e) => e.rarity },
]

export function bestiarySortById(id: string | undefined): BestiarySort {
  return BESTIARY_SORTS.find((s) => s.id === id) ?? BESTIARY_SORTS[0]!
}

/**
 * 按筛选器并集过滤：`active` 为空 = 不筛。
 * 没有图鉴数据的 NPC（理论上不存在）在有筛选器时被排除。
 */
export function matchesBestiaryFilters(entry: BestiaryNpc | undefined, active: readonly number[]): boolean {
  if (active.length === 0) return true
  if (!entry) return false
  return active.some((index) => entry.filters.includes(index))
}

/** 当前 NPC 集合下每个筛选器还能筛出多少条（下拉里显示条数用）。 */
export function bestiaryFilterCounts(
  npcs: readonly Npc[],
  byNpcId: Map<number, BestiaryNpc>,
  filterCount: number,
): number[] {
  const counts = new Array<number>(filterCount).fill(0)
  for (const npc of npcs) {
    const entry = byNpcId.get(npc.id)
    if (!entry) continue
    for (const index of entry.filters) {
      if (index >= 0 && index < filterCount) counts[index] += 1
    }
  }
  return counts
}

/**
 * 排序。`sort` 为 `null` = 默认：按 NPC 自身 ID **升序**。
 *
 * 选中某个排序项时，结果是「按该项自然顺序排完再整体倒序」（本项目要求）：
 * 数值项 = 大的在前，名称 = Z→A，怪物图鉴ID = 图鉴序号大的在前。
 * 没有图鉴数据的排最后；同值时保持原有顺序（Array.sort 稳定）。
 */
export function sortNpcs(
  npcs: readonly Npc[],
  byNpcId: Map<number, BestiaryNpc>,
  sort: BestiarySort | null,
  lang: Lang,
): Npc[] {
  if (!sort) return [...npcs].sort((a, b) => a.id - b.id)
  const collator = new Intl.Collator(lang === 'en' ? 'en' : 'zh-Hans')
  const named = npcs.map((npc) => ({ npc, entry: byNpcId.get(npc.id) }))
  const sign = sort.dir === 'asc' ? 1 : -1
  /** 「怪物图鉴ID」：没有图鉴排序键的（sortId=0）始终排在后面（不受正 / 倒序影响）。 */
  const catalogId = (item: (typeof named)[number]): number =>
    item.entry && item.entry.sortId > 0 ? item.entry.sortId : 0
  named.sort((a, b) => {
    // 名称排序不依赖图鉴数据（每只 NPC 都有名字）。
    if (sort.id === 'name') return collator.compare(a.npc.name, b.npc.name) * sign
    if (sort.id === 'id') {
      const idA = catalogId(a)
      const idB = catalogId(b)
      if (idA === 0 || idB === 0) {
        // 没有图鉴序号的一组：排在最后，组内按自身 id 倒序。
        if (idA === 0 && idB === 0) return (b.npc.id - a.npc.id)
        return idA === 0 ? 1 : -1
      }
      return (idA - idB) * sign
    }
    if (!a.entry && !b.entry) return 0
    if (!a.entry) return 1
    if (!b.entry) return -1
    return (sort.value(a.entry) - sort.value(b.entry)) * sign
  })
  return named.map((item) => item.npc)
}
