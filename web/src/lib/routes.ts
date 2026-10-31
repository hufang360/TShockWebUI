import { sanitizeCustomModules, type CustomModule } from '@/lib/customModules'
import { readJson, StorageKeys } from '@/lib/storage'
import type { TabId } from '@/types'

/**
 * URL hash ↔ TabId 的唯一映射。
 *
 * 内置页面用短名（`#/cmd`、`#/plr`、`#/pm`、`#/wm`、`#/fish`），自定义模块用
 * 「主指令」派生的 `#/ext-<主指令>`（如 `/clip` → `#/ext-clip`），而不是内部的 `m:<uuid>`。
 * 老 hash（`#/save`、`#/players`、`#/store`、`#/commands` …）继续解析到同一页面。
 */

/** 内置 tab → hash 片段。 */
const TAB_SEGMENT: Record<string, string> = {
  editor: 'cmd',
  chat: 'chat',
  commands: 'commands',
  save: 'plr',
  worldview: 'wld',
  players: 'pm',
  world: 'wm',
  store: 'fish',
  spritesheet: 'slice',
}

/** 短名 / 旧名 → tab。 */
const SEGMENT_TAB: Record<string, TabId> = {
  cmd: 'editor',
  editor: 'editor',
  chat: 'chat',
  plr: 'save',
  save: 'save',
  wld: 'worldview',
  worldview: 'worldview',
  pm: 'players',
  players: 'players',
  wm: 'world',
  world: 'world',
  fish: 'store',
  store: 'store',
  slice: 'spritesheet',
  commands: 'commands',
  spawn: 'commands',
  history: 'editor',
  favorites: 'editor',
  npcs: 'dataid',
  tiles: 'dataid',
  codex: 'dataid',
}

/** 自定义模块的「主指令」token（去掉前导 `/`，取第一个词）。 */
export function customModuleToken(mod: CustomModule): string {
  return (mod.command ?? '').trim().replace(/^\/+/, '').split(/\s+/)[0]?.toLowerCase() ?? ''
}

/** 自定义模块 → `ext-<主指令>`；没有主指令时退回 id。 */
export function customModuleHash(mod: CustomModule): string {
  const token = customModuleToken(mod)
  return token ? `ext-${token}` : `ext-${mod.id.replace(/[^a-z0-9-]/gi, '').toLowerCase()}`
}

/** TabId → `#/xxx`。自定义模块需要模块列表才能反查主指令。 */
export function tabHash(
  tab: TabId,
  customModules: CustomModule[] = readCustomModulesFromStorage(),
): string {
  if (tab.startsWith('m:')) {
    const mod = customModules.find((item) => item.id === tab)
    if (mod) return `#/${customModuleHash(mod)}`
  }
  return `#/${TAB_SEGMENT[tab] ?? tab}`
}

/** `#/xxx` → TabId；无法识别返回 null。 */
export function readTabFromHash(
  customModules: CustomModule[] = readCustomModulesFromStorage(),
): TabId | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (!raw) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const segment = decoded.toLowerCase()
  if (segment.startsWith('ext-')) {
    const token = segment.slice(4)
    const mod = customModules.find((item) => customModuleToken(item) === token)
    return mod ? mod.id : null
  }
  // 旧的自定义模块地址（`m:<uuid>`）。
  if (decoded.startsWith('m:')) {
    return customModules.some((item) => item.id === decoded) ? decoded : null
  }
  return SEGMENT_TAB[segment] ?? (decoded as TabId)
}

/** 从本机存储读出已启用的自定义模块（hashchange 回调里没有 React 状态时用）。 */
export function readCustomModulesFromStorage(): CustomModule[] {
  return sanitizeCustomModules(readJson<CustomModule[]>(StorageKeys.customModules, []))
}
