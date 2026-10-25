/**
 * localStorage 封装。
 * 统一前缀 tswui:（设计原则与约束 §4.6）。
 * **绝不写入密码或 TShock token**：登录态由后端 HttpOnly Cookie 维持。
 */

export const STORAGE_PREFIX = 'tswui:'

/**
 * 写入本地偏好后广播的事件名。
 * `useLocalState` 订阅它，使**同一页面内**多个组件共享同一偏好时保持同步
 * （如「统一执行」开关由 App 自动开启后，已挂载的首页/模块卡片能立刻感知）。
 */
export const STORAGE_EVENT = 'tswui:storage'

export const StorageKeys = {
  /** @deprecated 阶段 2 起不再写入；仅用于升级时清理旧数据（含 token）。 */
  auth: 'auth',
  /** 渲染缓存 { username, savedAt }，不含 token。 */
  me: 'me',
  /** 登录框记忆 { username, password, remember }；用户明确选择「记住密码」时才写入。 */
  login: 'login',
  draft: 'draft',
  history: 'history',
  favorites: 'favorites',
  /** 指令页最近几条结果卡片（含输出内容）。 */
  commandResults: 'commandResults',
  /** 浮动终端的窗口位置与尺寸 `{ x, y, w, h }`（桌面端；每次拖动 / 缩放后写入）。 */
  terminal: 'terminal',
  /** 浮动终端的输入草稿。与指令页草稿分开：终端执行后清空输入，不应抹掉页面里的草稿。 */
  terminalDraft: 'terminal:draft',
  /** 指令页右侧工具面板当前选中的 tab。 */
  commandTab: 'commandTab',
  /** 指令页顶部 tab（指令 / 聊天 / 小抄）。 */
  commandPageTab: 'commandPageTab',
  /** 可折叠卡片（指令结果 / 首页与模块卡片）的展开状态 { key: open }。 */
  collapsedCards: 'collapsedCards',
  /** 物品图鉴里收藏的物品 id（在「指令」模块的收藏 tab 展示）。 */
  itemFavorites: 'itemFavorites',
  /** 物品图鉴是否隐藏格子中的 ID 与名称（默认关闭，即默认显示）。 */
  dexHideItemMeta: 'dex:hideItemMeta',
  /** 数据 ID 是否隐藏图标格中的 ID 与名称（默认关闭，即默认显示）。 */
  dataIdHideMeta: 'dataId:hideMeta',
  /** 物品图鉴表格视图开关。 */
  dexTableView: 'dex:tableView',
  /** 物品图鉴两列表格开关。 */
  dexTableTwoCols: 'dex:tableTwoCols',
  /** 物品图鉴合成表「显示物品名称」开关（默认不勾选 = 仅图标；跨刷新记忆）。 */
  dexRecipeShowNames: 'dex:recipeShowNames',
  /** 物品图鉴合成表「两列视图」开关（默认不勾选 = 自适应多列）。 */
  dexRecipeTwoColumn: 'dex:recipeTwoColumn',
  /** 物品图鉴「最近搜索」（统一规则：最多 10 条，见 lib/searchHistory.ts）。 */
  dexSearchHistory: 'dex:searchHistory',
  /** 物品图鉴「最近使用的分组 / 制作页签」（最多 3 条）。 */
  dexGroupRecent: 'dex:groupRecent',
  /** NPC 图鉴「最近搜索」（统一规则：最多 10 条）。 */
  npcsSearchHistory: 'npcs:searchHistory',
  /** 数据 ID（图格 / 墙）速查表「最近搜索」（统一规则：最多 10 条）。 */
  tilesSearchHistory: 'tiles:searchHistory',
  /** 数据 ID 的 Buff 速查表「最近搜索」（统一规则：最多 10 条）。 */
  buffsSearchHistory: 'buffs:searchHistory',
  itemsRecent: 'items:recent',
  settings: 'settings',
  ui: 'ui',
  meta: 'meta',
  /** 自定义 TShock 上游列表（host/port 分开存）。 */
  servers: 'servers',
  /** 当前选中的上游 id。 */
  server: 'server',
  /** 按服务器分别记忆的密码 { [serverId]: password }（用户名共用）。 */
  passwords: 'passwords',
  /** 首页卡片布局（顺序 / 隐藏 / 自定义卡片）。 */
  homeCards: 'homeCards',
  /** 首页「统一执行」开关（批量执行）。 */
  homeBatch: 'homeBatch',
  /** 用户是否**手动**改过「统一执行」开关（改过就不再自动开启）。 */
  homeBatchSet: 'homeBatchSet',
  /** 已激活模块（侧边栏入口）。 */
  modules: 'modules',
  /** 用户是否**手动**改过各模块开关（改过就不再被「检测到插件自动激活」覆盖），按服务器记忆。 */
  modulesSet: 'modulesSet',
  /** 自定义模块定义 [{ id, name }]。 */
  customModules: 'customModules',
  /** 模块内用户添加的指令卡片。 */
  moduleCards: 'moduleCards',
  /** 指令卡片「是否手动执行」偏好（key -> true）。 */
  autoExec: 'autoExec',
  /** 各模块界面状态记忆（如玩家管理的玩家名、鱼店的筛选）。 */
  moduleState: 'moduleState',
  /** 玩家管理「简约视图」开关（默认开：隐藏银行与配装）。 */
  playersCompact: 'playersCompact',
  /** 玩家管理各分区（银行 / 配装）的折叠状态 { [key]: collapsed }。 */
  playersCollapsed: 'playersCollapsed',
} as const

type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]

const fullKey = (key: string) => `${STORAGE_PREFIX}${key}`

/** localStorage 不可用（隐私模式 / 禁用）时的降级存储。 */
const memoryMap = new Map<string, string>()
interface MiniStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
const memoryFallback: MiniStorage = {
  getItem: (key) => memoryMap.get(key) ?? null,
  setItem: (key, value) => {
    memoryMap.set(key, value)
  },
  removeItem: (key) => {
    memoryMap.delete(key)
  },
}
let backend: MiniStorage = memoryFallback

try {
  if (typeof window !== 'undefined' && window.localStorage) {
    // 探测可写性
    const probe = `${STORAGE_PREFIX}__probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    backend = window.localStorage
  }
} catch {
  backend = memoryFallback
}

export function readRaw(key: StorageKey): string | null {
  try {
    return backend.getItem(fullKey(key))
  } catch {
    return null
  }
}

export function readJson<T>(key: StorageKey, fallback: T): T {
  const raw = readRaw(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * 写入字符串。QuotaExceededError 时返回 false（调用方应丢弃旧历史后重试），
 * 绝不因为写满而抛出到 UI（设计原则与约束 §4.6）。
 */
export function writeRaw(key: StorageKey, value: string): boolean {
  try {
    backend.setItem(fullKey(key), value)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { key } }))
    }
    return true
  } catch {
    return false
  }
}

export function writeJson(key: StorageKey, value: unknown): boolean {
  return writeRaw(key, JSON.stringify(value))
}

export function removeKey(key: StorageKey): void {
  try {
    backend.removeItem(fullKey(key))
  } catch {
    /* ignore */
  }
}

/**
 * 写入 JSON；配额不足时用 fallback 裁剪一次再写。
 * 返回最终是否写入成功。
 */
export function writeJsonWithTrim<T>(
  key: StorageKey,
  value: T[],
  trim: (v: T[]) => T[],
): boolean {
  if (writeJson(key, value)) return true
  return writeJson(key, trim(value))
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return wrapped
}
