import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeItemTip } from './itemTips'
import type { Item, LocalizationBundle, ItemStatEntry } from '@/types'

/**
 * 材质包的 tips 走运行期重算（`lib/itemTips.ts`），默认仍用构建期结果。
 * 这条测试保证两者**逐件逐行完全一致**——否则「一勾材质包提示就变样」。
 *
 * 输入就是仓库里的真实生成数据（与运行时脚本一致）。
 */
const dataDir = resolve(process.cwd(), '../data')
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T

const items = readJson<{ items: Item[] }>('items.json').items
const stats = readJson<{ meta: unknown; items: Record<string, ItemStatEntry> }>('item-stats.json').items

function check(culture: string) {
  const loc = readJson<LocalizationBundle>(`loc.${culture}.json`)
  const tips = readJson<{ items: Record<string, string[]> }>(`item-tips.${culture}.json`).items
  const names = new Map(items.map((it) => [it.id, loc.ItemName?.[it.key] ?? it.key]))
  const nameOf = (id: number) => names.get(id)

  const mismatches: Array<{ id: number; key: string; expected: string[]; actual: string[] }> = []
  let compared = 0
  for (const item of items) {
    const entry = stats[String(item.id)]
    const actual = composeItemTip({ id: item.id, key: item.key, stats: entry?.stats }, loc, nameOf)
    const expected = tips[String(item.id)] ?? []
    compared += 1
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push({ id: item.id, key: item.key, expected, actual })
    }
  }
  return { compared, mismatches }
}

describe('物品提示运行期重算（真实数据）', () => {
  for (const culture of ['zh-Hans', 'en-US']) {
    it(`${culture}：6195 件物品逐行与构建期结果一致`, () => {
      const { compared, mismatches } = check(culture)
      expect(compared).toBe(items.length)
      // 失败时给出前几条方便定位（不要打印 6000 条）。
      expect(mismatches.slice(0, 10)).toEqual([])
      expect(mismatches.length).toBe(0)
    })
  }
})
