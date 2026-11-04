import { useId, useLayoutEffect, useRef, useState } from 'react'
import { AWNING_HEIGHT, AWNING_SCALLOP, buildAwningStrips } from '@/lib/fishAwning'

/**
 * 鱼店遮阳伞：货架区顶上一排挂着的布条（参考鱼摊遮阳伞的裙边），按透视用 SVG 画，
 * 颜色见 `index.css` 的 `.shop-awning`。
 *
 * 为什么不是纯 CSS 渐变：布条是**放射状**的 —— 中间几条竖直、越靠两端越往外斜，
 * 每条布下端各自收成半圆，缝里露出下沿那条浅灰底带。横向条纹渐变做不出「每条布在自己的角度上」。
 * 几何全在 `lib/fishAwning.ts`（纯函数 + 单测），这里只负责量宽度和画。
 *
 * 宽度用 `ResizeObserver` 量（理由同 `GoodGrid` 的货架板：行高 / 列宽都不是写死的）。
 *
 * 它属于**货架区**本身（网格 / 空态 / 加载中都顶着同一块篷），不参与网格排版 ——
 * `GoodGrid` 量格子几何时不会被它带歪；表格视图下不画（数据表上面顶块篷布没意义）。
 */
export function ShopAwning() {
  const unique = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const hostRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => setWidth(Math.round(host.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const strips = buildAwningStrips(width)
  const clips = `awning-strips-${unique}`
  const hem = `awning-hem-${unique}`
  const cylinder = `awning-cylinder-${unique}`

  return (
    <div ref={hostRef} aria-hidden data-testid="shop-awning" className="shop-awning -mx-2">
      {width > 0 && (
        <svg
          className="shop-awning-svg"
          width="100%"
          height={AWNING_HEIGHT}
          viewBox={`0 0 ${width} ${AWNING_HEIGHT}`}
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient id={hem} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="transparent" />
              <stop offset="1" stopColor="var(--awning-hem)" />
            </linearGradient>
            {/* 一条布自己的明暗：两侧压暗、中间留亮（像一小段圆柱）。objectBoundingBox 默认单位，
                所以同一份渐变对每条布都成立。 */}
            <linearGradient id={cylinder} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--awning-cyl)" />
              <stop offset="0.3" stopColor="transparent" />
              <stop offset="0.7" stopColor="transparent" />
              <stop offset="1" stopColor="var(--awning-cyl)" />
            </linearGradient>
            <clipPath id={clips}>
              {strips.map((strip) => (
                <path key={strip.d} d={strip.d} />
              ))}
            </clipPath>
          </defs>

          {strips.map((strip, index) => {
            // 两端那条 = 篷布绕到背面的那一截，画成灰色
            const tone =
              index === 0 || index === strips.length - 1 ? 'turn' : strip.tone
            return (
              <g key={strip.d}>
                <path className={`shop-awning-strip shop-awning-strip--${tone}`} d={strip.d} />
                <path d={strip.d} fill={`url(#${cylinder})`} />
              </g>
            )
          })}

          {/* 以下阴影只作用在布条上（`clipPath` 收进布条轮廓里），不会把缝里的背景也涂黑 */}
          <g clipPath={`url(#${clips})`}>
            <rect
              x="0"
              y={AWNING_HEIGHT - AWNING_SCALLOP}
              width={width}
              height={AWNING_SCALLOP}
              fill={`url(#${hem})`}
            />
          </g>
        </svg>
      )}
    </div>
  )
}
