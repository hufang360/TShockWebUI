/**
 * localStorage 封装。
 * 统一前缀 tswui:（设计原则与约束 §4.6）。
 * **绝不写入密码或 TShock token**：登录态由后端 HttpOnly Cookie 维持。
 */

export const STORAGE_PREFIX = 'tswui:'

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
  /** 物品图鉴里收藏的物品 id（在「指令」模块的收藏 tab 展示）。 */
  itemFavorites: 'itemFavorites',
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
  /** 已激活模块（侧边栏入口）。 */
  modules: 'modules',
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
