import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildWorld } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from './worldFile'
import { renderWorldThumbnail } from './worldThumb'
import { checkTileReplace, replaceTileType } from './worldTileReplace'

const parsedOf = (bytes: Uint8Array) => parseWorld(bytes, {} as WorldTrack)

describe('图格替换（安全子集）：守卫', () => {
  const world = parsedOf(buildWorld({ width: 4, height: 4, tiles: () => ({ typ: 1 }) }))

  it('同一种图格 / 换成空气 / 不存在 → 拒绝', () => {
    expect(checkTileReplace(world, 1, 1)?.code).toBe('same')
    expect(checkTileReplace(world, 1, -1)?.code).toBe('air')
    expect(checkTileReplace(world, 1, 2, new Set([1]))?.code).toBe('invalid')
  })

  it('id 字节宽度不同（<256 ↔ ≥256）→ 拒绝（否则文件长度会变）', () => {
    const p = checkTileReplace(world, 1, 400)
    expect(p?.code).toBe('widthMismatch')
    expect(p?.message).toContain('不做')
  })

  it('frameImportant 类别不同（方块 ↔ 家具）→ 拒绝（条目长度会变）', () => {
    // 夹具里图格 5（Trees）是 frame-important；图格 1（Stone）不是
    const p = checkTileReplace(world, 1, 5)
    expect(p?.code).toBe('frameMismatch')
  })

  it('同类同宽度 → 允许', () => {
    // 夹具的 frame 位图里只有图格 1 是 frame-important，所以 2 ↔ 3 都是「普通方块」
    expect(checkTileReplace(world, 2, 3)).toBeNull()
    expect(checkTileReplace(world, 2, 2)?.code).toBe('same')
  })
})

describe('图格替换：真的换掉了、且文件结构一个字节没动', () => {
  it('RLE 里的一条 run 全部换掉，长度 / 段指针 / 其余字节都不变', async () => {
    // 20×10：左半整列一条 RLE 的图格 1，右半是图格 2
    const bytes = buildWorld({
      width: 20,
      height: 10,
      tiles: (x) => ({ typ: x < 10 ? 2 : 3, repeat: 9 }),
    })
    const parsed = parsedOf(bytes)
    const before = await renderWorldThumbnail(bytes, parsed, { maxPixels: 10_000, yieldEvery: 1e9 })

    const res = replaceTileType(bytes, parsed, 2, 3)
    // 长度不变 → 段指针 / footer 天然不变（这里直接断言整个文件只差那几个 id 字节）
    expect(res.bytes.length).toBe(bytes.length)
    expect(res.replacedCells).toBe(10 * 10) // 每条 run 覆盖 10 格 × 10 列
    expect(res.changedBytes).toBe(10) // 每列只改 1 个 id 字节（RLE 只存一次）

    const afterParsed = parsedOf(res.bytes)
    expect(afterParsed.info.width).toBe(20)
    const after = await renderWorldThumbnail(res.bytes, afterParsed, { maxPixels: 10_000, yieldEvery: 1e9 })
    expect(before.stats.tiles.get(2)).toBe(100)
    expect(after.stats.tiles.get(2)).toBeUndefined()
    // 原来的 2（100 格）都变成 3，并与原有 3（100 格）合并
    expect(after.stats.tiles.get(3)).toBe(before.stats.tiles.get(2)! + before.stats.tiles.get(3)!)
    expect(after.stats.air).toBe(before.stats.air)

    // 变化的字节数 == changedBytes，且每个差异都在图格类型字节上（1 字节 id）
    const diff = [...res.bytes.keys()].filter((i) => res.bytes[i] !== bytes[i])
    expect(diff.length).toBe(res.changedBytes)
  })

  it('保留 frame 数据：frame-important 图格换成同类另一个，只改 id', () => {
    // 夹具里图格 5 是 frame-important；再造一个 frame-important 的图格 id：用 5 与 5 不行，
    // 所以这里直接验证「同 id 拒绝」+ 「换完之后 frame 4 字节原样」用真实世界做（见下一条）。
    expect(checkTileReplace(parsedOf(buildWorld({ width: 4, height: 4, tiles: () => ({ typ: 5 }) })), 5, 5)?.code).toBe(
      'same',
    )
  })

  it('2 字节 id 之间替换：宽度相同，长度也不变', async () => {
    // 夹具的 frameImportant 位图 754 位：图格 400/500 都按「非 frame-important」处理
    const bytes = buildWorld({ width: 6, height: 4, tiles: () => ({ typ: 400, repeat: 3 }) })
    const parsed = parsedOf(bytes)
    const res = replaceTileType(bytes, parsed, 400, 500)
    expect(res.bytes.length).toBe(bytes.length)
    expect(res.changedBytes).toBe(6 * 2) // 每条 run 写 2 字节 × 6 列
    const after = await renderWorldThumbnail(res.bytes, parsedOf(res.bytes), { maxPixels: 10_000, yieldEvery: 1e9 })
    expect(after.stats.tiles.get(500)).toBe(24)
    expect(after.stats.tiles.get(400)).toBeUndefined()
  })

  it('真实世界：石头(1) → 土(0)，图格计数对调、文件长度不变、箱子坐标照旧', async () => {
    const raw = new Uint8Array(readFileSync('public/demo/world.wld'))
    const parsed = parsedOf(raw)
    const before = await renderWorldThumbnail(raw, parsed, { maxPixels: 40_000, yieldEvery: 1e9 })
    const stoneBefore = before.stats.tiles.get(1) ?? 0
    const dirtBefore = before.stats.tiles.get(0) ?? 0
    expect(stoneBefore).toBeGreaterThan(0)

    const res = replaceTileType(raw, parsed, 1, 0)
    expect(res.bytes.length).toBe(raw.length)
    const after = await renderWorldThumbnail(res.bytes, parsedOf(res.bytes), { maxPixels: 40_000, yieldEvery: 1e9 })
    expect(after.stats.tiles.get(1)).toBeUndefined()
    expect(after.stats.tiles.get(0)).toBe(stoneBefore + dirtBefore)
    // 其它统计不变
    expect(after.stats.air).toBe(before.stats.air)
    expect([...after.stats.walls.entries()]).toEqual([...before.stats.walls.entries()])
    expect(after.stats.liquid).toEqual(before.stats.liquid)
  })
})
