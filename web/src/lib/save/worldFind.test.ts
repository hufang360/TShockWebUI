import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildWorld } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from './worldFile'
import { findMatches, targetKey, type FindTarget } from './worldFind'

const parsed = (bytes: Uint8Array) => parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
/** 只找图格时的简写。 */
const tiles = (...ids: number[]): FindTarget[] => ids.map((id) => ({ kind: 'tile', id }))

describe('查找图格：findTiles', () => {
  it('精确命中坐标（含 RLE 重复出来的每一格）', async () => {
    // 10×6：第 0 列整列是生命水晶（图格 12，RLE 5），第 1 列上半是空气、下半是石头
    const bytes = buildWorld({
      width: 10,
      height: 6,
      tiles: (x, y) => {
        if (x === 0) return { typ: 12, repeat: 5 }
        return y < 3 ? { typ: -1 } : { typ: 1, repeat: 2 }
      },
    })
    const world = parsed(bytes)
    const res = await findMatches(bytes, world, tiles(12))
    expect(res.counts.get('tile:12')).toBe(6)
    expect(res.truncated).toBe(false)
    expect(res.hits).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 0, y: 4 },
      { x: 0, y: 5 },
    ])
  })

  it('多个目标一起扫，各自计数', async () => {
    const bytes = buildWorld({
      width: 4,
      height: 4,
      tiles: (x) => ({ typ: x === 0 ? 12 : 1, repeat: 3 }),
    })
    const res = await findMatches(bytes, parsed(bytes), tiles(12, 1))
    expect(res.counts.get('tile:12')).toBe(4)
    expect(res.counts.get('tile:1')).toBe(12)
    expect(res.hits).toHaveLength(16)
  })

  it('命中数超过 limit 时截断坐标但计数仍是真值', async () => {
    const bytes = buildWorld({ width: 10, height: 10, tiles: () => ({ typ: 1, repeat: 9 }) })
    const res = await findMatches(bytes, parsed(bytes), tiles(1), { limit: 25 })
    expect(res.counts.get('tile:1')).toBe(100)
    expect(res.hits).toHaveLength(25)
    expect(res.truncated).toBe(true)
  })

  it('找不到就是 0，不抛错', async () => {
    const bytes = buildWorld({ width: 4, height: 4, tiles: () => ({ typ: 1, repeat: 3 }) })
    const res = await findMatches(bytes, parsed(bytes), tiles(12))
    expect(res.counts.get('tile:12')).toBeUndefined()
    expect(res.hits).toEqual([])
    expect(res.truncated).toBe(false)
  })

  it('空目标列表直接返回（不扫描）', async () => {
    const bytes = buildWorld({ width: 4, height: 4, tiles: () => ({ typ: 1, repeat: 3 }) })
    const res = await findMatches(bytes, parsed(bytes), [])
    expect(res.hits).toEqual([])
    expect(res.counts.size).toBe(0)
  })

  it('也能找墙与液体（同一趟解码）', async () => {
    // 上半是水，下半石头 + 墙 2
    const bytes = buildWorld({
      width: 6,
      height: 6,
      tiles: (_x, y) => (y < 3 ? { typ: -1, liquid: 1, liquidAmount: 255 } : { typ: 1, wall: 2 }),
    })
    const world = parsed(bytes)
    const res = await findMatches(bytes, world, [
      { kind: 'liquid', id: 1 },
      { kind: 'wall', id: 2 },
    ])
    expect(res.counts.get(targetKey({ kind: 'liquid', id: 1 }))).toBe(18)
    expect(res.counts.get(targetKey({ kind: 'wall', id: 2 }))).toBe(18)
    expect(res.hits).toHaveLength(36)
  })

  it('真实 demo 世界（空白）：石头能扫到、生命水晶 0 处', async () => {
    const bytes = new Uint8Array(readFileSync('public/demo/world.wld'))
    const world = parsed(bytes)
    const stone = await findMatches(bytes, world, tiles(1), { limit: 10 })
    expect(stone.counts.get('tile:1')).toBeGreaterThan(0)
    expect(stone.hits).toHaveLength(10)
    expect(stone.truncated).toBe(true)

    const heart = await findMatches(bytes, world, tiles(12))
    expect(heart.counts.get('tile:12')).toBeUndefined()
  })
})
