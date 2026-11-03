import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { GOOD_GRID_CLASS, GOOD_SIZES, GoodCell, type GoodIconSize } from '@/components/fishshop/GoodCells'
import type { FishGood } from '@/lib/tshock'
import type { Dataset } from '@/types'

/**
 * 鱼店货架网格：商品格子 + 每行那条「货架板」（纯 CSS，见 `index.css` 的 `.fish-shelf`）。
 *
 * 为什么单独一层：板是画在格子**背后**的一层背景（`background-repeat: repeat-y`），
 * 必须知道一行的实际周期、以及板该落在行内哪个高度，才能每一行都对齐。这两件事都写死不了：
 * 行高由格子内容（图标 + 序号 + 名称）决定，换字体 / 换主题 / 窄屏折行都会变，
 * 所以渲染后量一次（`ResizeObserver` 跟着变），量不到（jsdom / 还没排版）就不画。
 *
 * 板的位置：**上沿贴着图标区的底部**（图标再往下 4px 内边距的地方，商品看着像踩在板上），
 * 板身盖住 `#序号` 那一行
 * （序号像货架边缘的价格标签），名称挂在板下面。板的两端各有一条向里、向上 60° 的斜线，
 * 越往上越淡，到图标半高多一点的地方化掉——像货架边缘往两侧收。
 * 隐藏编号和名称时没有序号行，板就只有薄薄一条压在图标下面。
 */
/** 板左右各留的空隙（Tailwind `p-1` = 4px）：贴着图标边缘会显得板「顶手」。 */
const SHELF_SIDE = 4

/** 整块板再往下挪的像素：上沿 / 下沿两条线一起下沉，板不贴着图标底。 */
const SHELF_DROP = 1

export function GoodGrid({
  goods,
  dataset,
  size,
  hideMeta = false,
  onSelect,
  shelf: shelfWanted = true,
}: {
  goods: FishGood[]
  dataset: Dataset | null
  /** 图标尺寸档位（小 / 中 / 大）。 */
  size: GoodIconSize
  /** 只显示图标（「页面设置 → 隐藏编号和名称」）。 */
  hideMeta?: boolean
  onSelect: (good: FishGood) => void
  /** 是否画货架线：表格视图没有格子；小尺寸格子排得密，加线只会更乱。 */
  shelf?: boolean
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [shelf, setShelf] = useState<{
    pitch: number
    line: number
    thickness: number
    width: number
  } | null>(null)
  // 两端斜线的水平跨距：斜线要爬到「图标半高 + 2px」，角度固定 60°，所以跨距 = 爬高 / tan60°。
  const railRun = (GOOD_SIZES[size].icon / 2 + 2) / Math.tan(Math.PI / 3)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!shelfWanted || !grid) {
      setShelf(null)
      return
    }
    const measure = () => {
      const cell = grid.firstElementChild as HTMLElement | null
      const cellRect = cell?.getBoundingClientRect()
      const gap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0
      // 用 `getBoundingClientRect` 而不是 `offsetHeight`：后者取整，几十行下来会累积偏移把板画歪。
      if (!cell || !cellRect || cellRect.height <= 0) {
        setShelf(null)
        return
      }
      // 板上沿贴在**图标区底部**（图标区 → #序号 → 名称）。图标区比图标本身多 4px 内边距，
      // 所以这条线比图标精灵的底边再低 4px：商品看着像站在板上，又不贴着图标底。
      // 板身盖住序号那行，厚度 = 序号行底边 - 板上沿。
      const surface = cell.children[0] as HTMLElement | undefined
      const serial = cell.children[1] as HTMLElement | undefined
      const surfaceRect = surface?.getBoundingClientRect()
      const line = (surfaceRect ? surfaceRect.bottom - cellRect.top : cellRect.height) + SHELF_DROP
      const serialBottom = serial ? serial.getBoundingClientRect().bottom - cellRect.top : 0
      // 隐藏编号和名称时没有序号行：板就薄薄一条（4px），别让「厚度」变成负数 / 0。
      const thickness = serialBottom > line ? serialBottom - line : 4
      // 板的右端就是**整行**的右边（哪怕这一行只摆了一件商品）：板是一整条货架，
      // 不会因为商品少就缩短（用户定的）。
      const width = grid.getBoundingClientRect().width
      setShelf({ pitch: cellRect.height + gap, line, thickness, width })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    if (grid.firstElementChild) observer.observe(grid.firstElementChild)
    return () => observer.disconnect()
  }, [shelfWanted, size, hideMeta, goods.length])

  // 板和两端的斜线各占一层：板要横向渐隐收边（不然两端是硬竖切），
  // 而斜线自己另有一套渐隐，放在同一层里会被板的 mask 一起吃掉。
  const shelfVars = shelf
    ? ({
        '--fish-shelf-pitch': `${shelf.pitch}px`,
        '--fish-shelf-line': `${shelf.line}px`,
        '--fish-shelf-thickness': `${shelf.thickness}px`,
        '--fish-shelf-rail-run': `${railRun}px`,
        left: SHELF_SIDE,
        width: Math.max(0, shelf.width - SHELF_SIDE * 2),
      } as CSSProperties)
    : undefined
  // 板那一层要往下多伸一截：板画在格子里（隐藏编号名称时更是整个落在图标下方、行高之外），
  // 最后一行的板 + 板下投影会超出网格盒子，不伸出去就被切掉。
  const shelfBoardStyle = shelfVars
    ? ({ ...shelfVars, bottom: 'calc(-1 * (var(--fish-shelf-thickness) + 10px))' } as CSSProperties)
    : undefined

  return (
    <div className="relative">
      {shelf && (
        <>
          <div
            aria-hidden
            data-testid="fish-shelf"
            className="fish-shelf pointer-events-none absolute top-0"
            style={shelfBoardStyle}
          />
          <div
            aria-hidden
            className="fish-shelf-rails pointer-events-none absolute inset-y-0"
            style={shelfVars}
          />
        </>
      )}
      <div ref={gridRef} className={GOOD_GRID_CLASS[size]}>
        {goods.map((good) => (
          <GoodCell
            key={good.serial}
            good={good}
            dataset={dataset}
            size={size}
            hideMeta={hideMeta}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
