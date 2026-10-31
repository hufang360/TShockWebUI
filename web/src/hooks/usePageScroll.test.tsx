import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  APP_HEADER_HEIGHT,
  usePageScrollReset,
  usePageScroller,
  useStickyHeaderOffset,
  type PageScroller,
} from './usePageScroll'

/**
 * jsdom 不做布局：手工给元素一个「在页面内容里的顶部偏移」，并像浏览器那样减掉滚动偏移
 * （滚了 450px 时，内容坐标 200 处的元素 `rect.top` 应该是 -250）。
 */
const contentTops = new Map<Element, number>()
let scrollHost: HTMLElement | null = null

beforeEach(() => {
  contentTops.clear()
  scrollHost = null
  HTMLElement.prototype.getBoundingClientRect = function (this: Element) {
    let top = contentTops.get(this) ?? 0
    const host = scrollHost
    if (host && this !== host && host.contains(this)) top -= host.scrollTop
    return {
      top,
      bottom: top,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  }
})

/** 给元素装上可读写的 `scrollTop` 与固定 `clientHeight`（jsdom 的赋值不生效）。 */
function setScrollable(el: HTMLElement, { scrollTop = 0, clientHeight = 0 }) {
  let top = scrollTop
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      top = value
    },
    configurable: true,
  })
  Object.defineProperty(el, 'clientHeight', { get: () => clientHeight, configurable: true })
}

function Probe({ onState }: { onState: (state: PageScroller) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroller = usePageScroller(ref)
  useEffect(() => {
    onState(scroller)
  })
  return <div ref={ref} />
}

describe('usePageScroller', () => {
  it('把主内容区的滚动换算成「列表内位置」，并能滚到指定位置 / 回到顶部', async () => {
    const state: { current: PageScroller | null } = { current: null }
    render(
      <main data-testid="main">
        <Probe onState={(next) => (state.current = next)} />
      </main>,
    )
    const main = screen.getByTestId('main')
    const list = main.firstElementChild as HTMLElement
    scrollHost = main
    setScrollable(main, { scrollTop: 450, clientHeight: 600 })
    // 列表顶部在页面内容坐标 200 处（上面那一截是工具条）。
    contentTops.set(list, 200)

    // 重新测量（真实环境由 ResizeObserver / window.resize 触发）。
    fireEvent(window, new Event('resize'))

    await waitFor(() => expect(state.current?.offsetTop).toBe(200))
    expect(state.current?.viewportHeight).toBe(600)
    // 页面滚到 450 → 列表内位置 250。
    await waitFor(() => expect(state.current?.scrollTop).toBe(250))

    state.current!.scrollTo(100)
    expect(main.scrollTop).toBe(300)

    state.current!.scrollToTop()
    expect(main.scrollTop).toBe(0)
  })

  it('按内容坐标换算，与页面当时滚到哪里无关', async () => {
    const state: { current: PageScroller | null } = { current: null }
    render(
      <main data-testid="main">
        <Probe onState={(next) => (state.current = next)} />
      </main>,
    )
    const main = screen.getByTestId('main')
    const list = main.firstElementChild as HTMLElement
    scrollHost = main
    setScrollable(main, { scrollTop: 0, clientHeight: 600 })
    contentTops.set(list, 200)

    fireEvent(window, new Event('resize'))
    await waitFor(() => expect(state.current?.offsetTop).toBe(200))

    // 页面滚到 900 后，列表内位置 = 900 − 200。
    main.scrollTop = 900
    fireEvent.scroll(main)
    await waitFor(() => expect(state.current?.scrollTop).toBe(700))
    expect(state.current?.offsetTop).toBe(200)
  })
})

describe('usePageScrollReset', () => {
  it('挂载时把上一页留下的滚动位置复位', () => {
    function Page() {
      const ref = useRef<HTMLDivElement>(null)
      usePageScrollReset(ref)
      return <div ref={ref} />
    }
    // 手搓一个「已经滚了 400px」的主内容区，再把页面挂进去。
    const main = document.createElement('main')
    document.body.appendChild(main)
    setScrollable(main, { scrollTop: 400 })
    main.scrollTop = 400
    scrollHost = main

    render(<Page />, { container: main })
    expect(main.scrollTop).toBe(0)
    main.remove()
  })
})

describe('useStickyHeaderOffset', () => {
  it('默认就是顶栏高度（工具条还没量到时）', () => {
    function Page() {
      const ref = useRef<HTMLDivElement>(null)
      const offset = useStickyHeaderOffset(ref)
      return <div ref={ref} data-testid="toolbar" data-offset={offset} />
    }
    render(<Page />)
    // jsdom 量到的工具条高度是 0 → 只剩顶栏 48px。
    expect(screen.getByTestId('toolbar').dataset.offset).toBe(String(APP_HEADER_HEIGHT))
  })
})
