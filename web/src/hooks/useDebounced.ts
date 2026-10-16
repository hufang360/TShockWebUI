import { useEffect, useRef, useState } from 'react'

/** 防抖：用于搜索输入等（设计原则与约束 §6 / §4.6）。 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** 判断组件是否已卸载，避免异步 setState（React 18+ 无警告但仍建议）。 */
export function useMountedRef(): { readonly current: boolean } {
  const ref = useRef(true)
  useEffect(() => {
    ref.current = true
    return () => {
      ref.current = false
    }
  }, [])
  return ref
}
