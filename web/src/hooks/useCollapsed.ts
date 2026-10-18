import { useCallback, useState } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { StorageKeys } from '@/lib/storage'

/**
 * 记忆可折叠卡片的展开 / 折叠状态（存入 `tswui:collapsedCards`，key -> open）。
 *
 * 指令结果卡片与首页 / 模块的指令卡片在切换模块时会卸载再挂载；把状态放到本机后，
 * 回来时仍然是原来的展开 / 折叠状态（刷新页面也保留）。
 * 不同卡片用不同的 `key`（如 `home:status` / `world:relive` / `fish:rank`）。
 *
 * `key` 为 `undefined` 时不持久化，退化为组件内 state（供测试 / 临时卡片使用）。
 */
export function useCollapsed(
  key: string | undefined,
  defaultOpen = true,
): [boolean, (open: boolean) => void] {
  const [all, setAll] = useLocalState<Record<string, boolean>>(StorageKeys.collapsedCards, {})
  const [local, setLocal] = useState(defaultOpen)
  const open = key == null ? local : (all[key] ?? defaultOpen)
  const setOpen = useCallback(
    (next: boolean) => {
      if (key == null) setLocal(next)
      else setAll((prev) => ({ ...prev, [key]: next }))
    },
    [key, setAll],
  )
  return [open, setOpen]
}
