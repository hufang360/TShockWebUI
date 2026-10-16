/**
 * 登录框记忆（`tswui:login` + `tswui:passwords`）。
 *
 * 背景：TShock 的 token 只存在后端内存，**TShock 或 WebUI 容器重启后即失效**，
 * 玩家需要重新登录。为免每次手输，登录框支持「记住密码」。
 *
 * 记忆策略（用户要求）：
 * - **用户名共用**：所有服务器共用同一用户名（`tswui:login.username`）。
 * - **密码按服务器分别记忆**：`tswui:passwords = { [serverId]: password }`，
 *   切换服务器后自动回填该服务器对应的密码。
 * - 「记住密码」为全局开关；关闭即清空全部密码。
 *
 * 安全权衡（用户明确要求，属已知取舍）：
 * - 这是**明文密码落盘**，`localStorage` 对 XSS 无保护；仅在可信网络 / 个人设备上使用。
 * - 浏览器依旧**不持有 TShock token**；token 只在后端内存（设计原则与约束 C15）。
 */

import { readJson, removeKey, StorageKeys, writeJson } from './storage'

export interface LoginMemory {
  username: string
  password: string
  remember: boolean
}

interface SharedMemory {
  username?: string
  remember?: boolean
}

function readPasswords(): Record<string, string> {
  const value = readJson<unknown>(StorageKeys.passwords, {})
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string') out[key] = val
  }
  return out
}

/** 读取记忆：用户名共用，密码取 `serverId` 对应的那条。 */
export function loadLoginMemory(serverId: string): LoginMemory {
  const shared = readJson<SharedMemory | null>(StorageKeys.login, null)
  const passwords = readPasswords()
  if (!shared || typeof shared !== 'object') {
    return { username: '', password: passwords[serverId] ?? '', remember: true }
  }
  return {
    username: typeof shared.username === 'string' ? shared.username : '',
    password: typeof passwords[serverId] === 'string' ? passwords[serverId] : '',
    // 未显式关闭时默认记住，贴合「重启后自动回填」的预期。
    remember: shared.remember !== false,
  }
}

/** 保存记忆：用户名全局共用，密码写入 `serverId`；`remember=false` 时清空全部。 */
export function saveLoginMemory(serverId: string, memory: LoginMemory): void {
  if (!memory.remember) {
    clearLoginMemory()
    return
  }
  writeJson(StorageKeys.login, { username: memory.username, remember: true })
  const passwords = readPasswords()
  if (memory.password) passwords[serverId] = memory.password
  else delete passwords[serverId]
  writeJson(StorageKeys.passwords, passwords)
}

/**
 * 清除记忆。
 * - 不传 `serverId`：清空全部（用户名 + 所有服务器密码）。
 * - 传 `serverId`：只清该服务器的密码，保留共用用户名与其它服务器。
 */
export function clearLoginMemory(serverId?: string): void {
  if (!serverId) {
    removeKey(StorageKeys.login)
    removeKey(StorageKeys.passwords)
    return
  }
  const passwords = readPasswords()
  delete passwords[serverId]
  writeJson(StorageKeys.passwords, passwords)
}
