import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { StorageKeys } from '@/lib/storage'

/**
 * 页面「使用说明」的关闭记忆（按 scope 单独记，存在本机 `tswui:helpClosed`）。
 *
 * 语义：**首次进入默认展开**；点 ✕ 关闭后不再自动展开，之后靠标题旁的 ⓘ 手动打开。
 * scope 例：`panel:world:`（世界管理）/ `panel:m:<id>:`（每个自定义模块）/ `store`（鱼店）/ `tips`（指令小抄）。
 */
export function usePageHelp(scopeId?: string): {
  /** 是否「已经被关闭过」（关过就不再自动展开）。 */
  closed: boolean
  close: () => void
} {
  const [raw, setRaw] = useLocalState<Record<string, boolean>>(StorageKeys.helpClosed, {})
  const closed = Boolean(scopeId && raw?.[scopeId] === true)

  const close = useCallback(() => {
    if (!scopeId) return
    setRaw((prev) => ({ ...(prev ?? {}), [scopeId]: true }))
  }, [scopeId, setRaw])

  return useMemo(() => ({ closed, close }), [closed, close])
}
