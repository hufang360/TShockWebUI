// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  AWNING_BLUE,
  AWNING_HEIGHT,
  AWNING_SLOT,
  AWNING_WHITE,
  buildAwningStrips,
} from '@/lib/fishAwning'

/** 路径格式固定：M上左 L上右 L下右 A半径 半径 0 0 1 下左 Z。 */
const PATH =
  /^M(-?[\d.]+) 0L(-?[\d.]+) 0L(-?[\d.]+) (-?[\d.]+)A([\d.]+) [\d.]+ 0 0 1 (-?[\d.]+) (-?[\d.]+)Z$/

function parse(path: string) {
  const m = PATH.exec(path)
  if (!m) throw new Error(`看不懂的路径：${path}`)
  return {
    topLeft: { x: Number(m[1]), y: 0 },
    topRight: { x: Number(m[2]), y: 0 },
    bottomRight: { x: Number(m[3]), y: Number(m[4]) },
    bottomLeft: { x: Number(m[6]), y: Number(m[7]) },
    r: Number(m[5]),
  }
}

describe('鱼店遮阳伞布条几何', () => {
  it('蓝白相间、紧挨着排：一个布位 = 一条蓝 + 一条白', () => {
    const strips = buildAwningStrips(1000)
    expect(strips.length).toBeGreaterThan(10)
    // 两端会被画布挡掉，所以从中间随便挑一对相邻的看
    const firstBlue = strips.findIndex((strip) => strip.tone === 'blue')
    expect(firstBlue).toBeGreaterThanOrEqual(0)
    expect(strips[firstBlue + 1].tone).toBe('white')

    // 中间那些（两端会被画布边界挡掉）宽度固定为 33 / 24，且相邻两条共用一条缝
    const blue = strips.slice(1, -2).filter((strip) => strip.tone === 'blue')
    for (const strip of blue) {
      const { topLeft, topRight } = parse(strip.d)
      expect(topRight.x - topLeft.x).toBeCloseTo(AWNING_BLUE, 1)
    }
    const pairStart = strips.findIndex((strip, i) => strip.tone === 'blue' && strips[i + 1]?.tone === 'white')
    const white = strips[pairStart + 1]
    const { topRight: blueRight } = parse(strips[pairStart].d)
    const { topLeft: whiteLeft } = parse(white.d)
    expect(whiteLeft.x).toBeCloseTo(blueRight.x, 1)
    expect(parse(white.d).topRight.x - whiteLeft.x).toBeCloseTo(AWNING_WHITE, 1)
    // 下一个布位：距离 = 布位宽
    expect(parse(strips[pairStart + 2].d).topLeft.x - parse(strips[pairStart].d).topLeft.x).toBeCloseTo(
      AWNING_SLOT,
      1,
    )
  })

  it('每条布下端收成半圆：半径 = 底宽一半，圆心到底边正好一个半径', () => {
    for (const strip of buildAwningStrips(1000).slice(1, -1)) {
      const { bottomLeft, bottomRight, r } = parse(strip.d)
      expect(r).toBeCloseTo((bottomRight.x - bottomLeft.x) / 2, 1)
      expect(strip.arc.r).toBeCloseTo(r, 1)
      expect(strip.arc.cy).toBeCloseTo(AWNING_HEIGHT - r, 1)
    }
  })

  it('布条从正上方的消失点放射下来：中间竖直、越靠两端越往外斜', () => {
    const strips = buildAwningStrips(1000)
    const lean = (strip: (typeof strips)[number]) => {
      const { topLeft, bottomLeft } = parse(strip.d)
      return bottomLeft.x - topLeft.x
    }
    const quarter = Math.floor(strips.length / 4)
    const middle = strips[Math.floor(strips.length / 2)]
    const left = strips[quarter]
    const right = strips[strips.length - 1 - quarter]

    expect(Math.abs(lean(middle))).toBeLessThan(1.5)
    expect(lean(left)).toBeLessThan(-4)
    expect(lean(right)).toBeGreaterThan(4)
    // 左右对称（布位是整数排的，两侧留白不一定完全一样，留 2px 余量）
    expect(Math.abs(lean(left) + lean(right))).toBeLessThan(2)
  })

  it('所有布条都落在画布内（两端留白，不切半条）', () => {
    const width = 1000
    for (const strip of buildAwningStrips(width)) {
      const { topLeft, topRight, bottomLeft, bottomRight } = parse(strip.d)
      for (const x of [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(width)
      }
    }
  })

  it('宽度为 0 时不生成布条（还没量到尺寸 / jsdom 不排版）', () => {
    expect(buildAwningStrips(0)).toEqual([])
  })
})
