/**
 * 可激活模块（侧边栏入口）。
 *
 * 「设置 → 激活模块」会实时探测对应插件是否安装：
 * 安装后打开开关，模块入口才会出现在侧边栏；关闭则隐藏入口。
 *
 * **按服务器分开记忆**：不同服务器安装的插件不同，因此在 A 服激活的模块不会
 * 出现在 B 服的侧边栏。开关状态存 localStorage `tswui:modules`，结构为
 * `{ byServer: { [serverId]: ModuleId[] } }`。
 *
 * - 内置模块：玩家管理（PlayerManager）、鱼店（FishShop）、物资申请（WebUI 插件）、世界管理（WorldModify）。
 * - 自定义模块：用户自己「填名称 + 指令」创建的模块，id 以 `m:` 开头，
 *   定义存 `tswui:customModules`（见 `lib/customModules.ts`）。
 * - 模块内的「额外指令卡片」存 `tswui:moduleCards`（见 `lib/moduleCards.ts`）。
 */

export type ModuleId = string

export interface ModuleCardDef {
  /** i18n key。 */
  nameKey: string
  command: string
  /** 默认是否「手动执行」（不随自动 / 刷新全部执行）。 */
  manual?: boolean
}

export interface ModuleDef {
  id: ModuleId
  /** 侧边栏 / 设置里的展示名（i18n key）。 */
  titleKey: string
  /** 侧边栏副标题。 */
  hintKey: string
  /** 设置里对依赖插件的说明。 */
  requiresKey: string
  /** 固定指令卡片（不可删除）。 */
  cards?: ModuleCardDef[]
}

export const MODULE_DEFS: ModuleDef[] = [
  {
    id: 'players',
    titleKey: 'nav.players',
    hintKey: 'nav.playersHint',
    requiresKey: 'modules.requires.playerManager',
  },
  {
    id: 'store',
    titleKey: 'nav.store',
    hintKey: 'nav.storeHint',
    requiresKey: 'modules.requires.fishShop',
  },
  {
    id: 'requisition',
    titleKey: 'nav.requisition',
    hintKey: 'nav.requisitionHint',
    requiresKey: 'modules.requires.requests',
  },
  {
    id: 'world',
    titleKey: 'nav.world',
    hintKey: 'nav.worldHint',
    requiresKey: 'modules.requires.worldModify',
    cards: [
      { nameKey: 'world.card.info', command: '/wi' },
      { nameKey: 'world.card.boss', command: '/bi' },
      // 这两个指令常只授权给管理员：默认手动执行，避免「进入页面/刷新全部」时被误触发。
      { nameKey: 'world.card.relive', command: '/relive', manual: true },
      { nameKey: 'world.card.cleartomb', command: '/cleartomb', manual: true },
    ],
  },
]

export const MODULE_BY_ID = new Map(MODULE_DEFS.map((m) => [m.id, m]))

/** 自定义模块 id 前缀。 */
export const CUSTOM_MODULE_PREFIX = 'm:'

export function isCustomModuleId(id: string): boolean {
  return id.startsWith(CUSTOM_MODULE_PREFIX) && id.length > CUSTOM_MODULE_PREFIX.length
}

export interface ModulesPrefs {
  /** serverId -> 已激活的模块 id 列表。 */
  byServer: Record<string, ModuleId[]>
}

export const DEFAULT_MODULES: ModulesPrefs = { byServer: {} }

/** 插件探测结果：仅包含能可靠探测到插件的内置模块。 */
export interface ModuleDetection {
  /** PlayerManager 已安装且当前用户组有权限。 */
  players: boolean
  /** FishShop 已安装且当前用户组有权限。 */
  store: boolean
  /** 信使插件已安装且当前用户可提交物资申请。 */
  requisition: boolean
}

/** 能通过插件探测确认可用、可自动激活的内置模块（世界管理无法探测，保持手动）。 */
const AUTO_ACTIVATABLE: readonly (keyof ModuleDetection)[] = ['players', 'store', 'requisition']

/**
 * 自动激活：把「探测到插件且可用」的内置模块写进已激活列表（侧边栏入口随之出现）。
 *
 * - 只处理能探测到插件的模块（玩家管理 / 鱼店）；世界管理无法可靠探测，不自动激活。
 * - 已经激活的、或用户**手动改过开关**（记录在 `userSet`）的模块保持原样，不覆盖用户选择。
 * - 无变化时返回原对象（调用方据此避免无意义的写入）。
 */
export function autoActivateModules(
  prefs: ModulesPrefs,
  userSet: ModulesPrefs,
  serverId: string,
  detected: ModuleDetection,
): ModulesPrefs {
  let next = prefs
  for (const id of AUTO_ACTIVATABLE) {
    if (!detected[id]) continue
    if (isModuleEnabled(next, serverId, id)) continue
    if (isModuleEnabled(userSet, serverId, id)) continue
    next = setModuleEnabled(next, serverId, id, true)
  }
  return next
}

export function isModuleEnabled(prefs: ModulesPrefs, serverId: string, id: ModuleId): boolean {
  return (prefs.byServer[serverId] ?? []).includes(id)
}

export function setModuleEnabled(
  prefs: ModulesPrefs,
  serverId: string,
  id: ModuleId,
  on: boolean,
): ModulesPrefs {
  const current = prefs.byServer[serverId] ?? []
  const next = on ? Array.from(new Set([...current, id])) : current.filter((x) => x !== id)
  const byServer = { ...prefs.byServer }
  if (next.length === 0) delete byServer[serverId]
  else byServer[serverId] = next
  return { byServer }
}

/**
 * 从未知持久化数据恢复：丢弃非法模块 id 与空服务器项。
 * 合法 id = 内置模块 id，或自定义模块 `m:` 前缀（自定义模块是否还存在由 nav 渲染时判断）。
 */
export function sanitizeModules(value: unknown): ModulesPrefs {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const source =
    raw.byServer && typeof raw.byServer === 'object'
      ? (raw.byServer as Record<string, unknown>)
      : {}
  const byServer: Record<string, ModuleId[]> = {}
  const isKnown = (id: string) => MODULE_BY_ID.has(id) || isCustomModuleId(id)
  for (const [serverId, list] of Object.entries(source)) {
    if (!serverId || !Array.isArray(list)) continue
    const ids = list.filter((v): v is string => typeof v === 'string' && isKnown(v))
    const unique = Array.from(new Set(ids))
    if (unique.length > 0) byServer[serverId] = unique
  }
  return { byServer }
}
