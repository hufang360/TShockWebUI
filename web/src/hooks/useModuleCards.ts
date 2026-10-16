import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import {
  DEFAULT_MODULE_CARDS,
  addModuleCard,
  createModuleCard,
  moduleCardsFor,
  removeModuleCard,
  sanitizeModuleCards,
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
  remove: (id: string) => void
} {
  const [raw, setRaw] = useLocalState(StorageKeys.moduleCards, DEFAULT_MODULE_CARDS)
  const prefs = useMemo(() => sanitizeModuleCards(raw), [raw])
  const cards = useMemo(() => moduleCardsFor(prefs, serverId, moduleId), [prefs, serverId, moduleId])

  const add = useCallback(
    (name: string, command: string) => {
      setRaw((prev) => addModuleCard(sanitizeModuleCards(prev), serverId, moduleId, createModuleCard(name, command)))
    },
    [setRaw, serverId, moduleId],
  )
  const remove = useCallback(
    (id: string) => {
      setRaw((prev) => removeModuleCard(sanitizeModuleCards(prev), serverId, moduleId, id))
    },
    [setRaw, serverId, moduleId],
  )

  return { cards, add, remove }
}
