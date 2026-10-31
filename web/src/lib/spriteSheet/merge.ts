/**
 * 「合并」tab 的排版（纯函数）：把多张 PNG 按横向 / 纵向 / 网格拼成一张精灵图。
 *
 * 规则（简单可预期，不做缩放）：
 * - `row`：依次横排，行高 = 最大高度，每张在自己的格子里**垂直居中**；
 * - `column`：依次竖排，列宽 = 最大宽度，水平居中；
 * - `grid`：固定列数，单元格 = 最大宽 × 最大高，图在格子里居中。
 */

export type MergeDirection = 'row' | 'column' | 'grid'

export interface MergeItem {
  width: number
  height: number
}

export interface MergeOptions {
  direction: MergeDirection
  /** `grid` 用；其它方向忽略。 */
  columns: number
  gap: number
}

export interface MergePlacement {
  index: number
  x: number
  y: number
  w: number
  h: number
}

export interface MergeLayout {
  width: number
  height: number
  placements: MergePlacement[]
}

const EMPTY: MergeLayout = { width: 0, height: 0, placements: [] }

export function mergeLayout(items: MergeItem[], options: MergeOptions): MergeLayout {
  if (items.length === 0) return EMPTY
  const gap = Math.max(0, Math.round(options.gap))
  const maxW = Math.max(...items.map((item) => Math.max(1, Math.round(item.width))))
  const maxH = Math.max(...items.map((item) => Math.max(1, Math.round(item.height))))

  if (options.direction === 'row') {
    const placements: MergePlacement[] = []
    let x = 0
    items.forEach((item, index) => {
      const w = Math.max(1, Math.round(item.width))
      const h = Math.max(1, Math.round(item.height))
      placements.push({ index, x, y: Math.round((maxH - h) / 2), w, h })
      x += w + gap
    })
    return { width: Math.max(0, x - gap), height: maxH, placements }
  }

  if (options.direction === 'column') {
    const placements: MergePlacement[] = []
    let y = 0
    items.forEach((item, index) => {
      const w = Math.max(1, Math.round(item.width))
      const h = Math.max(1, Math.round(item.height))
      placements.push({ index, x: Math.round((maxW - w) / 2), y, w, h })
      y += h + gap
    })
    return { width: maxW, height: Math.max(0, y - gap), placements }
  }

  const columns = Math.max(1, Math.round(options.columns))
  const placements: MergePlacement[] = []
  items.forEach((item, index) => {
    const w = Math.max(1, Math.round(item.width))
    const h = Math.max(1, Math.round(item.height))
    const col = index % columns
    const row = Math.floor(index / columns)
    placements.push({
      index,
      x: col * (maxW + gap) + Math.round((maxW - w) / 2),
      y: row * (maxH + gap) + Math.round((maxH - h) / 2),
      w,
      h,
    })
  })
  const rows = Math.ceil(items.length / columns)
  return {
    width: columns * maxW + (columns - 1) * gap,
    height: rows * maxH + (rows - 1) * gap,
    placements,
  }
}
