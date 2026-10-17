import { useCallback, useRef, useState } from 'react'

export interface RovingFocus {
  activeIndex: number
  setActive: (index: number) => void
  setRef: (index: number) => (el: HTMLElement | null) => void
  reset: () => void
  focusAt: (index: number) => void
  /** 从 from 往 dir 找下一个已挂载的行；找不到返回 false（用于回退到输入框）。 */
  move: (from: number, dir: 1 | -1) => boolean
}

/**
 * 搜索框 + 结果列表的 roving focus：↑↓ 在列表内移动（跳过已折叠/未挂载的行），
 * Enter 由各行的按钮自身处理。`count` 用于把移动范围限制在当前可见条目内。
 */
export function useRovingFocus(count: number): RovingFocus {
  const refs = useRef<(HTMLElement | null)[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)

  const setActive = useCallback((index: number) => setActiveIndex(index), [])

  const setRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      refs.current[index] = el
    },
    [],
  )

  const reset = useCallback(() => setActiveIndex(-1), [])

  const focusAt = useCallback((index: number) => {
    const el = refs.current[index]
    if (!el) return
    setActiveIndex(index)
    el.focus()
  }, [])

  const move = useCallback(
    (from: number, dir: 1 | -1) => {
      let i = from + dir
      while (i >= 0 && i < count) {
        const el = refs.current[i]
        if (el) {
          setActiveIndex(i)
          el.focus()
          return true
        }
        i += dir
      }
      return false
    },
    [count],
  )

  return { activeIndex, setActive, setRef, reset, focusAt, move }
}
