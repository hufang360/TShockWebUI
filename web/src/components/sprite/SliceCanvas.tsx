import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { SliceSource } from '@/lib/spriteSheet/export'
import type { SliceEntry } from '@/lib/spriteSheet/model'
import { hitTest, rectFromDrag, type SliceRect } from '@/lib/spriteSheet/slice'

interface SliceCanvasProps {
  src: SliceSource
  /** 网格 + 手动切片（顺序即列表 / 导出顺序）。 */
  entries: SliceEntry[]
  selected: string | null
  /** `'fit'` = 适应容器宽度；数字 = 固定缩放倍数。 */
  zoom: 'fit' | number
  /** `grid`：点击选中；`marquee`：拖拽框选新建切片（点一下仍选中）。 */
  mode: 'grid' | 'marquee'
  onSelect: (key: string | null) => void
  onNudge: (dx: number, dy: number) => void
  /** 框选结束（矩形已取整并夹进图片范围）。 */
  onCreate: (rect: SliceRect) => void
  label: string
}

/** 缩放倍数的上限 / 下限：再大只会让浏览器画一张超大 canvas。 */
const MIN_SCALE = 0.02
const MAX_SCALE = 8

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 框选至少要拖出这么多**屏幕**像素才算数（避免点一下或手抖就多一张切片）。 */
const MIN_DRAG_CSS = 4

/**
 * 精灵图预览：一张 canvas 画「原图 + 网格 + 序号 + 选中 / 微调 / 框选」。
 *
 * - 缩小图放大时关闭插值（像素锐利）。
 * - 点击命中切片即选中；`marquee` 模式下按住拖动 = 框出一块新切片。
 * - 方向键调用 `onNudge` 微调当前切片（Shift = 8px）。
 */
export function SliceCanvas({
  src,
  entries,
  selected,
  zoom,
  mode,
  onSelect,
  onNudge,
  onCreate,
  label,
}: SliceCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  )
  /** 框选中的临时矩形（图片坐标）。 */
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(
    null,
  )
  const dragRef = useRef<{ start: { x: number; y: number }; pointerId: number } | null>(null)

  const rects = useMemo(() => entries.map((entry) => entry.rect), [entries])
  const selectedRect = useMemo(
    () => entries.find((entry) => entry.key === selected)?.rect ?? null,
    [entries, selected],
  )

  // 「适应」同时受宽度与可用高度约束：竖长的精灵表不会把页面撑到好几屏。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((observed) => {
      const width = observed[0]?.contentRect.width ?? 0
      setContainerWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /** 「适应」的可用高度：视口六成左右，夹在 280–760px。 */
  const fitHeight = Math.min(760, Math.max(280, Math.round(viewportHeight * 0.62)))
  const fitScale =
    containerWidth > 0
      ? Math.min(containerWidth / src.width, fitHeight / src.height)
      : fitHeight / src.height
  const scale =
    zoom === 'fit'
      ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitScale))
      : Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    const cssW = Math.max(1, Math.round(src.width * scale))
    const cssH = Math.max(1, Math.round(src.height * scale))
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(src.source, 0, 0, cssW, cssH)

    const css = getComputedStyle(canvas)
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    const primary = read('--primary', '#3b82f6')
    const primaryFg = read('--primary-foreground', '#ffffff')
    const warning = read('--warning', '#f59e0b')
    // 网格用中灰（`--ring`）：亮色 / 暗色贴图上都能看清，不靠主题的 border（暗色下只有 10% 白）。
    const guide = read('--ring', 'rgba(140,140,140,0.85)')

    const selBox = selectedRect
      ? {
          x: Math.round(selectedRect.x * scale),
          y: Math.round(selectedRect.y * scale),
          w: Math.max(1, Math.round(selectedRect.w * scale)),
          h: Math.max(1, Math.round(selectedRect.h * scale)),
        }
      : null

    // 选中时压暗其余区域，再把选中切片原样重画一遍（聚光灯）：比半透明色块更干净，也不给贴图染色。
    if (selectedRect && selBox) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.55)'
      ctx.fillRect(0, 0, cssW, cssH)
      ctx.drawImage(
        src.source,
        selectedRect.x,
        selectedRect.y,
        selectedRect.w,
        selectedRect.h,
        selBox.x,
        selBox.y,
        selBox.w,
        selBox.h,
      )
    }

    // 网格：按去重后的边界画细线。逐个切片 `strokeRect` 会让相邻两条边重叠成 2px，粗细不均。
    const xs = new Set<number>()
    const ys = new Set<number>()
    for (const rect of rects) {
      xs.add(Math.round(rect.x * scale))
      xs.add(Math.round((rect.x + rect.w) * scale))
      ys.add(Math.round(rect.y * scale))
      ys.add(Math.round((rect.y + rect.h) * scale))
    }
    ctx.save()
    ctx.strokeStyle = guide
    ctx.globalAlpha = selectedRect ? 0.4 : 0.7
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const x of xs) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, cssH)
    }
    for (const y of ys) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(cssW, y + 0.5)
    }
    ctx.stroke()
    ctx.restore()

    // 微调过的网格切片：琥珀色虚线框（比实心描边安静，但一眼能认出来）。
    const dashed = entries.some((entry) => entry.key !== selected && entry.adjusted)
    if (dashed) {
      ctx.save()
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1.5
      ctx.strokeStyle = warning
      for (const entry of entries) {
        if (entry.key === selected || !entry.adjusted) continue
        const rect = entry.rect
        ctx.strokeRect(
          Math.round(rect.x * scale) + 0.5,
          Math.round(rect.y * scale) + 0.5,
          Math.max(1, Math.round(rect.w * scale) - 1),
          Math.max(1, Math.round(rect.h * scale) - 1),
        )
      }
      ctx.restore()
    }

    // 框选中的临时矩形：主色虚线 + 淡填充。
    if (drag) {
      const x = Math.round(Math.min(drag.from.x, drag.to.x) * scale)
      const y = Math.round(Math.min(drag.from.y, drag.to.y) * scale)
      const w = Math.max(1, Math.round(Math.abs(drag.to.x - drag.from.x) * scale))
      const h = Math.max(1, Math.round(Math.abs(drag.to.y - drag.from.y) * scale))
      ctx.save()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'
      ctx.fillRect(x, y, w, h)
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 1.5
      ctx.strokeStyle = primary
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
      ctx.restore()
    }

    // 选中的切片：白色外光晕 + 主色边框，任何底色的贴图上都看得清。
    if (selBox) {
      ctx.save()
      ctx.lineWidth = 4
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.strokeRect(selBox.x - 0.5, selBox.y - 0.5, selBox.w + 1, selBox.h + 1)
      ctx.lineWidth = 2
      ctx.strokeStyle = primary
      ctx.strokeRect(selBox.x - 0.5, selBox.y - 0.5, selBox.w + 1, selBox.h + 1)
      ctx.restore()
    }

    // 序号：左上角小徽标（不再压在贴图正中），格子太小就不画。
    ctx.save()
    ctx.font = '600 10px ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const entry of entries) {
      const rect = entry.rect
      const w = rect.w * scale
      const h = rect.h * scale
      if (w < 26 || h < 18) continue
      const text = String(entry.index + 1)
      const textW = ctx.measureText(text).width
      const bw = textW + 7
      const bh = 14
      const bx = Math.round(rect.x * scale) + 3
      const by = Math.round(rect.y * scale) + 3
      const active = entry.key === selected
      ctx.fillStyle = active ? primary : 'rgba(2, 6, 23, 0.62)'
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(bx, by, bw, bh, 3)
        ctx.fill()
      } else {
        ctx.fillRect(bx, by, bw, bh)
      }
      ctx.fillStyle = active ? primaryFg : 'rgba(255, 255, 255, 0.86)'
      ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5)
    }
    ctx.restore()
  }, [src, entries, rects, selected, selectedRect, drag, scale])

  const imagePoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const box = canvas.getBoundingClientRect()
      return {
        x: clamp((event.clientX - box.left) / scale, 0, src.width),
        y: clamp((event.clientY - box.top) / scale, 0, src.height),
      }
    },
    [scale, src.width, src.height],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = imagePoint(event)
    if (mode === 'grid') {
      onSelect(sliceKeyAtPoint(entries, point))
      return
    }
    dragRef.current = { start: point, pointerId: event.pointerId }
    setDrag({ from: point, to: point })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = dragRef.current
    if (!state) return
    const point = imagePoint(event)
    setDrag({ from: state.start, to: point })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = dragRef.current
    if (!state) return
    dragRef.current = null
    setDrag(null)
    if (event.currentTarget.hasPointerCapture(state.pointerId)) {
      event.currentTarget.releasePointerCapture(state.pointerId)
    }
    const point = imagePoint(event)
    const rect = rectFromDrag(state.start, point, { width: src.width, height: src.height })
    if (rect && Math.max(rect.w, rect.h) * scale >= MIN_DRAG_CSS) {
      onCreate(rect)
      return
    }
    onSelect(sliceKeyAtPoint(entries, point))
  }

  const onPointerCancel = () => {
    dragRef.current = null
    setDrag(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 8 : 1
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    onNudge(move[0], move[1])
  }

  return (
    <div
      ref={wrapRef}
      role="group"
      aria-label={label}
      tabIndex={0}
      className="flex flex-col gap-2 rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      // 点 canvas 选中切片时把焦点交给这个容器，方向键微调才能直接用。
      onPointerDown={() => wrapRef.current?.focus()}
      onKeyDown={onKeyDown}
    >
      <div
        className="overflow-auto rounded-control border border-border/60"
        style={{
          backgroundColor: 'var(--muted)',
          backgroundImage:
            'repeating-conic-gradient(rgba(127,127,127,0.14) 0% 25%, transparent 0% 50%)',
          backgroundSize: '16px 16px',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          className={
            mode === 'marquee'
              ? 'mx-auto block cursor-crosshair touch-none [image-rendering:pixelated]'
              : 'mx-auto block cursor-pointer [image-rendering:pixelated]'
          }
        />
      </div>
    </div>
  )
}

/** 命中点 → 切片 key（点到空白处返回 `null`）。 */
function sliceKeyAtPoint(
  entries: SliceEntry[],
  point: { x: number; y: number },
): string | null {
  const index = hitTest(
    entries.map((entry) => entry.rect),
    point.x,
    point.y,
  )
  return index == null ? null : (entries[index]?.key ?? null)
}
