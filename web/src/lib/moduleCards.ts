/**
 * 模块内用户添加的「指令卡片」。
 *
 * 存 localStorage `tswui:moduleCards`，结构：
 * `{ byServer: { [serverId]: { [moduleId]: ModuleCard[] } } }`。
 * - 内置模块（世界管理）在固定卡片之后追加；
 * - 鱼店在 4 张固定卡片之后追加；
 * - 自定义模块的卡片全部来自这里。
 */

import { isCustomModuleId, MODULE_BY_ID } from './modules'

export interface ModuleCard {
  id: string
  /** 显示名；为空时回退用指令。 */
  name: string
  /** 指令原文（执行前再规范化）。 */
  command: string
}

export interface ModuleCardsPrefs {
  byServer: Record<string, Record<string, ModuleCard[]>>
}

export const DEFAULT_MODULE_CARDS: ModuleCardsPrefs = { byServer: {} }

function newId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `c:${rand}`
}

export function createModuleCard(name = '', command = ''): ModuleCard {
  return { id: newId(), name, command }
}

export function moduleCardsFor(
  prefs: ModuleCardsPrefs,
  serverId: string,
  moduleId: string,
): ModuleCard[] {
  return prefs.byServer[serverId]?.[moduleId] ?? []
}

export function addModuleCard(
  prefs: ModuleCardsPrefs,
  serverId: string,
  moduleId: string,
  card: ModuleCard,
): ModuleCardsPrefs {
  const forServer = prefs.byServer[serverId] ?? {}
  const list = forServer[moduleId] ?? []
  return {
    byServer: {
      ...prefs.byServer,
      [serverId]: { ...forServer, [moduleId]: [...list, card] },
    },
  }
}

export function updateModuleCard(
  prefs: ModuleCardsPrefs,
  serverId: string,
  moduleId: string,
  cardId: string,
  patch: Partial<Pick<ModuleCard, 'name' | 'command'>>,
): ModuleCardsPrefs {
  const forServer = prefs.byServer[serverId]
  const list = forServer?.[moduleId]
  if (!forServer || !list) return prefs
  return {
    byServer: {
      ...prefs.byServer,
      [serverId]: {
        ...forServer,
        [moduleId]: list.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
      },
    },
  }
}

export function removeModuleCard(
  prefs: ModuleCardsPrefs,
  serverId: string,
  moduleId: string,
  cardId: string,
): ModuleCardsPrefs {
  const forServer = prefs.byServer[serverId]
  const list = forServer?.[moduleId]
  if (!forServer || !list) return prefs
  const next = list.filter((c) => c.id !== cardId)
  const nextForServer = { ...forServer }
  if (next.length === 0) delete nextForServer[moduleId]
  else nextForServer[moduleId] = next
  const byServer = { ...prefs.byServer }
  if (Object.keys(nextForServer).length === 0) delete byServer[serverId]
  else byServer[serverId] = nextForServer
  return { byServer }
}

const knownModule = (id: string) => MODULE_BY_ID.has(id) || isCustomModuleId(id)

export function sanitizeModuleCards(value: unknown): ModuleCardsPrefs {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const source =
    raw.byServer && typeof raw.byServer === 'object'
      ? (raw.byServer as Record<string, unknown>)
      : {}
  const byServer: Record<string, Record<string, ModuleCard[]>> = {}
  for (const [serverId, modulesRaw] of Object.entries(source)) {
    if (!serverId || !modulesRaw || typeof modulesRaw !== 'object') continue
    const modules: Record<string, ModuleCard[]> = {}
    for (const [moduleId, listRaw] of Object.entries(modulesRaw as Record<string, unknown>)) {
      if (!knownModule(moduleId) || !Array.isArray(listRaw)) continue
      const cards: ModuleCard[] = []
      const seen = new Set<string>()
      for (const item of listRaw) {
        if (!item || typeof item !== 'object') continue
        const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : ''
        if (!id || seen.has(id)) continue
        const name = (item as { name?: unknown }).name
        const command = (item as { command?: unknown }).command
        seen.add(id)
        cards.push({
          id,
          name: typeof name === 'string' ? name : '',
          command: typeof command === 'string' ? command : '',
        })
      }
      if (cards.length > 0) modules[moduleId] = cards
    }
    if (Object.keys(modules).length > 0) byServer[serverId] = modules
  }
  return { byServer }
}
