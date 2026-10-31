import { describe, expect, it } from 'vitest'
import {
  cellSize,
  clampRect,
  defaultSlices,
  guessGrid,
  hitTest,
  normalizeGrid,
  rectDelta,
  rectFromDrag,
  resolveSlices,
  sliceIndex,
  sliceName,
  toInt,
} from './slice'

describe('normalizeGrid / toInt', () => {
  it('把行列夹到 1..256，边距 / 间距不为负', () => {
    expect(normalizeGrid({ rows: 0, cols: 9999, margin: -5, gap: -1 })).toEqual({
      rows: 1,
      cols: 256,
      margin: 0,
      gap: 0,
    })
    expect(normalizeGrid(undefined)).toEqual({ rows: 1, cols: 1, margin: 0, gap: 0 })
  })

  it('toInt 对空值 / 非数字回退', () => {
    expect(toInt('', 3, 1, 9)).toBe(3)
    expect(toInt('7', 3, 1, 9)).toBe(7)
    expect(toInt(Number.NaN, 3, 1, 9)).toBe(3)
    expect(toInt('42', 3, 1, 9)).toBe(9)
  })
})

describe('defaultSlices', () => {
  it('整除时每格等分', () => {
    const slices = defaultSlices({ width: 512, height: 256 }, { rows: 2, cols: 4, margin: 0, gap: 0 })
    expect(slices).toHaveLength(8)
    expect(slices[0]).toEqual({ x: 0, y: 0, w: 128, h: 128 })
    expect(slices[4]).toEqual({ x: 0, y: 128, w: 128, h: 128 })
    expect(slices[7]).toEqual({ x: 384, y: 128, w: 128, h: 128 })
  })

  it('奇数尺寸不重叠、不漏像素、末尾贴边', () => {
    const size = { width: 101, height: 101 }
    const slices = defaultSlices(size, { rows: 3, cols: 3, margin: 0, gap: 0 })
    const widths = [0, 1, 2].map((c) => slices[c].w)
    const heights = [0, 3, 6].map((i) => slices[i].h)
    expect(widths.reduce((a, b) => a + b, 0)).toBe(size.width)
    expect(heights.reduce((a, b) => a + b, 0)).toBe(size.height)
    expect(slices[0].x).toBe(0)
    expect(slices[2].x + slices[2].w).toBe(size.width)
    const second = slices[1]
    expect(second.x).toBe(slices[0].x + slices[0].w)
  })

  it('边距与间距只吃首尾与间隔', () => {
    const slices = defaultSlices({ width: 100, height: 100 }, { rows: 2, cols: 2, margin: 10, gap: 4 })
    expect(slices[0]).toEqual({ x: 10, y: 10, w: 38, h: 38 })
    expect(slices[1]).toEqual({ x: 52, y: 10, w: 38, h: 38 })
    expect(slices[2]).toEqual({ x: 10, y: 52, w: 38, h: 38 })
    expect(slices[3].x + slices[3].w).toBe(90)
    expect(slices[3].y + slices[3].h).toBe(90)
  })

  it('行优先编号', () => {
    expect(sliceIndex(1, 2, 4)).toBe(6)
    expect(sliceName(6, 4)).toBe('r2c3')
    expect(sliceName(0, 4)).toBe('r1c1')
  })
})

describe('cellSize', () => {
  it('展示用平均尺寸（含边距 / 间距）', () => {
    expect(cellSize({ width: 100, height: 100 }, { rows: 2, cols: 2, margin: 10, gap: 4 })).toEqual({
      w: 38,
      h: 38,
    })
  })
})

describe('clampRect / resolveSlices / hitTest', () => {
  const size = { width: 64, height: 32 }

  it('矩形夹进图片范围且至少 1×1', () => {
    expect(clampRect({ x: -10, y: -5, w: 0, h: 999 }, size)).toEqual({ x: 0, y: 0, w: 1, h: 32 })
    expect(clampRect({ x: 60, y: 20, w: 100, h: 100 }, size)).toEqual({ x: 60, y: 20, w: 4, h: 12 })
  })

  it('覆盖表只影响对应切片', () => {
    const grid = { rows: 1, cols: 2, margin: 0, gap: 0 }
    const overrides = new Map([[1, { x: 40, y: 0, w: 10, h: 10 }]])
    const slices = resolveSlices(size, grid, overrides)
    expect(slices[0]).toEqual({ x: 0, y: 0, w: 32, h: 32 })
    expect(slices[1]).toEqual({ x: 40, y: 0, w: 10, h: 10 })
  })

  it('命中测试按边界含入不含出', () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 },
    ]
    expect(hitTest(rects, 0, 0)).toBe(0)
    expect(hitTest(rects, 9, 9)).toBe(0)
    expect(hitTest(rects, 10, 5)).toBe(1)
    expect(hitTest(rects, 20, 5)).toBeNull()
  })

  it('rectDelta 相同返回 null', () => {
    const rect = { x: 1, y: 2, w: 3, h: 4 }
    expect(rectDelta(rect, { ...rect })).toBeNull()
    expect(rectDelta(rect, { ...rect, x: 2 })).toEqual({ x: 1, y: 0, w: 0, h: 0 })
  })
})

describe('rectFromDrag', () => {
  const size = { width: 64, height: 32 }

  it('反向拖动也能得到正整数矩形', () => {
    expect(rectFromDrag({ x: 40, y: 20 }, { x: 10, y: 4 }, size)).toEqual({
      x: 10,
      y: 4,
      w: 30,
      h: 16,
    })
  })

  it('夹进图片范围', () => {
    expect(rectFromDrag({ x: 50, y: 20 }, { x: 100, y: 60 }, size)).toEqual({
      x: 50,
      y: 20,
      w: 14,
      h: 12,
    })
  })

  it('太小（误触）返回 null', () => {
    expect(rectFromDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, size)).toBeNull()
    expect(rectFromDrag({ x: 1, y: 1 }, { x: 1, y: 1 }, size)).toBeNull()
  })
})

describe('guessGrid', () => {
  it('正方形单元格按最大公约数推算', () => {
    expect(guessGrid({ width: 512, height: 128 })).toEqual({ rows: 1, cols: 4 })
    expect(guessGrid({ width: 100, height: 200 })).toEqual({ rows: 2, cols: 1 })
    expect(guessGrid({ width: 300, height: 200 })).toEqual({ rows: 2, cols: 3 })
  })

  it('正方形整图 / 太小的格子 / 空图回退 1×1', () => {
    expect(guessGrid({ width: 64, height: 64 })).toEqual({ rows: 1, cols: 1 })
    expect(guessGrid({ width: 7, height: 5 })).toEqual({ rows: 1, cols: 1 })
    expect(guessGrid({ width: 0, height: 0 })).toEqual({ rows: 1, cols: 1 })
  })

  it('切片总数过大时回退 1×1（避免误输入变成上万格）', () => {
    expect(guessGrid({ width: 1024, height: 1024 }, { maxSlices: 10 })).toEqual({ rows: 1, cols: 1 })
  })
})
