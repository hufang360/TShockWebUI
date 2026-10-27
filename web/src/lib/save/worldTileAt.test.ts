import { describe, expect, it } from 'vitest'
import { buildWorld } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from './worldFile'
import { renderWorldThumbnail } from './worldThumb'
import { tileAt } from './worldTileAt'

async function prepared(spec: Parameters<typeof buildWorld>[0]) {
  const bytes = buildWorld(spec)
  const parsed = parseWorld(bytes, {} as WorldTrack)
  const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 100_000, recordColumnOffsets: true })
  return { bytes, parsed, offsets: thumb.columnOffsets! }
}

describe('tileAt（悬停看这一格）', () => {
  it('读得到图格 / 墙 / 液体，空气是 -1', async () => {
    // 8×4：左半石头（带墙 2），右半空气；第 2 行起有 3 格水
    const { bytes, parsed, offsets } = await prepared({
      width: 8,
      height: 4,
      tiles: (x) => (x < 4 ? { typ: 1, wall: 2 } : { typ: -1, liquid: 1, liquidAmount: 200 }),
    })
    expect(tileAt(bytes, parsed, offsets, 0, 0)).toMatchObject({ tile: 1, wall: 2, liquid: 0 })
    expect(tileAt(bytes, parsed, offsets, 3, 3)).toMatchObject({ tile: 1, wall: 2 })
    const air = tileAt(bytes, parsed, offsets, 5, 0)!
    expect(air.tile).toBe(-1)
    expect(air.liquid).toBe(1)
    expect(air.liquidAmount).toBe(200)
    void 2
  })

  it('RLE 覆盖的每一行都能取到（同列向下重复）', async () => {
    // 1×6：整列一条 RLE(5) 的图格 2
    const { bytes, parsed, offsets } = await prepared({
      width: 1,
      height: 6,
      tiles: () => ({ typ: 2, repeat: 5 }),
    })
    for (let y = 0; y < 6; y++) expect(tileAt(bytes, parsed, offsets, 0, y)?.tile).toBe(2)
  })

  it('越界 / 列偏移表不匹配时返回 null（界面据此不显示提示）', async () => {
    const { bytes, parsed, offsets } = await prepared({ width: 4, height: 4, tiles: () => ({ typ: 1 }) })
    expect(tileAt(bytes, parsed, offsets, -1, 0)).toBeNull()
    expect(tileAt(bytes, parsed, offsets, 4, 0)).toBeNull()
    expect(tileAt(bytes, parsed, offsets, 0, 4)).toBeNull()
    expect(tileAt(bytes, parsed, offsets, 1.5, 1)).toBeNull()
    expect(tileAt(bytes, parsed, new Int32Array(2), 0, 0)).toBeNull()
  })

  it('没有记录列偏移时 thumb 不带 columnOffsets（不白占内存）', async () => {
    const bytes = buildWorld({ width: 4, height: 4, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, {} as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 10_000 })
    expect(thumb.columnOffsets).toBeUndefined()
  })
})
