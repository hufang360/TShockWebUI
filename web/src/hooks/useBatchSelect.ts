import { useCallback, useState } from 'react'

export interface BatchSelect {
  /** 是否处于批量选择（删除）状态。 */
  active: boolean
  /** 已选 key 集合。 */
  selected: Set<string>
  /** 已选数量。 */
  count: number
  has: (key: string) => boolean
  toggle: (key: string) => void
  /** 进入批量状态（清空上一次的选择）。 */
  enter: () => void
  /** 退出并清空选择。 */
  cancel: () => void
}

/**
 * 列表批量选择状态：收藏 / 历史右上角「删除」进入后，逐行勾选。
 * key 由调用方决定（收藏用 `item:<id>` / `cmd:<cmd>`，历史用 `<ts>:<cmd>`）。
 */
export function useBatchSelect(): BatchSelect {
  const [active, setActive] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const has = useCallback((key: string) => selected.has(key), [selected])

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const enter = useCallback(() => {
    setActive(true)
    setSelected(new Set())
  }, [])

  const cancel = useCallback(() => {
    setActive(false)
    setSelected(new Set())
  }, [])

  return { active, selected, count: selected.size, has, toggle, enter, cancel }
}
