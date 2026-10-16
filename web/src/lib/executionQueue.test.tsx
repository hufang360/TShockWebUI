import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExecutionQueueProvider,
  useExecutionQueue,
  type ExecutionQueueValue,
} from './executionQueue'

/** 把队列 api 暴露给测试：首次渲染后调用一次 onReady。 */
function Probe({ onReady }: { onReady: (api: ExecutionQueueValue) => void }) {
  const api = useExecutionQueue()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    onReady(api)
  }, [api, onReady])
  return (
    <div>
      <span data-testid="current">{api.current?.command ?? ''}</span>
      <span data-testid="pending">{api.pending.map((t) => t.command).join('|')}</span>
      <span data-testid="busy-any">{api.busy() ? '1' : '0'}</span>
      <span data-testid="busy-home">{api.busy('home') ? '1' : '0'}</span>
      <span data-testid="busy-home-prefix">{api.busyPrefix('home:') ? '1' : '0'}</span>
      <span data-testid="busy-editor-prefix">{api.busyPrefix('editor:') ? '1' : '0'}</span>
    </div>
  )
}

/** 最近一次渲染拿到的队列 api（函数引用稳定，可用于断言后的操作）。 */
let lastApi: ExecutionQueueValue | null = null

function renderQueue(interval: number, onReady: (api: ExecutionQueueValue) => void) {
  return render(
    <ExecutionQueueProvider interval={interval}>
      <Probe
        onReady={(api) => {
          lastApi = api
          onReady(api)
        }}
      />
    </ExecutionQueueProvider>,
  )
}

afterEach(() => {
  lastApi = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ExecutionQueueProvider', () => {
  it('串行执行任务，执行完一条再执行下一条', async () => {
    const order: string[] = []
    let releaseFirst = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    renderQueue(0, (api) => {
      api.enqueue({
        key: 'k',
        label: 'a',
        command: '/a',
        run: async () => {
          order.push('a')
          await gate
        },
      })
      api.enqueue({ key: 'k', label: 'b', command: '/b', run: async () => void order.push('b') })
    })

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('/a'))
    expect(order).toEqual(['a'])
    expect(screen.getByTestId('pending').textContent).toBe('/b')

    releaseFirst()
    await waitFor(() => expect(order).toEqual(['a', 'b']))
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe(''))
    expect(screen.getByTestId('pending').textContent).toBe('')
  })

  it('相同 key + command 不会重复入队', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    renderQueue(0, (api) => {
      api.enqueue({ key: 'k', label: 'a', command: '/a', run: () => gate })
      api.enqueue({ key: 'k', label: 'a', command: '/a', run: () => gate })
      api.enqueue({ key: 'k', label: 'b', command: '/b', run: () => gate })
    })

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('/a'))
    // 重复的 /a 被去重，只剩 /b 在等待。
    expect(screen.getByTestId('pending').textContent).toBe('/b')
    release()
  })

  it('可取消等待项，也可按来源批量取消（不影响正在执行的）', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let ids: string[] = []
    renderQueue(0, (api) => {
      ids = [
        api.enqueue({ key: 'home', label: 'a', command: '/a', run: () => gate }),
        api.enqueue({ key: 'home', label: 'b', command: '/b', run: () => gate }),
        api.enqueue({ key: 'other', label: 'c', command: '/c', run: () => gate }),
      ]
    })

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('/a'))
    const api = lastApi!
    expect(ids.filter(Boolean)).toHaveLength(3)

    act(() => api.cancel(ids[1]))
    expect(screen.getByTestId('pending').textContent).toBe('/c')

    act(() => api.cancelByKey('home'))
    expect(screen.getByTestId('pending').textContent).toBe('/c')

    act(() => api.clear())
    expect(screen.getByTestId('pending').textContent).toBe('')
    // 正在执行的 /a 不受取消影响。
    expect(screen.getByTestId('current').textContent).toBe('/a')
    release()
  })

  it('busy / busyPrefix 能按来源判断', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    renderQueue(0, (api) => {
      api.enqueue({ key: 'home:online', label: 'a', command: '/a', run: () => gate })
      api.enqueue({ key: 'other:x', label: 'b', command: '/b', run: () => gate })
    })

    await waitFor(() => expect(screen.getByTestId('busy-home-prefix').textContent).toBe('1'))
    expect(screen.getByTestId('busy-any').textContent).toBe('1')
    expect(screen.getByTestId('busy-editor-prefix').textContent).toBe('0')
    // 精确 key：(busy('home') 对 'home:online' 不匹配)
    expect(screen.getByTestId('busy-home').textContent).toBe('0')
    release()
  })

  it('空闲时首条立即执行，后续按间隔等待', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    renderQueue(1000, (api) => {
      api.enqueue({ key: 'k', label: 'a', command: '/a', run: async () => void order.push('a') })
      api.enqueue({ key: 'k', label: 'b', command: '/b', run: async () => void order.push('b') })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(order).toEqual(['a'])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(order).toEqual(['a', 'b'])
  })
})
