import { afterEach, expect, it, vi } from 'vitest'
import { HttpTransport } from './httpTransport'
import type { ServerEvent, ServerInfoExtra } from './transport'

/** 把一段 SSE 文本做成 fetch 的响应（读完后自动结束，模拟服务端关流）。 */
function sseResponse(frames: string): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frames))
        controller.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * 换服时后端会推 `event: reset`：它既不能当成普通事件塞进列表，
 * 也要回调 onReset 让上层清空并重拉。
 */
it('SSE 的 reset / world 帧不会被当成普通事件', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      sseResponse(
        'event: world\ndata: {"hardMode":true,"dayTime":true,"time":0.5}\n\n' +
          'event: reset\ndata: {"instance":"B"}\n\n' +
          'event: message\ndata: {"seq":1,"type":"join","text":"新服玩家","time":""}\n\n',
      ),
    ),
  )

  const onEvent = vi.fn<(e: ServerEvent) => void>()
  const onWorld = vi.fn<(info: ServerInfoExtra) => void>()
  const onReset = vi.fn<(instance: string) => void>()
  const close = new HttpTransport().eventsStream(
    { onEvent, onWorld, onReset, onError: () => {} },
    5,
  )

  await vi.waitFor(() => expect(onReset).toHaveBeenCalledWith('B'))
  await vi.waitFor(() => expect(onEvent).toHaveBeenCalled())
  expect(onEvent).toHaveBeenCalledTimes(1)
  expect(onEvent.mock.calls[0][0]).toMatchObject({ seq: 1, type: 'join', text: '新服玩家' })
  expect(onWorld).toHaveBeenCalledTimes(1)
  expect(onWorld.mock.calls[0][0]).toMatchObject({ hardMode: true })

  close()
})

/** 建连被 403（换服后旧 token 失效等）：错误类别要保留，前端才会走重新登录。 */
it('SSE 建连失败时保留后端的错误类别', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'token_invalid', message: '登录已失效' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )

  const onError = vi.fn<(err: unknown) => void>()
  new HttpTransport().eventsStream({ onEvent: () => {}, onError }, 0)

  await vi.waitFor(() => expect(onError).toHaveBeenCalled())
  const err = onError.mock.calls[0][0] as { kind?: string; httpStatus?: number }
  expect(err.kind).toBe('token')
  expect(err.httpStatus).toBe(403)
})
