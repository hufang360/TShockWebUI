// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  BESTIARY_SORTS,
  bestiaryFilterCounts,
  bestiarySortById,
  matchesBestiaryFilters,
  sortNpcs,
} from './bestiary'
import type { BestiaryNpc, Npc } from '@/types'

const npc = (id: number, name: string): Npc => ({ id, key: `Npc${id}`, name })
const entry = (over: Partial<BestiaryNpc> = {}): BestiaryNpc => ({
  sortId: 0,
  rarity: 1,
  damage: 0,
  defense: 0,
  coins: 0,
  life: 0,
  filters: [],
  ...over,
})

const npcs = [npc(3, '丙'), npc(1, '乙'), npc(2, '甲')]
const byId = new Map<number, BestiaryNpc>([
  // 1: 弱），2: 强），3: 没有图鉴数据
  [1, entry({ sortId: 30, damage: 5, defense: 1, coins: 100, life: 10, rarity: 1, filters: [0] })],
  [2, entry({ sortId: 10, damage: 50, defense: 9, coins: 5, life: 900, rarity: 3, filters: [1] })],
])

describe('bestiary 排序', () => {
  it('默认（未选排序项）：按 NPC 自身 ID 升序', () => {
    const out = sortNpcs(npcs, byId, null, 'zh')
    expect(out.map((n) => n.id)).toEqual([1, 2, 3])
  })

  it('目录顺序：7 项与游戏一致，方向照抄 SortingSteps', () => {
    expect(BESTIARY_SORTS.map((s) => s.id)).toEqual([
      'id',
      'name',
      'attack',
      'defense',
      'coins',
      'life',
      'rarity',
    ])
    // 方向统一倒序（数值项与游戏 SortingSteps 一致：大的在前）
    for (const sort of BESTIARY_SORTS) expect(sort.dir, sort.id).toBe('desc')
  })

  it('按怪物图鉴ID 倒序；没有序号（sortId=0）/ 没有图鉴数据的始终排在后面', () => {
    // 序号 10 的 2 号在前，序号 30 的 1 号在后；3 号没有图鉴数据 → 最后
    const out = sortNpcs(npcs, byId, bestiarySortById('id'), 'zh')
    expect(out.map((n) => n.id)).toEqual([1, 2, 3])
    const zero = new Map(byId)
    zero.set(1, entry({ sortId: 0 }))
    const withZero = sortNpcs(npcs, zero, bestiarySortById('id'), 'zh')
    // 只有 2 号有序号 → 最前；0 序号与缺失数据都在后面（彼此按自身 id 倒序）
    expect(withZero.map((n) => n.id)).toEqual([2, 3, 1])
  })

  it('攻击 / 防御 / 生命 / 稀有度：降序（大的在前）', () => {
    for (const id of ['attack', 'defense', 'life', 'rarity'] as const) {
      const out = sortNpcs(npcs, byId, bestiarySortById(id), 'zh')
      expect(out.map((n) => n.id), id).toEqual([2, 1, 3])
    }
  })

  it('钱币同样是降序（钱多的在前）', () => {
    const out = sortNpcs(npcs, byId, bestiarySortById('coins'), 'zh')
    expect(out.map((n) => n.id)).toEqual([1, 2, 3])
  })

  it('名称按当前语言的本地化名排序', () => {
    // 名称排序不依赖图鉴数据（空选集也要能排），方向是倒序 Z → A
    const en = sortNpcs(
      [npc(1, 'Zeta'), npc(2, 'Alpha'), npc(3, 'Mike')],
      new Map(),
      bestiarySortById('name'),
      'en',
    )
    expect(en.map((n) => n.name)).toEqual(['Zeta', 'Mike', 'Alpha'])
  })
})

describe('bestiary 筛选器', () => {
  it('空选集 = 不筛；有选集时是并集（任一命中即保留）', () => {
    expect(matchesBestiaryFilters(byId.get(1), [])).toBe(true)
    expect(matchesBestiaryFilters(byId.get(1), [0])).toBe(true)
    expect(matchesBestiaryFilters(byId.get(1), [1])).toBe(false)
    expect(matchesBestiaryFilters(byId.get(1), [0, 1])).toBe(true)
    // 没有图鉴数据的 NPC：有筛选器时排除
    expect(matchesBestiaryFilters(undefined, [0])).toBe(false)
    expect(matchesBestiaryFilters(undefined, [])).toBe(true)
  })

  it('条数：按传入的 NPC 集合统计每个筛选器命中数', () => {
    const counts = bestiaryFilterCounts([...npcs], byId, 3)
    expect(counts).toEqual([1, 1, 0])
  })
})
