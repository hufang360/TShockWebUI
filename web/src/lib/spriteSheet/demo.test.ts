import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEMO_SHEET_GRID } from './demo'

interface AtlasMeta {
  width: number
  height: number
  padding: number
  count: number
  regions: Record<string, [number, number, number, number]>
}

const atlas: AtlasMeta = (() => {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), '../data/buff-atlas.json'), 'utf8'),
  ) as { meta: Omit<AtlasMeta, 'regions'>; regions: AtlasMeta['regions'] }
  return { ...raw.meta, regions: raw.regions }
})()

describe('Demo 素材（buff 图集）的切分参数', () => {
  it('图集里所有图标都是 32×32（网格切分的前提）', () => {
    const sizes = new Set(Object.values(atlas.regions).map(([, , w, h]) => `${w}×${h}`))
    expect([...sizes]).toEqual(['32×32'])
  })

  it('行列 / 边距 / 间距能正好铺满图集（不切歪、不漏像素）', () => {
    const { rows, cols, margin, gap } = DEMO_SHEET_GRID
    expect(margin).toBe(0)
    expect(cols * 32 + (cols - 1) * gap).toBe(atlas.width)
    expect(rows * 32 + (rows - 1) * gap).toBe(atlas.height)
    expect(gap).toBe(atlas.padding)
  })

  it('格子数够放全部图标，且多出来的格子是空的', () => {
    const { rows, cols } = DEMO_SHEET_GRID
    expect(rows * cols).toBeGreaterThanOrEqual(atlas.count)
    expect(rows * cols - atlas.count).toBeLessThan(cols)
  })
})
