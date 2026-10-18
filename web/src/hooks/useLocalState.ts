import { useCallback, useEffect, useRef, useState } from 'react'
import { readJson, StorageKeys, STORAGE_EVENT, writeJson } from '@/lib/storage'

type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]

/**
 * 与 tswui: 存储同步的 state。
 * 写入失败（配额）时不抛出，界面仍可用（设计原则与约束 §4.6）。
 *
 * 订阅 `STORAGE_EVENT`：同一页面内多个组件用同一个 key 时保持同步
 * （如「统一执行」开关由 App 自动开启、设置页切换后，已挂载的首页/模块卡片立刻生效）。
 */
export function useLocalState<T>(
  key: StorageKey,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readJson(key, initial))
  const initialRef = useRef(initial)
  useEffect(() => {
    initialRef.current = initial
  })

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string }>).detail
      if (detail?.key !== key) return
      setValue(readJson(key, initialRef.current))
    }
    window.addEventListener(STORAGE_EVENT, handler)
    return () => window.removeEventListener(STORAGE_EVENT, handler)
  }, [key])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        writeJson(key, resolved)
        return resolved
      })
    },
    [key],
  )
  return [value, update]
}
