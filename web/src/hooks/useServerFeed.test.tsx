import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TshockRequestError, type BackendTransport, type ServerEvent, type ServerInfoExtra } from '@/lib/tshock'
import { playerStubs } from '@/test/playerStubs'
import { useServerFeed } from './useServerFeed'

function fakeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'hf' }),
    servers: async () => ({ allowCustom: false, default: null }),
    login: async () => ({ username: 'hf' }),
    loginWithToken: async () => ({ username: 'hf' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    playersList: async () => [],
    runCommand: async () => ({ status: 'ok', output: [] }),
    ...playerStubs,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

/**
 * 回归：插件「检测时还没装、之后才装」时，事件流不能永久停摆。
 * 旧实现遇到 plugin_missing 会 clearInterval 且不再重试，只能整页刷新。
 */
it('插件缺失后会慢速自动重试，装好插件后自行恢复', async () => {
  vi.useFakeTimers()
  let installed = false
  const serverInfoExtra = vi.fn(async (): Promise<ServerInfoExtra> => {
    if (!installed) throw new TshockRequestError('plugin_missing', '未安装')
    return {} as ServerInfoExtra
  })
  const transport = fakeTransport({ serverInfoExtra, events: async () => ({ events: [], lastSeq: 0 }) })

  const { result } = renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  // 首次探测：插件缺失 → available=false。
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(result.current.available).toBe(false)

  // 服务器上装好插件，推进到慢速重试时间点（30s）。
  installed = true
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000)
  })
  expect(result.current.available).toBe(true)
})

/** 事件按 seq 升序保存：列表默认贴底时，最下面才是最新一条。 */
it('事件按 seq 升序保存（最旧在前、最新在后）', async () => {
  const transport = fakeTransport({
    serverInfoExtra: async () => ({}) as ServerInfoExtra,
    events: async () => ({
      events: [
        { seq: 3, type: 'join', text: 'c', time: '' },
        { seq: 1, type: 'join', text: 'a', time: '' },
        { seq: 2, type: 'join', text: 'b', time: '' },
      ],
      lastSeq: 3,
    }),
  })

  const { result } = renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  await waitFor(() => expect(result.current.events).toHaveLength(3))
  expect(result.current.events.map((e) => e.seq)).toEqual([1, 2, 3])
  expect(result.current.events.map((e) => e.text)).toEqual(['a', 'b', 'c'])
})

/** 新传输层提供 eventsTail 时：打开页面优先用「最近 N 条」历史。 */
it('提供 eventsTail 时优先取最近 N 条历史', async () => {
  const eventsTail = vi.fn(async () => ({
    events: [
      { seq: 1, type: 'join', text: 'a', time: '' },
      { seq: 2, type: 'join', text: 'b', time: '' },
    ],
    lastSeq: 2,
  }))
  const transport = fakeTransport({ eventsTail })

  const { result } = renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  await waitFor(() => expect(result.current.events).toHaveLength(2))
  expect(eventsTail).toHaveBeenCalled()
  expect(result.current.events.map((e) => e.seq)).toEqual([1, 2])
})

/** 提供 eventsStream（SSE）时：用长连接推送事件；断开后回退轮询。 */
it('提供 eventsStream 时用长连接接收事件', async () => {
  let emit: ((e: ServerEvent) => void) | null = null
  let fail: ((err: unknown) => void) | null = null
  const close = vi.fn()
  const eventsStream = vi.fn((handlers: { onEvent: (e: ServerEvent) => void; onError: (err: unknown) => void }) => {
    emit = handlers.onEvent
    fail = handlers.onError
    return close
  })
  const transport = fakeTransport({
    eventsTail: async () => ({ events: [], lastSeq: 0 }),
    eventsStream,
  })

  const { result } = renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  await waitFor(() => expect(eventsStream).toHaveBeenCalled())
  act(() => {
    emit?.({ seq: 7, type: 'chat', text: 'hf: hi', time: '' })
  })
  await waitFor(() => expect(result.current.events).toHaveLength(1))
  expect(result.current.events[0].seq).toBe(7)

  act(() => {
    fail?.(new Error('stream down'))
  })
  expect(close).toHaveBeenCalled()
})

/**
 * 同一个地址 / 端口后面可能换了另一个服（另一份存档目录）：
 * 插件事件库的 `instance` 变化后，旧事件必须清空，不能和新服的事件串在一起。
 */
it('实例标识变化时清空旧事件并按新实例重拉', async () => {
  let swapped = false
  const eventsTail = vi.fn(async () =>
    swapped
      ? {
          events: [{ seq: 1, type: 'join', text: '新服玩家', time: '' }],
          lastSeq: 1,
          instance: 'B',
        }
      : {
          events: [
            { seq: 41, type: 'join', text: '旧服玩家', time: '' },
            { seq: 42, type: 'join', text: '旧服玩家2', time: '' },
          ],
          lastSeq: 42,
          instance: 'A',
        },
  )
  const transport = fakeTransport({
    serverInfoExtra: async () => ({}) as ServerInfoExtra,
    eventsTail,
  })

  const { result } = renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  await waitFor(() => expect(result.current.events).toHaveLength(2))
  expect(result.current.events.map((e) => e.text)).toEqual(['旧服玩家', '旧服玩家2'])

  // 换服：新事件库从 seq=1 重新开始。
  swapped = true
  act(() => result.current.refresh())

  await waitFor(() => expect(result.current.events.map((e) => e.text)).toEqual(['新服玩家']))
  expect(eventsTail.mock.calls.length).toBeGreaterThanOrEqual(3)
  // 界面据此短暂提示「已切换服务器」（而不是让用户以为列表自己被清空了）。
  expect(result.current.switchedAt).not.toBeNull()
})

/** SSE 换实例时后端会发 `event: reset`：前端清空列表、重新取历史并重连。 */
it('SSE 收到 reset 帧后清空列表并重新连接', async () => {
  let instance = 'A'
  let emitReset: ((instance: string) => void) | null = null
  const close = vi.fn()
  const eventsTail = vi.fn(async () => ({
    events: [
      {
        seq: instance === 'A' ? 9 : 1,
        type: 'join',
        text: instance === 'A' ? '旧服' : '新服',
        time: '',
      },
    ],
    lastSeq: instance === 'A' ? 9 : 1,
    instance,
  }))
  const eventsStream = vi.fn(
    (handlers: { onEvent: (e: ServerEvent) => void; onReset?: (instance: string) => void }) => {
      emitReset = handlers.onReset ?? null
      return close
    },
  )
  const transport = fakeTransport({
    serverInfoExtra: async () => ({}) as ServerInfoExtra,
    eventsTail,
    eventsStream,
  })

  const { result } = renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  await waitFor(() => expect(eventsStream).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(result.current.events.map((e) => e.text)).toEqual(['旧服']))

  instance = 'B'
  act(() => emitReset?.('B'))

  await waitFor(() => expect(result.current.events.map((e) => e.text)).toEqual(['新服']))
  expect(close).toHaveBeenCalled()
  await waitFor(() => expect(eventsStream).toHaveBeenCalledTimes(2))
})

/**
 * 回归：SSE 已连接时点「刷新」以前什么都不拉（只把「刷新于」改成当前时间，安慰剂）。
 * 现在必须强制重新同步：断开长连接、重拉尾部事件、重连。
 */
it('手动刷新在 SSE 连接中也会真的重新拉取并重连', async () => {
  let emit: ((e: ServerEvent) => void) | null = null
  const close = vi.fn()
  let call = 0
  const eventsTail = vi.fn(async () => {
    call += 1
    return { events: [], lastSeq: 0, instance: 'X' }
  })
  const eventsStream = vi.fn(
    (handlers: { onEvent: (e: ServerEvent) => void; onWorld?: (i: ServerInfoExtra) => void }) => {
      emit = handlers.onEvent
      return close
    },
  )
  const transport = fakeTransport({
    serverInfoExtra: async () => ({}) as ServerInfoExtra,
    eventsTail,
    eventsStream,
  })

  const { result } = renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  await waitFor(() => expect(eventsStream).toHaveBeenCalledTimes(1))
  expect(eventsTail).toHaveBeenCalledTimes(1)
  expect(result.current.refreshing).toBe(false)

  // 流里的实时事件不应被手动刷新清掉。
  act(() => {
    emit?.({ seq: 3, type: 'chat', text: 'hf: hi', time: '' })
  })
  await waitFor(() => expect(result.current.events).toHaveLength(1))

  act(() => result.current.refresh())
  // 手动刷新期间按钮转圈。
  await waitFor(() => expect(result.current.refreshing).toBe(true))
  // 真的重新拉了尾部事件、断过流、又重新连上了。
  await waitFor(() => expect(eventsTail).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(close).toHaveBeenCalled())
  await waitFor(() => expect(eventsStream).toHaveBeenCalledTimes(2))
  // 拉完转圈停止，已有事件保留。
  await waitFor(() => expect(result.current.refreshing).toBe(false))
  expect(result.current.events.map((e) => e.seq)).toEqual([3])
})

/** 自动刷新令牌（页面刷新间隔 / 发言成功后）只需补拉一次，不该把 SSE 断掉重连。 */
it('自动刷新令牌只补拉一次，不断开 SSE', async () => {
  const close = vi.fn()
  const eventsTail = vi.fn(async () => ({ events: [], lastSeq: 0, instance: 'X' }))
  const eventsStream = vi.fn(() => close)
  const transport = fakeTransport({
    serverInfoExtra: async () => ({}) as ServerInfoExtra,
    eventsTail,
    eventsStream,
  })

  const { rerender } = renderHook(
    ({ token }: { token: number }) =>
      useServerFeed({
        transport,
        authenticated: true,
        serverId: 'default',
        refreshInterval: 60000,
        refreshToken: token,
      }),
    { initialProps: { token: 0 } },
  )

  await waitFor(() => expect(eventsStream).toHaveBeenCalledTimes(1))
  expect(eventsTail).toHaveBeenCalledTimes(1)

  rerender({ token: 1 })
  await act(async () => {
    await Promise.resolve()
  })
  // 流活跃时数据本来就实时到达：自动刷新不必补拉、不能重连（重连是手动刷新的事）。
  expect(eventsTail).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  expect(eventsStream).toHaveBeenCalledTimes(1)
})

/**
 * 登录态失效（换服后旧 token 通常失效 / 后端重启）：走统一的重新登录流程，
 * 而不是把 403 当成瞬时错误按刷新间隔反复重试。
 */
it('登录态失效时拉起重新登录，且只弹一次', async () => {
  const onTokenInvalid = vi.fn(async () => true)
  const transport = fakeTransport({
    serverInfoExtra: async () => {
      throw new TshockRequestError('token', '登录已失效')
    },
    events: async () => ({ events: [], lastSeq: 0 }),
  })

  renderHook(() =>
    useServerFeed({
      transport,
      authenticated: true,
      serverId: 'default',
      refreshInterval: 60000,
      onTokenInvalid,
    }),
  )

  await waitFor(() => expect(onTokenInvalid).toHaveBeenCalledTimes(1))
  // 不应因为「还没登录成功」而反复弹登录框。
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(onTokenInvalid).toHaveBeenCalledTimes(1)
})

/** 没有提供登录流程时保持旧行为：按瞬时错误重试（不永久停摆）。 */
it('未提供登录流程时 token 错误按瞬时错误重试', async () => {
  vi.useFakeTimers()
  const serverInfoExtra = vi.fn(async () => {
    throw new TshockRequestError('token', '登录已失效')
  })
  const transport = fakeTransport({ serverInfoExtra, events: async () => ({ events: [], lastSeq: 0 }) })

  renderHook(() =>
    useServerFeed({ transport, authenticated: true, serverId: 'default', refreshInterval: 60000 }),
  )

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(serverInfoExtra).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(serverInfoExtra.mock.calls.length).toBeGreaterThanOrEqual(2)
})
