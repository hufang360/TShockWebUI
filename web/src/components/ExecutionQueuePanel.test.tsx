import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import {
  ExecutionQueueProvider,
  useExecutionQueue,
  type ExecutionQueueValue,
} from '@/lib/executionQueue'
import { ExecutionQueuePanel } from './ExecutionQueuePanel'

function Setup({ onReady }: { onReady: (api: ExecutionQueueValue) => void }) {
  const api = useExecutionQueue()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    onReady(api)
  }, [api, onReady])
  return <ExecutionQueuePanel />
}

let lastApi: ExecutionQueueValue | null = null

function renderPanel(interval = 0) {
  render(
    <I18nProvider lang="zh">
      <ExecutionQueueProvider interval={interval}>
        <Setup
          onReady={(api) => {
            lastApi = api
          }}
        />
      </ExecutionQueueProvider>
    </I18nProvider>,
  )
}

/** 入队两条：/who 会先执行（被 gate 挂起），/time 等待。返回释放函数。 */
function enqueueTwo(api: ExecutionQueueValue) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  api.enqueue({ key: 'home', label: '在线玩家', command: '/who', run: () => gate })
  api.enqueue({ key: 'home', label: '游戏时间', command: '/time', run: () => gate })
  return release
}

async function openQueue() {
  const btn = await screen.findByRole('button', { name: /执行队列/ })
  fireEvent.click(btn)
  const dialog = await screen.findByRole('dialog')
  return dialog
}

afterEach(() => {
  lastApi = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ExecutionQueuePanel', () => {
  it('队列为空时完全隐藏', () => {
    renderPanel()
    expect(screen.queryByText('执行队列')).toBeNull()
  })

  it('有请求时才出现；右侧显示数量，弹框里才展示实际内容', async () => {
    renderPanel()
    await waitFor(() => expect(lastApi).toBeTruthy())
    const release = enqueueTwo(lastApi!)

    // 队列非空后面板出现，且侧栏行右侧显示数量。
    await waitFor(() => expect(screen.getByText('执行队列')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
    // 侧栏不展示指令详情。
    expect(screen.queryByText('/who')).toBeNull()

    const dialog = await openQueue()
    expect(within(dialog).getByText('在线玩家')).toBeTruthy()
    expect(within(dialog).getByText('/who')).toBeTruthy()
    expect(within(dialog).getByText('游戏时间')).toBeTruthy()
    expect(within(dialog).getByText('/time')).toBeTruthy()
    release()
  })

  it('执行中的请求不可禁止；等待中的可禁止', async () => {
    renderPanel()
    await waitFor(() => expect(lastApi).toBeTruthy())
    const release = enqueueTwo(lastApi!)
    const dialog = await openQueue()

    await waitFor(() => expect(within(dialog).getByText('执行中')).toBeTruthy())
    const runningItem = within(dialog).getByText('执行中').closest('li') as HTMLElement
    expect(within(runningItem).getByText('/who')).toBeTruthy()
    expect(within(runningItem).queryByRole('button')).toBeNull()

    const waitingItem = within(dialog).getByText('/time').closest('li') as HTMLElement
    expect(within(waitingItem).getByRole('button', { name: '禁止此请求' })).toBeTruthy()
    release()
  })

  it('弹框里可禁止一条等待中的请求', async () => {
    renderPanel()
    await waitFor(() => expect(lastApi).toBeTruthy())
    const release = enqueueTwo(lastApi!)
    const dialog = await openQueue()

    await waitFor(() => expect(within(dialog).getByText('执行中')).toBeTruthy())
    const waitingItem = within(dialog).getByText('/time').closest('li') as HTMLElement
    fireEvent.click(within(waitingItem).getByRole('button', { name: '禁止此请求' }))

    await waitFor(() => expect(within(dialog).queryByText('/time')).toBeNull())
    expect(within(dialog).getByText('/who')).toBeTruthy()
    release()
  })
})
