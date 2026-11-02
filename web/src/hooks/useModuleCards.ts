import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import {
  DEFAULT_MODULE_CARDS,
  addModuleCard,
  createModuleCard,
  moduleCardsFor,
  removeModuleCard,
  sanitizeModuleCards,
  updateModuleCard,
  type ModuleCard,
} from '@/lib/moduleCards'
import { StorageKeys } from '@/lib/storage'

/** 读写「模块内用户添加的指令卡片」（按服务器 + 模块）。 */
export function useModuleCards(
  serverId: string,
  moduleId: string,
): {
  cards: ModuleCard[]
  add: (name: string, command: string) => void
  update: (id: string, patch: Partial<Pick<ModuleCard, 'name' | 'command'>>) => void
  remove: (id: string) => void
  /** 恢复默认：清掉这个模块里用户添加的全部卡片。 */
  reset: () => void
} {
  const [raw, setRaw] = useLocalState(StorageKeys.moduleCards, DEFAULT_MODULE_CARDS)
  const prefs = useMemo(() => sanitizeModuleCards(raw), [raw])
  const cards = useMemo(() => moduleCardsFor(prefs, serverId, moduleId), [prefs, serverId, moduleId])

  const add = useCallback(
    (name: string, command: string) => {
      // 卡片对象在 updater **外面**创建：StrictMode 会把 updater 跑两次，
      // 在里面生成 id 会一次点击加出两张卡。
      const card = createModuleCard(name, command)
      setRaw((prev) => addModuleCard(sanitizeModuleCards(prev), serverId, moduleId, card))
    },
    [setRaw, serverId, moduleId],
  )
  const update = useCallback(
    (id: string, patch: Partial<Pick<ModuleCard, 'name' | 'command'>>) => {
      setRaw((prev) => updateModuleCard(sanitizeModuleCards(prev), serverId, moduleId, id, patch))
    },
    [setRaw, serverId, moduleId],
  )
  const remove = useCallback(
    (id: string) => {
      setRaw((prev) => removeModuleCard(sanitizeModuleCards(prev), serverId, moduleId, id))
    },
    [setRaw, serverId, moduleId],
  )

  const reset = useCallback(() => {
    setRaw((prev) => {
      const prefs = sanitizeModuleCards(prev)
      const forServer = prefs.byServer[serverId]
      if (!forServer || !(moduleId in forServer)) return prefs
      const nextForServer = { ...forServer }
      delete nextForServer[moduleId]
      const byServer = { ...prefs.byServer }
      if (Object.keys(nextForServer).length > 0) byServer[serverId] = nextForServer
      else delete byServer[serverId]
      return { byServer }
    })
  }, [setRaw, serverId, moduleId])

  return { cards, add, update, remove, reset }
}
