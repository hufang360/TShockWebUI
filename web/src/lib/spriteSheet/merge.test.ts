import { describe, expect, it } from 'vitest'
import { mergeLayout } from './merge'

const items = [
  { width: 10, height: 6 },
  { width: 4, height: 8 },
  { width: 6, height: 4 },
]

describe('mergeLayout', () => {
  it('空列表返回 0×0', () => {
    expect(mergeLayout([], { direction: 'row', columns: 3, gap: 0 })).toEqual({
      width: 0,
      height: 0,
      placements: [],
    })
  })

  it('横向：行高 = 最大高度，各自垂直居中', () => {
    const layout = mergeLayout(items, { direction: 'row', columns: 3, gap: 2 })
    expect(layout.height).toBe(8)
    expect(layout.width).toBe(10 + 2 + 4 + 2 + 6)
    expect(layout.placements).toEqual([
      { index: 0, x: 0, y: 1, w: 10, h: 6 },
      { index: 1, x: 12, y: 0, w: 4, h: 8 },
      { index: 2, x: 18, y: 2, w: 6, h: 4 },
    ])
  })

  it('纵向：列宽 = 最大宽度，各自水平居中', () => {
    const layout = mergeLayout(items, { direction: 'column', columns: 3, gap: 3 })
    expect(layout.width).toBe(10)
    expect(layout.height).toBe(6 + 3 + 8 + 3 + 4)
    expect(layout.placements[1]).toEqual({ index: 1, x: 3, y: 9, w: 4, h: 8 })
  })

  it('网格：固定列数，单元格 = 最大宽 × 最大高，居中', () => {
    const layout = mergeLayout(items, { direction: 'grid', columns: 2, gap: 4 })
    expect(layout.width).toBe(10 * 2 + 4)
    expect(layout.height).toBe(8 * 2 + 4)
    expect(layout.placements).toEqual([
      { index: 0, x: 0, y: 1, w: 10, h: 6 },
      { index: 1, x: 17, y: 0, w: 4, h: 8 },
      { index: 2, x: 2, y: 14, w: 6, h: 4 },
    ])
  })

  it('间距 / 列数为负数时按 0 / 1 处理', () => {
    const layout = mergeLayout(items, { direction: 'grid', columns: -5, gap: -10 })
    expect(layout.width).toBe(10)
    // 列数夹到 1：第二张也落在第 1 列，水平居中（(10-4)/2 = 3）
    expect(layout.placements[1].x).toBe(3)
  })
})
