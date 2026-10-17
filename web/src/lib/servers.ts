import { readJson, StorageKeys, writeJson } from './storage'

/** TShock REST 默认端口（与后端 tshock.DefaultPort 一致）。 */
export const DEFAULT_TSHOCK_PORT = 7878
export const SERVER_LIMIT = 50

export type TargetScheme = 'http' | 'https'

/** 一个可切换的 TShock 上游（host 与 port 分开，便于界面控件分别编辑）。 */
export interface ServerTarget {
  /** 唯一 id = scheme://host:port */
  id: string
  scheme: TargetScheme
  host: string
  port: number
}

/** 内置「服务器默认」：不发送 X-TSWUI-Target，使用后端 TSHOCK_URL。 */
export const BUILTIN_ID = 'default'

export function builtinTarget(): ServerTarget {
  return { id: BUILTIN_ID, scheme: 'http', host: '', port: DEFAULT_TSHOCK_PORT }
}

/**
 * host:port 展示串；IPv6 加方括号，避免 `2001:db8::1:7878` 这类冒号歧义。
 * 空 host（内置默认）不特殊处理，由调用方决定文案。
 */
export function hostPortLabel(host: string, port: number): string {
  const h = host.trim()
  const wrapped = h.includes(':') && !h.startsWith('[') ? `[${h}]` : h
  return `${wrapped}:${port}`
}

/** 界面展示用：默认项返回空串，由调用方给出「服务器默认」文案。 */
export function targetLabel(target: ServerTarget): string {
  return target.id === BUILTIN_ID ? '' : hostPortLabel(target.host, target.port)
}

/**
 * 隐私展示：对主机名 / IP 做遮挡，保留部分信息以便辨识，避免在界面上暴露完整地址。
 * - IPv4 `203.0.113.7` → `203.0.*.*`
 * - IPv6 `2001:db8::1` → `2001:****`
 * - 域名 `api.example.com` → `ap***.com`
 */
export function maskHost(host: string): string {
  const h = host.trim()
  if (!h) return h
  const bare = h.replace(/^\[|\]$/g, '')
  if (bare.includes(':')) {
    const groups = bare.split(':')
    return groups.length <= 1 ? '****' : `${groups[0]}:****`
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.')
    return `${p[0]}.${p[1]}.*.*`
  }
  const labels = h.split('.').filter(Boolean)
  if (labels.length >= 2) {
    const first = labels[0]
    const head = first.length <= 2 ? `${first[0]}***` : `${first.slice(0, 2)}***`
    return `${head}.${labels[labels.length - 1]}`
  }
  return h.length <= 2 ? `${h[0]}***` : `${h.slice(0, 2)}***`
}

/** 界面展示用（隐私遮挡版）：默认项返回空串。 */
export function maskedTargetLabel(target: ServerTarget): string {
  return target.id === BUILTIN_ID ? '' : hostPortLabel(maskHost(target.host), target.port)
}

/** 请求头值；内置默认返回 undefined（不携带该头）。 */
export function targetHeader(target: ServerTarget): string | undefined {
  if (target.id === BUILTIN_ID) return undefined
  return `${target.scheme}://${target.host}:${target.port}`
}

const HOST_RE = /^[A-Za-z0-9._-]+$|^\[[0-9A-Fa-f:.]+\]$/

export function isValidHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && HOST_RE.test(host)
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

export function makeTarget(host: string, port: number, scheme: TargetScheme): ServerTarget {
  const h = host.trim()
  return { id: `${scheme}://${h}:${port}`, scheme, host: h, port }
}

/** 丢弃非法/重复项（localStorage 可能被旧版本或手工改坏）。 */
export function sanitizeServers(value: unknown): ServerTarget[] {
  if (!Array.isArray(value)) return []
  const out: ServerTarget[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const host = typeof (raw as { host?: unknown }).host === 'string'
      ? (raw as { host: string }).host.trim()
      : ''
    const port = Number((raw as { port?: unknown }).port)
    const scheme: TargetScheme = (raw as { scheme?: unknown }).scheme === 'https' ? 'https' : 'http'
    if (!isValidHost(host) || !isValidPort(port)) continue
    const id = `${scheme}://${host}:${port}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, scheme, host, port })
  }
  return out.slice(0, SERVER_LIMIT)
}

export function loadServers(): ServerTarget[] {
  return sanitizeServers(readJson<unknown>(StorageKeys.servers, []))
}

export function saveServers(list: ServerTarget[]): void {
  writeJson(StorageKeys.servers, list)
}

/** 列表/编辑展示用完整 URL：`scheme://host:port`（IPv6 加方括号）。 */
export function formatTargetUrl(scheme: string, host: string, port: number): string {
  return `${scheme}://${hostPortLabel(host, port)}`
}

/** 列表/编辑展示用完整 URL（自定义项）。 */
export function targetUrl(target: ServerTarget): string {
  return formatTargetUrl(target.scheme, target.host, target.port)
}

export function addServerTarget(list: ServerTarget[], target: ServerTarget): ServerTarget[] {
  return [target, ...list.filter((s) => s.id !== target.id)].slice(0, SERVER_LIMIT)
}

/**
 * 修改一条已保存的上游：`oldId` 是要改的项，`next` 是新值（id 可能因 host/port/scheme 变化而变）。
 * 保持原有顺序；若 `oldId` 不在列表里则插到最前。
 */
export function updateServerTarget(
  list: ServerTarget[],
  oldId: string,
  next: ServerTarget,
): ServerTarget[] {
  const out: ServerTarget[] = []
  const seen = new Set<string>()
  for (const s of list) {
    const item = s.id === oldId ? next : s
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  if (!list.some((s) => s.id === oldId)) out.unshift(next)
  return out.slice(0, SERVER_LIMIT)
}

export function readActiveTargetId(): string {
  const id = readJson<unknown>(StorageKeys.server, BUILTIN_ID)
  return typeof id === 'string' && id.length > 0 ? id : BUILTIN_ID
}

export function writeActiveTargetId(id: string): void {
  writeJson(StorageKeys.server, id)
}

/** 按 id 解析当前上游；找不到则回退到内置默认。 */
export function resolveTarget(servers: ServerTarget[], id: string): ServerTarget {
  if (id === BUILTIN_ID) return builtinTarget()
  return servers.find((s) => s.id === id) ?? builtinTarget()
}

/** 供传输层在每次请求时读取当前上游（读 localStorage，天然跨标签页同步）。 */
export function activeTargetHeader(): string | undefined {
  return targetHeader(resolveTarget(loadServers(), readActiveTargetId()))
}

/**
 * 把 host / port 两个输入解析为一个上游：允许用户在 host 里直接粘贴
 * `1.2.3.4:7878`，此时用粘贴的端口覆盖端口输入框。
 */
export function parseTargetInput(
  hostInput: string,
  portInput: string,
  scheme: TargetScheme,
): { target: ServerTarget } | { error: 'host' | 'port' } {
  let host = hostInput.trim().replace(/^https?:\/\//i, '').split('/')[0]
  let port = portInput.trim()
  // 粘贴的 host 自带端口时拆分（IPv6 用 [..] 包裹，避免误拆）。
  if (!host.startsWith('[') && host.includes(':')) {
    const idx = host.lastIndexOf(':')
    port = host.slice(idx + 1)
    host = host.slice(0, idx)
  }
  host = host.replace(/^\[|\]$/g, '').split('@').pop()?.trim() ?? ''
  if (!isValidHost(host)) return { error: 'host' }
  const n = Number(port || DEFAULT_TSHOCK_PORT)
  if (!isValidPort(n)) return { error: 'port' }
  return { target: makeTarget(host, n, scheme) }
}
