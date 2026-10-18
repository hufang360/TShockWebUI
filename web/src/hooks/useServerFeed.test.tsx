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
