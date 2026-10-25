import { describe, expect, it } from 'vitest'
import {
  TERMINAL_MARGIN,
  TERMINAL_MIN_H,
  TERMINAL_MIN_W,
  clampTerminalRect,
  defaultTerminalRect,
  sanitizeTerminalRect,
} from './terminalWindow'

describe('terminalWindow', () => {
  it('默认贴在右下角并留出边距', () => {
    const rect = defaultTerminalRect(1440, 900)
    expect(rect.w).toBe(460)
    expect(rect.h).toBe(560)
    expect(rect.x).toBe(1440 - 460 - 24)
    expect(rect.y).toBe(900 - 560 - 24)
  })

  it('视口小于默认尺寸时缩到视口内（不超出边距）', () => {
    const rect = defaultTerminalRect(800, 700)
    expect(rect.w).toBeLessThanOrEqual(800 - TERMINAL_MARGIN * 2)
    expect(rect.h).toBeLessThanOrEqual(700 - TERMINAL_MARGIN * 2)
    expect(rect.x).toBeGreaterThanOrEqual(TERMINAL_MARGIN)
    expect(rect.y).toBeGreaterThanOrEqual(TERMINAL_MARGIN)
  })

  it('把越界窗口夹回视口', () => {
    const rect = clampTerminalRect({ x: -500, y: 9999, w: 4000, h: 4000 }, 1280, 800)
    expect(rect.w).toBe(1280 - TERMINAL_MARGIN * 2)
    expect(rect.h).toBe(800 - TERMINAL_MARGIN * 2)
    expect(rect.x).toBe(TERMINAL_MARGIN)
    expect(rect.y).toBe(TERMINAL_MARGIN)
  })

  it('尺寸不会低于最小值（视口够大时）', () => {
    const rect = clampTerminalRect({ x: 40, y: 40, w: 10, h: 10 }, 1280, 800)
    expect(rect.w).toBe(TERMINAL_MIN_W)
    expect(rect.h).toBe(TERMINAL_MIN_H)
  })

  it('恢复非法 / 残缺的持久化数据返回 null', () => {
    expect(sanitizeTerminalRect(null)).toBeNull()
    expect(sanitizeTerminalRect({})).toBeNull()
    expect(sanitizeTerminalRect({ x: 1, y: 2, w: 3 })).toBeNull()
    expect(sanitizeTerminalRect({ x: 'a', y: 2, w: 3, h: 4 })).toBeNull()
    expect(sanitizeTerminalRect({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })
})
