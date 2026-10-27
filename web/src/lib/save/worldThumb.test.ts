import { describe, expect, it, vi } from 'vitest'
import { buildWorld } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from './worldFile'
import { renderWorldThumbnail } from './worldThumb'

const rgbaAt = (thumb: { width: number; pixels: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * thumb.width + x) * 4
  return [thumb.pixels[i], thumb.pixels[i + 1], thumb.pixels[i + 2], thumb.pixels[i + 3]]
}

const SKY = [0x9b, 0xd1, 0xff, 255]
const SPACE = [0x33, 0x66, 0x99, 255]
const DIRT = [0x97, 0x6b, 0x4b, 255]
const STONE = [0x80, 0x80, 0x80, 255]
const WATER = [0x00, 0x0c, 0xff, 255]

describe('世界缩略图渲染（本地）', () => {
  it('按图格 / 液体 / 深度背景取色', async () => {
    const width = 200
    const height = 600
    const data = buildWorld({
      width,
      height,
      groundLevel: 300,
      rockLevel: 450,
      tiles: (x, y) => {
        if (y < 80) return { typ: -1 } // 太空 / 天空
        if (y < 300) return { typ: -1 }
        if (y < 450) return { typ: 0 } // 泥土（地表层）
        if (x < 10) return { typ: -1, liquid: 1, liquidAmount: 255 } // 水（岩石层）
        return { typ: 1 } // 石头（帧化，带 UV）
      },
    })
    const parsed = parseWorld(data)
    const thumb = await renderWorldThumbnail(data, parsed, { yieldEvery: 1000 })
    expect(thumb.width).toBe(200)
    expect(thumb.height).toBe(600)

    const at = (x: number, y: number) => rgbaAt(thumb, x, y)
    expect(at(150, 10)).toEqual(SPACE)
    expect(at(150, 200)).toEqual(SKY)
    expect(at(150, 400)).toEqual(DIRT)
    expect(at(5, 500)).toEqual(WATER)
    expect(at(150, 500)).toEqual(STONE)
  })

  it('墙比背景优先、图格比墙优先', async () => {
    const data = buildWorld({
      width: 40,
      height: 40,
      tiles: (_x, y) => (y < 20 ? { typ: -1, wall: 1 } : { typ: 0, wall: 1 }),
    })
    const parsed = parseWorld(data)
    const thumb = await renderWorldThumbnail(data, parsed)
    expect(rgbaAt(thumb, 10, 5)).toEqual([0x34, 0x34, 0x34, 255]) // Stone 墙
    expect(rgbaAt(thumb, 10, 30)).toEqual(DIRT) // 泥土盖住墙
  })

  it('透明墙（玻璃 / 栅栏）不画成灰块，保留背景', async () => {
    // 21 = Glass 墙（颜色表里没有颜色 = 透明）；1 = Stone 墙。
    const data = buildWorld({
      width: 20,
      height: 600,
      groundLevel: 300,
      rockLevel: 450,
      tiles: (_x, y) => (y < 400 ? { typ: -1, wall: 21 } : { typ: -1, wall: 1 }),
    })
    const parsed = parseWorld(data)
    const thumb = await renderWorldThumbnail(data, parsed)
    // 玻璃墙：露出深度背景（地表层土色），不是中性灰。
    expect(rgbaAt(thumb, 10, 350)).toEqual([0x54, 0x39, 0x2a, 255])
    // 石头墙正常上色。
    expect(rgbaAt(thumb, 10, 500)).toEqual([0x34, 0x34, 0x34, 255])
  })

  it('RLE 重复铺满整列，且不会串到下一列', async () => {
    const height = 600
    const data = buildWorld({
      width: 8,
      height,
      tiles: (_x, y) => {
        if (y === 1) return { typ: 0, repeat: 597 } // y=1..598 都是泥土
        return { typ: -1 }
      },
    })
    const parsed = parseWorld(data)
    const thumb = await renderWorldThumbnail(data, parsed)
    for (let x = 0; x < 8; x++) {
      expect(rgbaAt(thumb, x, 300)).toEqual(DIRT)
      expect(rgbaAt(thumb, x, 1)).toEqual(DIRT)
      expect(rgbaAt(thumb, x, 598)).toEqual(DIRT)
      expect(rgbaAt(thumb, x, 0)).not.toEqual(DIRT)
      expect(rgbaAt(thumb, x, 599)).not.toEqual(DIRT)
    }
  })

  it('大世界按像素预算降采样（不会再糊成一张小图），并回调进度', async () => {
    const onProgress = vi.fn()
    const data = buildWorld({
      width: 4200,
      height: 1200,
      tiles: (_x, y) => (y < 300 ? { typ: -1 } : { typ: 0 }),
    })
    const parsed = parseWorld(data)
    // 4200×1200 = 5.04M 图格 < 8M 预算 → 1 图格 = 1 像素（原尺寸）。
    const thumb = await renderWorldThumbnail(data, parsed, { onProgress, yieldEvery: 512 })
    expect(thumb.width).toBe(4200)
    expect(thumb.height).toBe(1200)
    expect(thumb.pixels.length).toBe(thumb.width * thumb.height * 4)
    expect(onProgress).toHaveBeenCalled()
    expect(onProgress.mock.calls.at(-1)?.[0]).toBe(1)

    // 预算收紧后自动降采样（每块 res 图格取一个颜色），仍不超过预算与单边上限。
    const small = await renderWorldThumbnail(data, parsed, { maxPixels: 500_000 })
    expect(small.width * small.height).toBeLessThanOrEqual(500_000)
    expect(small.width).toBe(1050) // res = ceil(sqrt(5.04M / 500k)) = 4 → 4200/4
    expect(small.height).toBe(300)
  })
})

describe('颜色表：1.4.5 新增图格', () => {
  it('753（GiantTiki）按游戏公式从 158 推导：逐通道 ×0.95', async () => {
    const { TILE_COLORS } = await import('./worldColors.generated')
    const t158 = TILE_COLORS[158]
    const ch = (v: number) => Math.min(255, Math.round(v * 0.95))
    const expected = (ch((t158 >> 16) & 0xff) << 16) | (ch((t158 >> 8) & 0xff) << 8) | ch(t158 & 0xff)
    expect(TILE_COLORS[753]).toBe(expected)
    expect(TILE_COLORS[753]).not.toBe(0)
  })

  it('游戏本身没给颜色的图格保持 0（由渲染层退回中性灰）', async () => {
    const { TILE_COLORS } = await import('./worldColors.generated')
    for (const id of [127, 135, 210, 428, 504, 541]) {
      expect(TILE_COLORS[id]).toBe(0)
    }
  })

  it('表长覆盖到 753（GiantTiki 是当前最大图格 id）', async () => {
    const { TILE_COLORS } = await import('./worldColors.generated')
    expect(TILE_COLORS.length).toBeGreaterThan(753)
  })
})

describe('高清导出：强制 1 图格 = 1 像素', () => {
  it('res: 1 → 输出尺寸等于世界尺寸（不降级），像素统计与缩略图一致', async () => {
    const bytes = buildWorld({ width: 300, height: 120, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, {} as WorldTrack)
    const normal = await renderWorldThumbnail(bytes, parsed, { maxPixels: 1_000, yieldEvery: 1e9 })
    const hires = await renderWorldThumbnail(bytes, parsed, { res: 1, yieldEvery: 1e9 })
    // 默认预算很小 → 会降级；高清必须是原尺寸
    expect(normal.width).toBeLessThan(300)
    expect(hires.width).toBe(300)
    expect(hires.height).toBe(120)
    expect(hires.pixels.length).toBe(300 * 120 * 4)
    // 统计与分辨率无关（同一次解码）
    expect([...hires.stats.tiles.entries()]).toEqual([...normal.stats.tiles.entries()])
  })

  it('res 小于 1 或非整数时按安全值处理（不会算出 0 宽）', async () => {
    const bytes = buildWorld({ width: 10, height: 6, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, {} as WorldTrack)
    const weird = await renderWorldThumbnail(bytes, parsed, { res: 0.5, yieldEvery: 1e9 })
    expect(weird.width).toBeGreaterThan(0)
    expect(weird.height).toBeGreaterThan(0)
  })
})
