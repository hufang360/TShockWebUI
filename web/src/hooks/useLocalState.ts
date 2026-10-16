import { useCallback, useState } from 'react'
import { readJson, StorageKeys, writeJson } from '@/lib/storage'

type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]

/**
 * 与 tswui: 存储同步的 state。
 * 写入失败（配额）时不抛出，界面仍可用（设计原则与约束 §4.6）。
 */
export function useLocalState<T>(
  key: StorageKey,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readJson(key, initial))
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
