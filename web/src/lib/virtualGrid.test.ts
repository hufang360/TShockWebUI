import { describe, expect, it } from 'vitest'
import { computeVirtualGrid } from '@/lib/virtualGrid'

/** 图鉴实际参数：格子 52（游戏 Inventory_Back 原始尺寸）+ 间距 8 → 行高 60。 */
const base = { count: 1000, cell: 52, gap: 8, viewportWidth: 1000, viewportHeight: 600, scrollTop: 0 }

describe('computeVirtualGrid', () => {
  it('列数按可视宽度整除（含间距）', () => {
    // floor((1000 + 8) / (52 + 8)) = floor(16.8) = 16
    expect(computeVirtualGrid(base).cols).toBe(16)
    expect(computeVirtualGrid({ ...base, viewportWidth: 600 }).cols).toBe(10)
    // 极窄容器至少 1 列
    expect(computeVirtualGrid({ ...base, viewportWidth: 30 }).cols).toBe(1)
  })

  it('总高度 = 行数 × 行高 − 末尾间距', () => {
    const r = computeVirtualGrid(base) // 1000 / 16 = 63 行
    expect(r.rows).toBe(63)
    expect(r.rowHeight).toBe(60)
    expect(r.totalHeight).toBe(63 * 60 - 8)
  })

  it('顶部：只渲染可视行 + overscan', () => {
    const r = computeVirtualGrid(base)
    expect(r.startRow).toBe(0)
    // floor((0 + 600) / 60) + 2 = 12
    expect(r.endRow).toBe(12)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBe(13 * 16)
    expect(r.offsetTop).toBe(0)
  })

  it('滚动到中部：切片随滚动前移，且带 overscan', () => {
    const r = computeVirtualGrid({ ...base, scrollTop: 3000 })
    expect(r.startRow).toBe(48) // 3000/60 = 50 → −2
    expect(r.endRow).toBe(62) // (3000+600)/60 = 60 → +2，且不超过 rows−1
    expect(r.offsetTop).toBe(48 * 60)
    expect(r.startIndex).toBe(48 * 16)
    // endIndex 会被夹到总数（第 63 行只有 1000 − 62×16 = 8 个）
    expect(r.endIndex).toBe(1000)
  })

  it('滚到底：endRow 被夹在最后一行，endIndex 不超过总数', () => {
    const r = computeVirtualGrid({ ...base, count: 100, scrollTop: 99999 })
    expect(r.endRow).toBe(r.rows - 1)
    expect(r.endIndex).toBe(100)
    expect(r.endIndex).toBeLessThanOrEqual(100)
  })

  it('count = 0：不渲染任何行', () => {
    const r = computeVirtualGrid({ ...base, count: 0 })
    expect(r.rows).toBe(0)
    expect(r.totalHeight).toBe(0)
    expect(r.endRow).toBe(-1)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBe(0)
  })

  it('未测量（jsdom / 首次渲染）：用列数与高度兜底，仍能渲染一屏', () => {
    const r = computeVirtualGrid({ ...base, viewportWidth: 0, viewportHeight: 0, scrollTop: 0 })
    expect(r.cols).toBe(10)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBeGreaterThan(0)
  })

  it('渲染的索引区间始终落在 [0, count) 内', () => {
    for (const scrollTop of [0, 1, 59, 60, 599, 600, 5000, 999999]) {
      for (const count of [0, 1, 7, 100, 6195]) {
        const r = computeVirtualGrid({ ...base, count, scrollTop })
        expect(r.startIndex).toBeGreaterThanOrEqual(0)
        expect(r.endIndex).toBeLessThanOrEqual(count)
        expect(r.startIndex).toBeLessThanOrEqual(r.endIndex)
        // 切片起点对应行不能超出总行数，也不超出滚动内容高度
        expect(r.startRow).toBeLessThanOrEqual(Math.max(0, r.rows - 1))
        expect(r.offsetTop).toBeLessThanOrEqual(r.totalHeight + r.rowHeight)
      }
    }
  })

  it('6195 件全量：DOM 里只需要一屏左右的格子', () => {
    const r = computeVirtualGrid({ ...base, count: 6195 })
    expect(r.rows).toBe(388)
    expect(r.endIndex).toBeLessThan(250)
    expect(r.totalHeight).toBeGreaterThan(23000)
  })
})
