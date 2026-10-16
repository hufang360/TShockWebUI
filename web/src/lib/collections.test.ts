import { describe, expect, it } from 'vitest'
import {
  COLLECTION_GROUPS,
  COLLECTIONS_BY_ID,
  ITEM_COLLECTIONS,
  resolveCollectionItems,
} from './collections'
import type { Item } from '@/types'

describe('ITEM_COLLECTIONS', () => {
  it('包含分类 / 职业 / 水友三组且非空', () => {
    for (const group of COLLECTION_GROUPS) {
      expect(ITEM_COLLECTIONS.some((c) => c.group === group)).toBe(true)
    }
  })

  it('每个集合 ID 非空且组内不重复', () => {
    for (const collection of ITEM_COLLECTIONS) {
      expect(collection.ids.length).toBeGreaterThan(0)
      expect(new Set(collection.ids).size).toBe(collection.ids.length)
      expect(collection.id).toBe(`${collection.group}:${collection.name}`)
    }
  })

  it('集合 id 全局唯一，且都能从 COLLECTIONS_BY_ID 取到', () => {
    const ids = ITEM_COLLECTIONS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(COLLECTIONS_BY_ID.get(id)).toBeTruthy()
  })
})

describe('resolveCollectionItems', () => {
  const make = (id: number): Item => ({
    id,
    key: `k${id}`,
    name: `物品${id}`,
    icon: id,
    frames: 1,
    sprite: [16, 16],
    tags: [],
  })

  it('按集合 ID 顺序解析，并跳过数据集缺失的 ID', () => {
    const itemsById = new Map<number, Item>([
      [10, make(10)],
      [30, make(30)],
    ])
    const collection = { id: 'x', name: 'x', group: 'category' as const, ids: [30, 999, 10] }
    expect(resolveCollectionItems(collection, itemsById).map((i) => i.id)).toEqual([30, 10])
  })
})
