// vitest 全局 setup。jsdom 下补齐 canvas / matchMedia / Pointer Capture 等最小桩。
if (typeof window !== 'undefined') {
  {
    // 只实现测试会用到的 `min-width` / `max-width`（其余查询按不匹配处理）：
    // 这样 `useMediaQuery('(min-width: 1280px)')` 等断点判断在 jsdom 里也说得通，
    // 测试可以通过改写 `window.innerWidth` 模拟大小屏。
    window.matchMedia = ((query: string) => {
      const listeners = new Set<() => void>()
      const evaluate = () => {
        const min = /min-width:\s*(\d+)px/.exec(query)
        const max = /max-width:\s*(\d+)px/.exec(query)
        let ok = Boolean(min || max)
        if (min) ok = ok && window.innerWidth >= Number(min[1])
        if (max) ok = ok && window.innerWidth <= Number(max[1])
        return ok
      }
      return {
        get matches() {
          return evaluate()
        },
        media: query,
        onchange: null,
        addListener: (fn: () => void) => listeners.add(fn),
        removeListener: (fn: () => void) => listeners.delete(fn),
        addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
        dispatchEvent: () => false,
      }
    }) as unknown as typeof window.matchMedia
  }
  if (!HTMLCanvasElement.prototype.getContext) {
    HTMLCanvasElement.prototype.getContext = (() => null) as never
  }
  // Radix 的 Checkbox / Slider 依赖 ResizeObserver（测尺寸），jsdom 没有；补一个空实现。
  if (!window.ResizeObserver) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  }
  // Radix 的 DropdownMenu / Select 在 jsdom 下需要 Pointer Capture 与 scrollIntoView。
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}
