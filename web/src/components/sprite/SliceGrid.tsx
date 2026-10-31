import { useEffect, useRef, useState } from 'react'
import type { SliceSource } from '@/lib/spriteSheet/export'
import type { SliceEntry } from '@/lib/spriteSheet/model'
import { cn } from '@/lib/utils'

interface SliceGridProps {
  src: SliceSource
  entries: SliceEntry[]
  selected: string | null
  /** 全透明切片（勾选「跳过」时才有值），用半透明标记。 */
  blanks: ReadonlySet<string>
  onSelect: (key: string) => void
  /** 双击缩略图 = 导出这一张。 */
  onExport: (key: string) => void
}

const CELL = 72
const GAP = 8
const THUMB = 64

/**
 * 切片列表：横向滚动的缩略图条。
 *
 * 只渲染可视区附近的格子（`scrollLeft` + 容器宽度手算窗口），几百上千张切片也不会一次挂载同样多的 canvas。
 * 缩略图按切片矩形裁切，用「包含」方式缩放（不裁掉内容），棋盘格底让透明区域可见。
 * 左上角是序号徽标，命名过的切片在底部显示名字。
 */
export function SliceGrid({
  src,
  entries,
  selected,
  blanks,
  onSelect,
  onExport,
}: SliceGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 0 })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = () => setView({ left: el.scrollLeft, width: el.clientWidth })
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const step = CELL + GAP
  const windowSize = Math.ceil((view.width || 600) / step) + 3
  const start = Math.max(0, Math.floor(view.left / step) - 1)
  const end = Math.min(entries.length, start + windowSize)

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto overflow-y-hidden pb-1"
      onScroll={(event) => {
        const el = event.currentTarget
        setView({ left: el.scrollLeft, width: el.clientWidth })
      }}
    >
      <div className="flex" style={{ gap: `${GAP}px`, paddingLeft: start * step }}>
        {entries.slice(start, end).map((entry) => (
          <SliceThumb
            key={entry.key}
            src={src}
            entry={entry}
            selected={entry.key === selected}
            blank={blanks.has(entry.key)}
            onSelect={onSelect}
            onExport={onExport}
          />
        ))}
      </div>
    </div>
  )
}

interface SliceThumbProps {
  src: SliceSource
  entry: SliceEntry
  selected: boolean
  blank: boolean
  onSelect: (key: string) => void
  onExport: (key: string) => void
}

function SliceThumb({ src, entry, selected, blank, onSelect, onExport }: SliceThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rect = entry.rect
  const named = entry.name.trim().length > 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, THUMB, THUMB)
    ctx.imageSmoothingEnabled = false
    const scale = Math.min(THUMB / Math.max(1, rect.w), THUMB / Math.max(1, rect.h), 4)
    const w = Math.max(1, Math.round(rect.w * scale))
    const h = Math.max(1, Math.round(rect.h * scale))
    const x = Math.round((THUMB - w) / 2)
    const y = Math.round((THUMB - h) / 2)
    ctx.drawImage(src.source, rect.x, rect.y, rect.w, rect.h, x, y, w, h)
  }, [src, rect])

  const label = `${entry.displayName}（#${entry.index + 1}）`

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={() => onSelect(entry.key)}
      onDoubleClick={() => onExport(entry.key)}
      data-testid="slice-thumb"
      style={{ width: CELL }}
      className={cn(
        'group relative shrink-0 rounded-control p-1 transition-colors',
        'hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected && 'bg-primary/10 ring-2 ring-primary',
        !selected && entry.adjusted && 'ring-1 ring-warning/70 hover:ring-warning',
        !selected && !entry.adjusted && 'ring-1 ring-border/60 hover:ring-border',
        blank && 'opacity-40',
      )}
    >
      <span
        className="relative grid size-16 place-items-center overflow-hidden rounded-chip"
        style={{
          backgroundColor: 'var(--muted)',
          backgroundImage:
            'repeating-conic-gradient(rgba(127,127,127,0.14) 0% 25%, transparent 0% 50%)',
          backgroundSize: '12px 12px',
        }}
      >
        <canvas ref={canvasRef} width={THUMB} height={THUMB} className="size-16" />
        <span
          className={cn(
            'absolute top-1 left-1 rounded-chip px-1 text-[10px] leading-4 font-semibold tabular-nums',
            selected
              ? 'bg-primary text-primary-foreground'
              : 'bg-black/60 text-white/85 group-hover:bg-black/75',
          )}
        >
          {entry.index + 1}
        </span>
        {named && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 text-[10px] leading-4 text-white/90">
            {entry.displayName}
          </span>
        )}
      </span>
    </button>
  )
}
