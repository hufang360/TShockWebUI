/**
 * 浮动终端的窗口几何（纯函数，便于单测）。
 *
 * - 桌面端默认贴在右下角，位置 / 尺寸由玩家拖动与缩放后写入 `tswui:terminal`；
 * - 任何恢复都要先 clamp：换小屏、浏览器窗口缩小、改了缩放比例都不能让窗口跑到视口外。
 */

export interface TerminalRect {
  x: number
  y: number
  w: number
  h: number
}

export const TERMINAL_DEFAULT_W = 460
export const TERMINAL_DEFAULT_H = 560
/** 最小尺寸：再小放不下「补全下拉（最高 18rem）+ 输入框」。 */
export const TERMINAL_MIN_W = 340
export const TERMINAL_MIN_H = 420
/** 与视口边缘的最小留白。 */
export const TERMINAL_MARGIN = 8
/** 默认位置与右下角的距离。 */
export const TERMINAL_EDGE_GAP = 24

/** lo > hi（视口比最小尺寸还小）时退到 lo，避免出现负宽 / 负高。 */
function clampValue(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), Math.max(lo, hi))
}

export function defaultTerminalRect(viewportWidth: number, viewportHeight: number): TerminalRect {
  const w = clampValue(TERMINAL_DEFAULT_W, TERMINAL_MIN_W, viewportWidth - TERMINAL_MARGIN * 2)
  const h = clampValue(TERMINAL_DEFAULT_H, TERMINAL_MIN_H, viewportHeight - TERMINAL_MARGIN * 2)
  return {
    x: Math.max(TERMINAL_MARGIN, viewportWidth - w - TERMINAL_EDGE_GAP),
    y: Math.max(TERMINAL_MARGIN, viewportHeight - h - TERMINAL_EDGE_GAP),
    w,
    h,
  }
}

/** 把窗口夹进视口：先限尺寸，再限位置（保证整窗可见）。 */
export function clampTerminalRect(
  rect: TerminalRect,
  viewportWidth: number,
  viewportHeight: number,
): TerminalRect {
  const w = clampValue(rect.w, TERMINAL_MIN_W, viewportWidth - TERMINAL_MARGIN * 2)
  const h = clampValue(rect.h, TERMINAL_MIN_H, viewportHeight - TERMINAL_MARGIN * 2)
  const x = clampValue(rect.x, TERMINAL_MARGIN, viewportWidth - w - TERMINAL_MARGIN)
  const y = clampValue(rect.y, TERMINAL_MARGIN, viewportHeight - h - TERMINAL_MARGIN)
  return { x, y, w, h }
}

/** 从 localStorage 恢复：非法 / 旧格式一律返回 null，交给默认位置。 */
export function sanitizeTerminalRect(value: unknown): TerminalRect | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const read = (key: keyof TerminalRect): number | null => {
    const n = raw[key]
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  const x = read('x')
  const y = read('y')
  const w = read('w')
  const h = read('h')
  if (x === null || y === null || w === null || h === null) return null
  return { x, y, w, h }
}
