import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

/** AppShell 内容区顶栏高度（`h-12` = 3rem）：页面内 sticky 工具条吸在它下面。 */
export const APP_HEADER_HEIGHT = 48

export interface PageScroller {
  /** 真正在滚的元素：AppShell 的 `<main>`（全屏时是全屏容器自己）。 */
  host: HTMLElement | null
  /** 内容起点在宿主内容坐标里的顶部偏移（px）：滚到「列表顶部」= 宿主 `scrollTop = offsetTop`。 */
  offsetTop: number
  /** 宿主可视高度（px）；jsdom / 未测量时为 0（调用方自己兜底）。 */
  viewportHeight: number
  /** 宿主相对内容起点的滚动位置（px，≥0）。 */
  scrollTop: number
  /** 把宿主滚到「内容起点 + top」（= 列表内位置 `top`）。 */
  scrollTo: (top: number) => void
  /** 把宿主滚到整页顶部（换筛选 / 搜索时用：工具条与第一行都在眼前）。 */
  scrollToTop: () => void
}

/** `el` 在 `host` 内容坐标里的顶部偏移（px）。 */
function offsetInHost(el: HTMLElement, host: HTMLElement): number {
  if (el === host) return 0
  return el.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop
}

/**
 * 页面级滚动（浏览器右侧那条滚动条）下，列表 / 网格的滚动宿主。
 *
 * 把滚动交给 AppShell 的 `<main>` 后，列表自己不再溢出滚动，于是：
 * - 滚动事件、`scrollTop`、可视高度都要从 `<main>` 上取（元素自己的 `scrollTop` 永远是 0）；
 * - 虚拟化要知道「列表顶部在页面内容里偏了多少」，才能把 `main.scrollTop` 换算成列表内偏移。
 *
 * 「全屏」这类自己成为滚动区的情况（物品图鉴全屏）用 `host` 显式指定，页内偏移自然是 0。
 */
export function usePageScroller(
  ref: RefObject<HTMLElement | null>,
  opts: {
    /** 显式指定滚动宿主；不传则用元素最近的 `<main>`。 */
    host?: HTMLElement | null
    /** 宿主滚动时回调（相对内容起点的位置），用于「记住滚动位置」。 */
    onScroll?: (top: number) => void
    /** 变化时重新测量（例如进出全屏）。 */
    revision?: unknown
  } = {},
): PageScroller {
  const { host: explicitHost = null, onScroll, revision } = opts
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [offsetTop, setOffsetTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  // 滚动回调里要用最新的偏移与回调，但不想因此重挂监听。
  const offsetRef = useRef(0)
  const onScrollRef = useRef(onScroll)
  const rafRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    offsetRef.current = offsetTop
    onScrollRef.current = onScroll
  }, [offsetTop, onScroll])

  const measure = useCallback(() => {
    const el = ref.current
    const next = explicitHost ?? (el?.closest('main') as HTMLElement | null) ?? null
    setHost((prev) => (prev === next ? prev : next))
    if (!el || !next) return
    const offset = offsetInHost(el, next)
    setOffsetTop((prev) => (Math.abs(prev - offset) < 0.5 ? prev : offset))
    setViewportHeight((prev) => (prev === next.clientHeight ? prev : next.clientHeight))
    setScrollTop(Math.max(0, next.scrollTop - offset))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicitHost, ref])

  // 测量：元素尺寸（列数 / 内容高度）、宿主尺寸、窗口尺寸变化都要重来。
  useLayoutEffect(() => {
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    const el = ref.current
    const container = explicitHost ?? (el?.closest('main') as HTMLElement | null)
    if (container) ro.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, revision])

  // 页面级滚动时 `<main>` 的 scroll 不会冒泡到列表上，得直接挂监听。
  useEffect(() => {
    if (!host) return
    const handle = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const top = Math.max(0, host.scrollTop - offsetRef.current)
        setScrollTop((prev) => (prev === top ? prev : top))
        onScrollRef.current?.(top)
      })
    }
    host.addEventListener('scroll', handle, { passive: true })
    return () => {
      host.removeEventListener('scroll', handle)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [host])

  const scrollTo = useCallback(
    (top: number) => {
      const el = ref.current
      const target = explicitHost ?? (el?.closest('main') as HTMLElement | null) ?? null
      if (!target) return
      const offset = el ? offsetInHost(el, target) : 0
      target.scrollTop = offset + Math.max(0, top)
    },
    [explicitHost, ref],
  )

  const scrollToTop = useCallback(() => {
    const el = ref.current
    const target = explicitHost ?? (el?.closest('main') as HTMLElement | null) ?? null
    if (target) target.scrollTop = 0
  }, [explicitHost, ref])

  return { host, offsetTop, viewportHeight, scrollTop, scrollTo, scrollToTop }
}

/**
 * 页面挂载时把主内容区滚回顶部。
 *
 * 整页滚动的页面共用同一个滚动条（`<main>`），切页后它会保留上一页的位置；
 * 不再固定高度、`usePageHeight` 也就没机会复位，所以由页面自己说一声。
 */
export function usePageScrollReset(ref?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const target =
      ref?.current?.closest('main') ??
      document.getElementById('main-content') ??
      null
    if (target) target.scrollTop = 0
    // 仅挂载时一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/**
 * 页面内 sticky 工具条 / 表头的偏移量：顶栏（`h-12`）+ 工具条高度。
 *
 * 整页滚动后表头要吸在**工具条下面**，而工具条高度随搜索框 / 换行变化，所以实测。
 * 把返回值设成页面根元素的 `--page-sticky-top`，再让 `thead` 用 `top-[var(--page-sticky-top)]`。
 */
export function useStickyHeaderOffset(ref: RefObject<HTMLElement | null>): number {
  const [offset, setOffset] = useState(APP_HEADER_HEIGHT)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setOffset(APP_HEADER_HEIGHT + el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])
  return offset
}
