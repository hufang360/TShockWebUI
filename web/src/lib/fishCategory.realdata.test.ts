// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ITEM_COLLECTIONS } from './collections'
import { FISH_CATEGORIES, matchFishCategories } from './fishCategory'

/**
 * 真实数据校验：分类表里手写的物品 id 必须对得上游戏数据里的名字。
 * 防的是「抄错一个号，界面把别的商品归进地牢」这种查不出来的错。
 */
// vitest 的 cwd 是 web/，数据在仓库根 data/ 下。
const dataDir = resolve(process.cwd(), '../data')
const readJson = <T>(file: string): T => JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T

const items = readJson<{ items: { id: number; key: string }[] }>('items.json').items
const itemNames = readJson<{ ItemName: Record<string, string> }>('loc.zh-Hans.json').ItemName
const keyById = new Map(items.map((item) => [item.id, item.key]))

/** 地牢 17 件（`docs/插件-鱼店.md` §4.2 那张表）。 */
const DUNGEON_NAMES: Record<number, string> = {
  155: '村正',
  156: '钴护盾',
  163: '蓝月',
  113: '魔法飞弹',
  3317: '英勇球',
  164: '手枪',
  329: '暗影钥匙',
  6156: '银护腕',
  327: '金钥匙',
  2192: '骨头焊机',
  1156: '食人鱼枪',
  1571: '腐化者之戟',
  1569: '吸血鬼刀',
  1260: '彩虹枪',
  1572: '寒霜九头蛇法杖',
  4607: '沙漠虎杖',
}

const dungeonIds = FISH_CATEGORIES.find((c) => c.id === 'dungeon')?.rule.ids ?? []

describe('鱼店分类（真实数据）', () => {
  it('地牢分类的 id 与游戏中文名一一对上', () => {
    // 5465 的中文名与插件名字表不一致，单独在下一个用例校验，不进这张名字表
    expect(new Set(dungeonIds)).toEqual(new Set([...Object.keys(DUNGEON_NAMES).map(Number), 5465]))
    for (const [id, name] of Object.entries(DUNGEON_NAMES)) {
      const key = keyById.get(Number(id))
      expect(key, `item ${id}`).toBeTruthy()
      expect(itemNames[key as string], `item ${id}`).toBe(name)
    }
  })

  it('5465 = DeadCellsRamRune（插件名字表叫「牧羊符文」，游戏中文名叫「重锤符文」）', () => {
    expect(dungeonIds).toContain(5465)
    expect(keyById.get(5465)).toBe('DeadCellsRamRune')
  })

  it('每个分组配的图标 id 都在物品表里', () => {
    for (const { id, iconId } of FISH_CATEGORIES) {
      expect(keyById.get(iconId), `分组 ${id} 的图标 ${iconId}`).toBeTruthy()
    }
  })

  it('渔业集合存在，且含 3120 / 3096 / 3037 / 2373~2375', () => {
    const fishing = ITEM_COLLECTIONS.find((c) => c.id === 'category:渔业...')
    expect(fishing, 'data/collections 里的「渔业...」集合').toBeTruthy()
    for (const id of [3120, 3096, 3037, 2373, 2374, 2375]) {
      expect(fishing?.ids, `item ${id}`).toContain(id)
    }
  })

  it('渔业集合里每个物品都归进钓鱼分类', () => {
    const fishing = ITEM_COLLECTIONS.find((c) => c.id === 'category:渔业...')
    for (const id of fishing?.ids ?? []) {
      const good = { serial: 1, name: '', id, map: [], desc: '', cost: '', unlock: '', comment: '' }
      expect(matchFishCategories(good)).toContain('fishing')
    }
  })
})
