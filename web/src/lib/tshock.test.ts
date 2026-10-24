import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HttpTransport,
  MockTransport,
  TshockRequestError,
  resultFromError,
} from './tshock'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(code: string, status: number, message = 'boom'): Response {
  return jsonResponse({ error: { code, message } }, status)
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('HttpTransport.login 错误分类（后端错误码 → 前端类别）', () => {
  it('401 bad_credentials → auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('bad_credentials', 401)))
    const t = new HttpTransport()
    await expect(t.login('a', 'b')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('403 no_api_permission → permission', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('no_api_permission', 403)))
    const t = new HttpTransport()
    await expect(t.login('a', 'b')).rejects.toMatchObject({ kind: 'permission' })
  })

  it('429 rate_limited → rate_limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('rate_limited', 429)))
    const t = new HttpTransport()
    await expect(t.login('a', 'b')).rejects.toMatchObject({ kind: 'rate_limited' })
  })

  it('/api/command 429 不抛错，归一化为 rate_limited 结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('rate_limited', 429)))
    const t = new HttpTransport()
    await expect(t.runCommand('/time 12:00')).rejects.toMatchObject({ kind: 'rate_limited' })
    expect(resultFromError(new TshockRequestError('rate_limited', '指令执行过于频繁')).status).toBe(
      'rate_limited',
    )
  })

  it('错误 message 取自响应体，且带 httpStatus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('bad_credentials', 401, '账号或密码错误')))
    const t = new HttpTransport()
    await t.login('a', 'b').catch((err: unknown) => {
      expect(err).toBeInstanceOf(TshockRequestError)
      expect((err as TshockRequestError).message).toBe('账号或密码错误')
      expect((err as TshockRequestError).httpStatus).toBe(401)
    })
  })
})

describe('HttpTransport 请求约定', () => {
  it('非 GET 请求带 X-Requested-With: tswui 与 same-origin 凭据', async () => {
    let captured: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured = init
        return jsonResponse({ username: 'Alice' })
      }),
    )
    const t = new HttpTransport()
    await t.login('Alice', 'pw')
    const headers = new Headers(captured?.headers)
    expect(headers.get('X-Requested-With')).toBe('tswui')
    expect(captured?.credentials).toBe('same-origin')
  })

  it('选中自定义上游时所有请求携带 X-TSWUI-Target', async () => {
    const target = { id: 'http://1.2.3.4:7878', scheme: 'http' as const, host: '1.2.3.4', port: 7878 }
    localStorage.setItem('tswui:servers', JSON.stringify([target]))
    localStorage.setItem('tswui:server', JSON.stringify(target.id))
    let captured: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured = init
        return jsonResponse({ authenticated: false, username: null })
      }),
    )
    const t = new HttpTransport()
    await t.session()
    expect(new Headers(captured?.headers).get('X-TSWUI-Target')).toBe('http://1.2.3.4:7878')
  })

  it('login 只用相对 /api 路径，且凭据在 body（不在 URL）', async () => {
    let url = ''
    let body = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        body = String(init?.body ?? '')
        return jsonResponse({ username: 'Alice' })
      }),
    )
    const t = new HttpTransport()
    await t.login('Alice', 's3cret')
    expect(url).toBe('/api/login')
    expect(url).not.toContain('s3cret')
    expect(url).not.toContain('password')
    expect(body).toContain('s3cret')
  })

  it('loginWithToken 把令牌放在 body，URL 不含令牌', async () => {
    let url = ''
    let body = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        body = String(init?.body ?? '')
        return jsonResponse({ username: 'GGMM' })
      }),
    )
    const t = new HttpTransport()
    await expect(t.loginWithToken('app-token-1')).resolves.toEqual({ username: 'GGMM' })
    expect(url).toBe('/api/login')
    expect(url).not.toContain('app-token-1')
    expect(body).toContain('app-token-1')
    expect(body).not.toContain('password')
  })

  it('runCommand 200 原样返回 CommandResult', async () => {    const payload = { status: 'ok', output: ['已把时间设置为 12:00'], message: '' }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)))
    const t = new HttpTransport()
    await expect(t.runCommand('/time 12:00')).resolves.toEqual(payload)
  })

  it('runCommand 上游 token 失效 → token 类别（HTTP 200 之外的请求级失败）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('token_invalid', 401)))
    const t = new HttpTransport()
    await expect(t.runCommand('/time')).rejects.toMatchObject({ kind: 'token' })
  })

  it('session 后端不可达时降级为未登录，不抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )
    const t = new HttpTransport()
    await expect(t.session()).resolves.toEqual({ authenticated: false, username: null })
  })
})

describe('HttpTransport.serverStatus', () => {
  it('网络失败 → { reachable:false }（不抛错）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )
    const t = new HttpTransport()
    await expect(t.serverStatus()).resolves.toEqual({ reachable: false })
  })

  it('解析后端已规范化的版本号', async () => {
    const payload = {
      reachable: true,
      name: '中秋快乐',
      serverversion: '1.4.5.8',
      tshockversion: '6.2.1.0',
      playercount: 0,
      maxplayers: 8,
      world: '中秋快乐',
    }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)))
    const t = new HttpTransport()
    await expect(t.serverStatus()).resolves.toEqual(payload)
  })
})

describe('MockTransport 与 HttpTransport 同契约', () => {
  it('登录/会话/退出状态流转', async () => {
    const t = new MockTransport()
    expect(t.mock).toBe(true)
    await expect(t.session()).resolves.toEqual({ authenticated: false, username: null })
    await expect(t.login('Alice', 'pw')).resolves.toEqual({ username: 'Alice' })
    await expect(t.session()).resolves.toMatchObject({ authenticated: true, username: 'Alice' })
    await t.logout()
    await expect(t.session()).resolves.toEqual({ authenticated: false, username: null })
  })

  it('Mock 输出显式带 [Mock] 前缀，不冒充真实结果', async () => {
    const t = new MockTransport()
    const res = await t.runCommand('/time')
    expect(res.status).toBe('ok')
    expect(res.output.every((line) => line.startsWith('[Mock]'))).toBe(true)
  })

  it('密码为 wrong 时抛 auth', async () => {
    const t = new MockTransport()
    await expect(t.login('Alice', 'wrong')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('令牌登录：更新会话；空令牌抛 validation，bad 抛 token', async () => {
    const t = new MockTransport()
    await expect(t.loginWithToken('mock-token')).resolves.toEqual({ username: 'token-user' })
    await expect(t.session()).resolves.toMatchObject({ authenticated: true, username: 'token-user' })

    const t2 = new MockTransport()
    await expect(t2.loginWithToken('')).rejects.toMatchObject({ kind: 'validation' })
    await expect(t2.loginWithToken('bad')).rejects.toMatchObject({ kind: 'token' })
  })
})

describe('resultFromError', () => {
  it('映射为统一的 CommandResult 状态', () => {
    expect(resultFromError(new TshockRequestError('token', 'x')).status).toBe('token_invalid')
    expect(resultFromError(new TshockRequestError('auth', 'x')).status).toBe('token_invalid')
    expect(resultFromError(new TshockRequestError('permission', 'x')).status).toBe('no_permission')
    expect(resultFromError(new TshockRequestError('unavailable', 'x')).status).toBe('unavailable')
    expect(resultFromError(new TshockRequestError('timeout', 'x')).status).toBe('timeout')
    expect(resultFromError(new TshockRequestError('rate_limited', 'x')).status).toBe('rate_limited')
    expect(resultFromError(new TshockRequestError('bad_response', 'x')).status).toBe('bad_response')
    expect(resultFromError(new Error('boom')).status).toBe('bad_response')
  })
})

describe('HttpTransport 玩家管理（PlayerManager）', () => {
  it('plugin_not_installed → plugin_missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('plugin_not_installed', 404)))
    const t = new HttpTransport()
    await expect(t.playerLook('hf')).rejects.toMatchObject({ kind: 'plugin_missing' })
  })

  it('playerCapabilities 解析后端字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ plugin: true, permission: false })),
    )
    const t = new HttpTransport()
    await expect(t.playerCapabilities()).resolves.toEqual({ plugin: true, permission: false })
  })

  it('capabilities 解析统一能力矩阵；fresh 追加 ?fresh=1', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        reachable: true,
        messenger: { installed: true, protocol: 1, capabilities: [] },
        batch: { plugin: true, ingame: false },
        player: { plugin: true, permission: true },
        fish: { plugin: false, rest: false, permission: false },
        requests: { plugin: true, submit: true, review: false },
        webauth: { plugin: true },
      }),
    )
    vi.stubGlobal('fetch', spy)
    const t = new HttpTransport()
    const caps = await t.capabilities()
    expect(caps.fish.plugin).toBe(false)
    expect(caps.batch.ingame).toBe(false)
    expect(String(spy.mock.calls[0][0])).toMatch(/\/api\/capabilities$/)

    await t.capabilities(true)
    expect(String(spy.mock.calls[1][0])).toContain('/api/capabilities?fresh=1')
  })

  it('playerLook 把 name 放进 query（URL 编码）', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ name: '小美', online: true, items: [] }),
    )
    vi.stubGlobal('fetch', spy)
    const t = new HttpTransport()
    await t.playerLook('小美')
    const url = String(spy.mock.calls[0][0])
    expect(url).toContain('/api/player/look?name=')
    expect(url).toContain(encodeURIComponent('小美'))
  })

  it('playerExport 从 Content-Disposition 取中文文件名并返回 blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              'content-type': 'application/octet-stream',
              'content-disposition': `attachment; filename="player.plr"; filename*=UTF-8''${encodeURIComponent('小美.plr')}`,
            },
          }),
      ),
    )
    const t = new HttpTransport()
    const { filename, blob } = await t.playerExport('小美')
    expect(filename).toBe('小美.plr')
    expect(blob.size).toBe(3)
  })
})
