import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { StorageKeys } from '@/lib/storage'

/** `tswui:moduleState` 的结构：serverId -> 模块 id -> 任意界面状态。 */
export type ModuleStateMap = Record<string, Record<string, Record<string, unknown>>>

/**
 * 按「服务器 + 模块」记忆界面状态（存入 `tswui:moduleState`），刷新页面后自动恢复。
 * 用于「玩家管理」「鱼店」等模块记住玩家名、筛选条件等。
 * 不同服务器的玩家名 / 货架不同，故按 serverId 分开存储。
 */
export function useModuleState<T extends Record<string, unknown>>(
  serverId: string,
  moduleId: string,
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const [all, setAll] = useLocalState<ModuleStateMap>(StorageKeys.moduleState, {})
  const state = useMemo(
    () => ({ ...defaults, ...(all[serverId]?.[moduleId] ?? {}) }) as T,
    // defaults 由调用方以常量传入；这里只依赖已持久化的部分。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, serverId, moduleId],
  )
  const update = useCallback(
    (patch: Partial<T>) => {
      setAll((prev) => ({
        ...prev,
        [serverId]: {
          ...(prev[serverId] ?? {}),
          [moduleId]: { ...(prev[serverId]?.[moduleId] ?? {}), ...patch },
        },
      }))
    },
    [serverId, moduleId, setAll],
  )
  return [state, update]
}
