import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bestPrefixIds, rankPrefixes } from './prefixes'
import type { PrefixMods } from '@/types'

/**
 * 真实数据验证：用 `prefix-sets.json` + `prefix-mods.json` + `item-stats.json`
 * 算出的「最佳词缀」必须与游戏自身的 `Item.BestPrefixValue()` / `rolledPrefixIsTopTier`
 * 完全一致（生成时用 OTAPI 交叉核对过 886 件可重铸物品，0 差异）。
 */
const dataDir = resolve(process.cwd(), '../data')
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T

const modsData = readJson<{ mods: Record<string, PrefixMods> }>('prefix-mods.json')
const prefixSets = readJson<{ sets: number[][]; items: Record<string, number> }>('prefix-sets.json')
const stats = readJson<{
  items: Record<string, { stats?: Record<string, number | boolean> }>
}>('item-stats.json')

const modsById = new Map<number, PrefixMods>(
  Object.entries(modsData.mods).map(([id, m]) => [Number(id), m]),
)
const bestOf = (itemId: number): number[] => {
  const idx = prefixSets.items[String(itemId)]
  if (idx == null) return []
  return bestPrefixIds(prefixSets.sets[idx]!, modsById, stats.items[String(itemId)]?.stats)
}

describe('真实数据：最佳词缀（游戏 Item.BestPrefixValue）', () => {
  it('天顶剑 → 传奇（81）', () => {
    expect(bestOf(4956)).toEqual([81])
  })

  it('魔法竖琴（mana=5，恰为 .5 的舍入边界）→ 神话（83）', () => {
    expect(bestOf(494)).toEqual([83])
  })

  it('铜表（饰品）→ 顶级词缀并列 65/68/72/76/80', () => {
    expect(bestOf(15)).toEqual([65, 68, 72, 76, 80])
  })

  it('盔甲等不可重铸 → 空', () => {
    expect(bestOf(1001)).toEqual([])
  })

  it('饰品词缀带精确效果（Player.GrantPrefixBenefits）', () => {
    expect(modsData.mods['72']?.benefit).toEqual({ key: 'damage', value: 4 }) // 险恶
    expect(modsData.mods['65']?.benefit).toEqual({ key: 'defense', value: 4 }) // 护佑
    expect(modsData.mods['66']?.benefit).toEqual({ key: 'mana', value: 20 }) // 奥秘
  })

  it('排序稳定：评分从高到低', () => {
    const ranked = rankPrefixes(
      prefixSets.sets[prefixSets.items['4956']!]!,
      modsById,
      stats.items['4956']?.stats,
    )
    expect(ranked[0]!.id).toBe(81)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.val).toBeGreaterThanOrEqual(ranked[i]!.val)
    }
  })
})
