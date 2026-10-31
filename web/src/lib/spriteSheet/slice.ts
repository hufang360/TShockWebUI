/**
 * 精灵图（spritesheet）切片的**纯计算**。
 *
 * 一张 PNG 按「行 × 列」切成若干帧；可选边距（margin，四周留白）与间距（gap，格子之间的缝）。
 * 默认矩形按浮点均分后 `round` 到边界，奇数尺寸不会漏像素、也不会互相重叠。
 * 逐片微调存在**覆盖表**（`index → SliceRect`）里，不在表里就用默认矩形。
 *
 * 这里不碰 DOM / canvas：预览与导出只消费这些矩形，方便单测。
 */

export interface SliceRect {
  x: number
  y: number
  w: number
  h: number
}

/** 网格参数（行列 + 边距 / 间距）。 */
export interface SliceGrid {
  rows: number
  cols: number
  margin: number
  gap: number
}

export interface SheetSize {
  width: number
  height: number
}

/** 行列上限：超过它多半是误输入（也会让预览与列表不可用）。 */
export const MAX_GRID = 256

export const DEFAULT_GRID: SliceGrid = { rows: 1, cols: 1, margin: 0, gap: 0 }

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 把数字输入规范化成整数并夹到合法范围（`undefined` / `NaN` 用兜底值）。 */
export function toInt(value: unknown, fallback: number, min: number, max: number): number {
  // 输入框被删空时保持原值（`Number('') === 0` 会把行列瞬间改成 1）
  if (typeof value === 'string' && value.trim() === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return clamp(Math.round(n), min, max)
}

export function normalizeGrid(grid: Partial<SliceGrid> | null | undefined): SliceGrid {
  const rows = toInt(grid?.rows, DEFAULT_GRID.rows, 1, MAX_GRID)
  const cols = toInt(grid?.cols, DEFAULT_GRID.cols, 1, MAX_GRID)
  const margin = toInt(grid?.margin, 0, 0, 1_000_000)
  const gap = toInt(grid?.gap, 0, 0, 1_000_000)
  return { rows, cols, margin, gap }
}

/**
 * 一维边界：`count + 1` 个坐标（最后一个贴住 `total - margin`）。
 * 末尾强制贴边是为了不让 `round` 的累积误差吃掉最后 1px。
 */
function axisEdges(total: number, count: number, margin: number, gap: number): number[] {
  const usable = Math.max(1, total - margin * 2 - gap * (count - 1))
  const cell = usable / count
  const edges: number[] = []
  for (let i = 0; i <= count; i += 1) edges.push(Math.round(margin + i * (cell + gap)))
  edges[count] = Math.max(edges[count - 1] + 1, total - margin)
  return edges
}

/** 默认切片矩形（行优先：`index = row * cols + col`）。 */
export function defaultSlices(size: SheetSize, grid: SliceGrid): SliceRect[] {
  const g = normalizeGrid(grid)
  const xs = axisEdges(size.width, g.cols, g.margin, g.gap)
  const ys = axisEdges(size.height, g.rows, g.margin, g.gap)
  const out: SliceRect[] = []
  for (let row = 0; row < g.rows; row += 1) {
    for (let col = 0; col < g.cols; col += 1) {
      const x0 = xs[col]
      const x1 = col === g.cols - 1 ? xs[g.cols] : xs[col + 1] - g.gap
      const y0 = ys[row]
      const y1 = row === g.rows - 1 ? ys[g.rows] : ys[row + 1] - g.gap
      out.push({
        x: clamp(x0, 0, Math.max(0, size.width - 1)),
        y: clamp(y0, 0, Math.max(0, size.height - 1)),
        w: Math.max(1, x1 - x0),
        h: Math.max(1, y1 - y0),
      })
    }
  }
  return out
}

/** 单元格平均尺寸（展示用；实际每格可能差 1px）。 */
export function cellSize(size: SheetSize, grid: SliceGrid): { w: number; h: number } {
  const g = normalizeGrid(grid)
  const usableW = size.width - g.margin * 2 - g.gap * (g.cols - 1)
  const usableH = size.height - g.margin * 2 - g.gap * (g.rows - 1)
  return {
    w: Math.max(1, Math.round(usableW / g.cols)),
    h: Math.max(1, Math.round(usableH / g.rows)),
  }
}

export function sliceIndex(row: number, col: number, cols: number): number {
  return row * cols + col
}

/** 切片文件名（行 / 列从 1 起）：`r2c3`。 */
export function sliceName(index: number, cols: number): string {
  const safeCols = Math.max(1, cols)
  const row = Math.floor(index / safeCols) + 1
  const col = (index % safeCols) + 1
  return `r${row}c${col}`
}

/** 把矩形夹进图片范围内，并保证至少 1×1。 */
export function clampRect(rect: SliceRect, size: SheetSize): SliceRect {
  const x = clamp(Math.round(rect.x), 0, Math.max(0, size.width - 1))
  const y = clamp(Math.round(rect.y), 0, Math.max(0, size.height - 1))
  const w = clamp(Math.round(rect.w), 1, Math.max(1, size.width - x))
  const h = clamp(Math.round(rect.h), 1, Math.max(1, size.height - y))
  return { x, y, w, h }
}

/** 应用覆盖表：没有覆盖的切片用默认矩形。 */
export function resolveSlices(
  size: SheetSize,
  grid: SliceGrid,
  overrides: ReadonlyMap<number, SliceRect>,
): SliceRect[] {
  const base = defaultSlices(size, grid)
  if (overrides.size === 0) return base
  return base.map((rect, index) => {
    const override = overrides.get(index)
    return override ? clampRect(override, size) : rect
  })
}

/** 该点落在哪个切片里（从后往前找，微调后重叠时以更靠后的为准）；没命中返回 `null`。 */
export function hitTest(rects: SliceRect[], x: number, y: number): number | null {
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const r = rects[i]
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i
  }
  return null
}

/** 某张微调后与默认矩形的差异（用于「撤销 / 恢复此切片」判断）；相同返回 `null`。 */
export function rectDelta(base: SliceRect, rect: SliceRect): SliceRect | null {
  if (base.x === rect.x && base.y === rect.y && base.w === rect.w && base.h === rect.h) return null
  return { x: rect.x - base.x, y: rect.y - base.y, w: rect.w - base.w, h: rect.h - base.h }
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * 从图片尺寸猜测行列：假设是**正方形单元格**且整除整图（`side = gcd(W, H)`）。
 * 猜不出（边长为 1px、总数过大）时回退 1×1，交给用户手填。
 */
export function guessGrid(
  size: SheetSize,
  options: { minCell?: number; maxSlices?: number } = {},
): { rows: number; cols: number } {
  const minCell = options.minCell ?? 4
  const maxSlices = options.maxSlices ?? 4096
  const width = Math.max(0, Math.round(size.width))
  const height = Math.max(0, Math.round(size.height))
  if (width === 0 || height === 0) return { rows: 1, cols: 1 }
  const side = gcd(width, height)
  if (side < minCell) return { rows: 1, cols: 1 }
  const cols = width / side
  const rows = height / side
  if (cols * rows > maxSlices) return { rows: 1, cols: 1 }
  return { rows, cols }
}

/**
 * 两个拖拽端点 → 整数矩形（手动框选）。宽或高小于 2px 视为误触，返回 `null`。
 * 结果夹进图片范围。
 */
export function rectFromDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: SheetSize,
): SliceRect | null {
  const x = Math.round(Math.min(from.x, to.x))
  const y = Math.round(Math.min(from.y, to.y))
  const w = Math.round(Math.abs(to.x - from.x))
  const h = Math.round(Math.abs(to.y - from.y))
  if (w < 2 || h < 2) return null
  return clampRect({ x, y, w, h }, size)
}
