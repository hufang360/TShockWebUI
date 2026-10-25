import type { CommandResult } from '@/types'
import {
  TshockRequestError,
  type BackendTransport,
  type BatchCapabilities,
  type ChatSendResult,
  type EventsPage,
  type EventsStreamHandlers,
  type FishBuyResult,
  type FishCapabilities,
  type FishGood,
  type FishShop,
  type MeInfo,
  type NameItem,
  type PlayerCapabilities,
  type PlayerLook,
  type PluginDataType,
  type PluginStatus,
  type Requisition,
  type RequisitionItem,
  type RequestCapabilities,
  type RuntimeCommand,
  type ServerEvent,
  type ServerInfo,
  type ServerInfoExtra,
  type ServerStatus,
  type Session,
  type ServerCapabilities,
  type SessionInfo,
  type TshockErrorKind,
  type WebAuthCapabilities,
} from './transport'
import { activeTargetHeader } from './servers'

/**
 * 真实传输层：同源 `/api/*`（docs/API_SPEC.md）。
 *
 * - 相对路径（`/api`），故 `http://IP:8080` 与 `https://域名` 均可用。
 * - `credentials: 'same-origin'` 携带 HttpOnly 会话 Cookie。
 * - 所有非 GET 请求带 `X-Requested-With: tswui`（CSRF 防线）。
 * - 绝不接触 TShock token / 密码持久化：密码只出现在 login 的 body。
 */

const API_BASE = '/api'

/** 后端错误码 → 前端类别（docs/API_SPEC.md 第 0 节）。 */
function kindFromCode(code: string | undefined): TshockErrorKind {
  switch (code) {
    case 'bad_credentials':
    case 'not_authenticated':
      return 'auth'
    case 'token_invalid':
      return 'token'
    case 'no_permission':
    case 'no_api_permission':
      return 'permission'
    case 'plugin_not_installed':
      return 'plugin_missing'
    case 'plugin_outdated':
      return 'plugin_outdated'
    case 'plugin_protocol_mismatch':
      return 'plugin_protocol'
    case 'player_offline':
    case 'online_auth_denied':
    case 'online_auth_error':
    case 'fishshop_error':
    case 'request_error':
      return 'validation'
    case 'online_auth_timeout':
      return 'timeout'
    case 'rate_limited':
      return 'rate_limited'
    case 'tshock_unavailable':
      return 'unavailable'
    case 'tshock_timeout':
      return 'timeout'
    case 'csrf':
    case 'bad_request':
      return 'validation'
    default:
      return 'bad_response'
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string }
}

async function readError(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await res.json()) as ErrorEnvelope
    return body.error ?? {}
  } catch {
    return {}
  }
}

async function request(path: string, init: RequestInit = {}, targetOverride?: string): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-Requested-With', 'tswui')
    // 默认 JSON，但允许调用方显式指定（如 .plr 导入用 application/octet-stream）。
    if (init.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json; charset=utf-8')
    }
  }
  // 多服务器切换：非内置默认时携带所选 TShock 上游（后端校验 http/https + host:port）。
  // targetOverride 为空串时强制「内置默认」（不带头），用于按行探测连通性。
  const target = targetOverride !== undefined ? targetOverride : activeTargetHeader()
  if (target) headers.set('X-TSWUI-Target', target)

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      method,
      headers,
      credentials: 'same-origin',
    })
  } catch (err) {
    // 浏览器主动取消（在线授权等待时点「取消」）应原样抛出，由调用方忽略。
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new TshockRequestError('network', '无法连接后端服务，请检查网络后重试')
  }

  if (!res.ok) {
    const { code, message } = await readError(res)
    throw new TshockRequestError(
      kindFromCode(code),
      message ?? `请求失败（HTTP ${res.status}）`,
      res.status,
    )
  }
  return res
}

export class HttpTransport implements BackendTransport {
  readonly mock = false
  readonly label = '真实服务器'

  async session(): Promise<Session> {
    try {
      const res = await request('/session')
      return (await res.json()) as Session
    } catch {
      // 后端不可达时视为未登录，界面仍可加载静态数据。
      return { authenticated: false, username: null }
    }
  }

  async servers(): Promise<ServerInfo> {
    try {
      const res = await request('/servers')
      return (await res.json()) as ServerInfo
    } catch {
      // 老后端没有该端点：视为不允许自定义上游。
      return { allowCustom: false, default: null }
    }
  }

  async login(username: string, password: string): Promise<{ username: string }> {
    const res = await request('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    return (await res.json()) as { username: string }
  }

  async loginWithToken(token: string): Promise<{ username: string }> {
    const res = await request('/login', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
    return (await res.json()) as { username: string }
  }

  async loginOnline(username: string, signal?: AbortSignal): Promise<{ username: string }> {
    const res = await request('/login/online', {
      method: 'POST',
      body: JSON.stringify({ username }),
      signal,
    })
    return (await res.json()) as { username: string }
  }

  async webauthCapabilities(): Promise<WebAuthCapabilities> {
    try {
      const res = await request('/webauth/capabilities')
      return (await res.json()) as WebAuthCapabilities
    } catch {
      // 探测失败时不阻断登录入口（仍允许尝试，真实错误在提交时反馈）。
      return { plugin: true }
    }
  }

  async batchCapabilities(): Promise<BatchCapabilities> {
    try {
      const res = await request('/batch/capabilities')
      return (await res.json()) as BatchCapabilities
    } catch {
      // 探测失败时乐观视为可用；真实错误在执行时反馈。
      return { plugin: true }
    }
  }

  async runBatch(cmds: string[]): Promise<CommandResult[]> {
    const res = await request('/batch', {
      method: 'POST',
      body: JSON.stringify({ cmds }),
    })
    const data = (await res.json()) as { results?: CommandResult[] }
    return data.results ?? []
  }

  async logout(): Promise<void> {
    // 后端会清 Cookie 与会话；此处不解析响应体。
    await request('/logout', { method: 'POST' })
  }

  async serverStatus(target?: string): Promise<ServerStatus> {
    try {
      const res = await request('/status', {}, target)
      return (await res.json()) as ServerStatus
    } catch {
      // 契约要求：探测失败返回 200 + reachable:false，不抛错。
      return { reachable: false }
    }
  }

  async playersList(): Promise<string[]> {
    const res = await request('/players')
    const data = (await res.json()) as { players?: string[] }
    return data.players ?? []
  }

  async runCommand(cmd: string, ingame = false): Promise<CommandResult> {
    const res = await request('/command', {
      method: 'POST',
      body: JSON.stringify(ingame ? { cmd, ingame: true } : { cmd }),
    })
    return (await res.json()) as CommandResult
  }

  async runtimeCommands(): Promise<RuntimeCommand[]> {
    const res = await request('/commands')
    const data = (await res.json()) as { commands?: RuntimeCommand[] }
    return data.commands ?? []
  }

  async me(): Promise<MeInfo> {
    const res = await request('/me')
    return (await res.json()) as MeInfo
  }

  async pluginData(type: PluginDataType): Promise<NameItem[]> {
    const res = await request(`/data?type=${encodeURIComponent(type)}`)
    const data = (await res.json()) as { items?: NameItem[] }
    return data.items ?? []
  }

  async serverInfoExtra(): Promise<ServerInfoExtra> {
    const res = await request('/serverinfo')
    return (await res.json()) as ServerInfoExtra
  }

  async events(since = 0, limit = 50): Promise<EventsPage> {
    const res = await request(`/events?since=${since}&limit=${limit}`)
    const data = (await res.json()) as EventsPage
    if (!data.events) data.events = []
    return data
  }

  async eventsTail(limit = 100): Promise<EventsPage> {
    const res = await request(`/events?tail=${limit}`)
    const data = (await res.json()) as EventsPage
    if (!data.events) data.events = []
    return data
  }

  eventsStream(handlers: EventsStreamHandlers, since: number): () => void {
    const controller = new AbortController()
    const headers = new Headers({ Accept: 'text/event-stream' })
    const target = activeTargetHeader()
    if (target) headers.set('X-TSWUI-Target', target)
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/events/stream?since=${since}`, {
          headers,
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          handlers.onError(new TshockRequestError('unavailable', `事件流连接失败（${res.status}）`))
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const parsed = parseSseFrame(frame)
            if (!parsed) continue
            if (parsed.event === 'error') {
              let kind: TshockErrorKind = 'bad_response'
              try {
                const d = JSON.parse(parsed.data) as { code?: string }
                kind = kindFromCode(d.code)
              } catch {
                /* 保持 bad_response */
              }
              handlers.onError(new TshockRequestError(kind, '事件流中断'))
              return
            }
            if (parsed.event === 'world') {
              try {
                handlers.onWorld?.(JSON.parse(parsed.data) as ServerInfoExtra)
              } catch {
                /* 忽略单帧坏数据 */
              }
              continue
            }
            try {
              handlers.onEvent(JSON.parse(parsed.data) as ServerEvent)
            } catch {
              /* 忽略单帧坏数据 */
            }
          }
        }
        if (!controller.signal.aborted) {
          handlers.onError(new TshockRequestError('unavailable', '事件流已断开'))
        }
      } catch (err) {
        if (controller.signal.aborted) return
        handlers.onError(err)
      }
    })()
    return () => controller.abort()
  }

  async sendChat(text: string): Promise<ChatSendResult> {
    const res = await request('/chat', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    return (await res.json()) as ChatSendResult
  }

  async sessions(): Promise<SessionInfo[]> {
    const res = await request('/sessions')
    const data = (await res.json()) as { sessions?: SessionInfo[] }
    return data.sessions ?? []
  }

  async pluginStatus(): Promise<PluginStatus> {
    const res = await request('/plugin/status')
    return (await res.json()) as PluginStatus
  }

  async capabilities(fresh = false): Promise<ServerCapabilities> {
    const res = await request(`/capabilities${fresh ? '?fresh=1' : ''}`)
    return (await res.json()) as ServerCapabilities
  }

  async revokeSessions(id?: string, all = false): Promise<number> {
    const res = await request('/sessions/revoke', {
      method: 'POST',
      body: JSON.stringify(all ? { all: true } : { id: id ?? '' }),
    })
    const data = (await res.json()) as { revoked?: number }
    return data.revoked ?? 0
  }

  async playerCapabilities(): Promise<PlayerCapabilities> {
    const res = await request('/player/capabilities')
    return (await res.json()) as PlayerCapabilities
  }

  async playerLook(name: string): Promise<PlayerLook> {
    const res = await request(`/player/look?name=${encodeURIComponent(name)}`)
    return (await res.json()) as PlayerLook
  }

  async playerExport(name: string): Promise<{ filename: string; blob: Blob }> {
    const res = await request(`/player/export?name=${encodeURIComponent(name)}`)
    const blob = await res.blob()
    return {
      filename: filenameFromDisposition(res.headers.get('Content-Disposition')) ?? `${name}.plr`,
      blob,
    }
  }

  async fishCapabilities(): Promise<FishCapabilities> {
    const res = await request('/fish/capabilities')
    return (await res.json()) as FishCapabilities
  }

  async fishList(): Promise<FishShop> {
    const res = await request('/fish/list')
    return (await res.json()) as FishShop
  }

  async fishAsk(serial: number): Promise<FishGood> {
    const res = await request(`/fish/ask?serial=${encodeURIComponent(String(serial))}`)
    return (await res.json()) as FishGood
  }

  async fishBuy(serial: number, amount: number, args?: string): Promise<FishBuyResult> {
    const res = await request('/fish/buy', {
      method: 'POST',
      body: JSON.stringify({ serial, amount, args: args ?? '' }),
    })
    return (await res.json()) as FishBuyResult
  }

  async requestCapabilities(): Promise<RequestCapabilities> {
    const res = await request('/requests/capabilities')
    return (await res.json()) as RequestCapabilities
  }

  async requestList(status?: string): Promise<Requisition[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    const res = await request(`/requests${qs}`)
    const body = (await res.json()) as { requests: Requisition[] }
    return body.requests ?? []
  }

  async requestCreate(items: RequisitionItem[], reason: string, note?: string): Promise<Requisition> {
    const res = await request('/requests', {
      method: 'POST',
      body: JSON.stringify({ items, reason, note: note ?? '' }),
    })
    const body = (await res.json()) as { request: Requisition }
    return body.request
  }

  async requestCancel(id: number): Promise<Requisition> {
    const res = await request('/requests/cancel', {
      method: 'POST',
      body: JSON.stringify({ id }),
    })
    const body = (await res.json()) as { request: Requisition }
    return body.request
  }

  async requestListAll(status?: string): Promise<Requisition[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    const res = await request(`/requests/all${qs}`)
    const body = (await res.json()) as { requests: Requisition[] }
    return body.requests ?? []
  }

  async requestReview(id: number, decision: 'approve' | 'deny', reason?: string): Promise<Requisition> {
    const res = await request('/requests/review', {
      method: 'POST',
      body: JSON.stringify({ id, decision, reason: reason ?? '' }),
    })
    const body = (await res.json()) as { request: Requisition }
    return body.request
  }

  async requestDeliver(id: number): Promise<Requisition> {
    const res = await request('/requests/deliver', {
      method: 'POST',
      body: JSON.stringify({ id }),
    })
    const body = (await res.json()) as { request: Requisition }
    return body.request
  }
}

/** 解析一帧 SSE（`event:` / `data:` 行，以空行分帧）。 */
function parseSseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

/** 从 Content-Disposition 解析文件名；优先 RFC 5987 的 `filename*=UTF-8''...`。 */
function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(value)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* 忽略非法转义，回退到普通 filename */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value)
  return plain ? plain[1] : null
}
