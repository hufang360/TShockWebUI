import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBottomList } from './useBottomList'

/** 记录观察到的回调，测试里手动触发「容器尺寸变化」。 */
const resizeCallbacks: Array<() => void> = []

class ResizeObserverStub {
  private readonly cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe() {
    resizeCallbacks.push(() => this.cb([], this as unknown as ResizeObserver))
  }
  unobserve() {}
  disconnect() {
    resizeCallbacks.length = 0
  }
}

function Harness({ total }: { total: number }) {
  const { ref, onScroll } = useBottomList(total, { initial: 5 })
  return <div ref={ref} data-testid="list" onScroll={onScroll} />
}

function ContentHarness({ total }: { total: number }) {
  const { ref, contentRef, onScroll } = useBottomList(total, { initial: 5 })
  return (
    <div ref={ref} data-testid="list" onScroll={onScroll}>
      <div ref={contentRef} data-testid="content" />
    </div>
  )
}

function size(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('useBottomList 容器尺寸变化时贴底', () => {
  beforeEach(() => {
    resizeCallbacks.length = 0
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('容器变高后重新滚到最底（首次渲染时容器还没有可滚动高度）', () => {
    render(<Harness total={5} />)
    const el = screen.getByTestId('list')
    // 内容变高：模拟「量高后切到固定高度」，此时需要再贴一次底。
    size(el, 1000, 300)
    el.scrollTop = 0
    resizeCallbacks[0]()
    expect(el.scrollTop).toBe(1000)
  })

  it('用户向上回看旧记录时，容器尺寸变化不打扰', () => {
    render(<Harness total={20} />)
    const el = screen.getByTestId('list')
    size(el, 1000, 300)
    // 滚到距底部很远的位置 → 认为用户在回看历史。
    el.scrollTop = 100
    fireEvent.scroll(el)
    resizeCallbacks[0]()
    expect(el.scrollTop).toBe(100)
  })

  it('内容自己变高（富文本晚到 / 换行）也贴底', () => {
    render(<ContentHarness total={5} />)
    const el = screen.getByTestId('list')
    const content = screen.getByTestId('content')
    size(el, 1000, 300)
    el.scrollTop = 1000
    fireEvent.scroll(el)
    // 内层内容变高（最后一个观察对象是内容）：仍要贴底。
    size(el, 1400, 300)
    resizeCallbacks[resizeCallbacks.length - 1]()
    expect(content).toBeTruthy()
    expect(el.scrollTop).toBe(1400)
  })
})
