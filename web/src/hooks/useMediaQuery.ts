import { useEffect, useState } from 'react'

/**
 * 订阅一条 CSS 媒体查询（如 `(min-width: 1280px)`）。
 *
 * 用途：布局在某个断点下**根本不会生效**时（例如表格的「两列」只在 `xl` 生效），
 * 把对应开关隐藏掉，而不是让用户勾选一个没有效果的选项。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
