import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * 让整页高度正好等于 AppShell 主内容区的可用高度（页面自身不滚动，内部区域滚动）。
 *
 * 用法：把返回的 height 设到页面根元素的 `style.height`，并在页面里用
 * `min-h-0 flex-1 overflow-y-auto` 的中间区域承载滚动。
 * 与物品图鉴（`ItemsPage`）同一套测量口径：不能用「视口 − rect.top」，
 * 要减掉 `<main>` 容器的滚动偏移与内容包裹层的底部 padding。
 */
export function usePageHeight(
  ref: RefObject<HTMLElement | null>,
  revision?: unknown,
): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const scroller = el.closest('main')
    const measure = () => {
      const container = scroller instanceof HTMLElement ? scroller : null
      let padWrap: HTMLElement | null = el
      if (container) {
        while (padWrap && padWrap.parentElement !== container) padWrap = padWrap.parentElement
      } else {
        padWrap = el.parentElement
      }
      const padBottom = padWrap
        ? Number.parseFloat(getComputedStyle(padWrap).paddingBottom) || 0
        : 0
      const containerTop = container ? container.getBoundingClientRect().top : 0
      const scrolled = container ? container.scrollTop : 0
      const topInContainer = el.getBoundingClientRect().top - containerTop + scrolled
      const viewportH = container ? container.clientHeight : window.innerHeight
      setHeight(Math.max(360, Math.floor(viewportH - topInContainer - padBottom)))
    }
    // 本页刚好占满一屏，切过来时先把容器的历史滚动复位
    if (scroller instanceof HTMLElement && scroller.scrollTop > 0) scroller.scrollTop = 0
    measure()
    // 只观察尺寸变化：不要用 MutationObserver 监听子节点（列表滚动时每挂/卸一行都会触发，
    // 每次 measure 都要读一次布局 → 滚动明显掉帧）。
    const observed: Element = scroller ?? el.parentElement ?? el
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(observed)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, revision])

  return height
}
