/**
 * 网格虚拟化计算（纯函数）。
 *
 * 图鉴取消翻页后一次展示全部物品（最多 6195 件），逐个挂载 `ItemIcon` 会创建相同数量的 canvas
 * （每张 32×32 贴图在 dpr=2 下约占 16KB），内存与首帧都会爆掉。因此只渲染可视行 + overscan。
 *
 * 约束：格子是**固定像素**（游戏背包格贴图 52×52），行高 = 格子 + 间距，可精确计算，无需测量每行。
 */
export interface VirtualGridInput {
  /** 物品总数 */
  count: number
  /** 格子宽度（px） */
  cell: number
  /** 格子高度（px）；缺省 = 宽度（正方形格子） */
  cellHeight?: number
  /** 格子间距（px） */
  gap: number
  /** 滚动容器可视宽度（px）；≤0 表示尚未测量（jsdom / 首次渲染） */
  viewportWidth: number
  /** 滚动容器可视高度（px）；≤0 同上看 fallbackHeight */
  viewportHeight: number
  /** 当前滚动位置（px） */
  scrollTop: number
  /** 上下各多渲染几行，避免快速滚动露白 */
  overscanRows?: number
  /** 宽度未测量时的列数兜底（仅用于无布局环境） */
  fallbackCols?: number
  /** 高度未测量时的视口高度兜底（仅用于无布局环境） */
  fallbackHeight?: number
}

export interface VirtualGridLayout {
  /** 每行列数 */
  cols: number
  /** 总行数 */
  rows: number
  /** 行高（含间距） */
  rowHeight: number
  /** 滚动内容总高度（px） */
  totalHeight: number
  /** 需要渲染的起始行（含） */
  startRow: number
  /** 需要渲染的结束行（含）；count=0 时为 -1 */
  endRow: number
  /** 渲染切片起点（含） */
  startIndex: number
  /** 渲染切片终点（不含） */
  endIndex: number
  /** 切片相对滚动内容的垂直偏移（px） */
  offsetTop: number
}

export function computeVirtualGrid({
  count,
  cell,
  cellHeight,
  gap,
  viewportWidth,
  viewportHeight,
  scrollTop,
  overscanRows = 2,
  fallbackCols = 10,
  fallbackHeight = 560,
}: VirtualGridInput): VirtualGridLayout {
  const cols =
    viewportWidth > 0 ? Math.max(1, Math.floor((viewportWidth + gap) / (cell + gap))) : fallbackCols
  const rowHeight = (cellHeight ?? cell) + gap
  const rows = Math.ceil(Math.max(0, count) / cols)
  const totalHeight = rows > 0 ? rows * rowHeight - gap : 0

  if (rows === 0) {
    return {
      cols,
      rows: 0,
      rowHeight,
      totalHeight: 0,
      startRow: 0,
      endRow: -1,
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
    }
  }

  const height = viewportHeight > 0 ? viewportHeight : fallbackHeight
  const top = Math.max(0, scrollTop)
  // 滚动位置可能大于内容高度（列表刚变短 / 换一批后未回顶），起点必须夹在最后一行内
  const startRow = Math.min(Math.max(0, Math.floor(top / rowHeight) - overscanRows), rows - 1)
  const endRow = Math.max(
    startRow,
    Math.min(rows - 1, Math.floor((top + height) / rowHeight) + overscanRows),
  )
  return {
    cols,
    rows,
    rowHeight,
    totalHeight,
    startRow,
    endRow,
    startIndex: startRow * cols,
    endIndex: Math.min(count, (endRow + 1) * cols),
    offsetTop: startRow * rowHeight,
  }
}
