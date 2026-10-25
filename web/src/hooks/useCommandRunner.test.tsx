import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { makeDataset } from '@/test/fixtures'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import type { CommandResult, Dataset, HistoryEntry } from '@/types'
import { useCommandRunner } from './useCommandRunner'

const dataset: Dataset = makeDataset()

function fakeTransport(runCommand: (cmd: string, ingame?: boolean) => Promise<CommandResult>) {
  return { mock: false, label: 'test', runCommand } as unknown as BackendTransport
}

function setup(overrides: {
  runCommand?: (cmd: string, ingame?: boolean) => Promise<CommandResult>
  authenticated?: boolean
  ingameAllowed?: boolean
  onTokenInvalid?: () => Promise<boolean>
  ds?: Dataset
} = {}) {
  const appendResult = vi.fn()
  const pushHistory = vi.fn()
  const runCommand = vi.fn(
    overrides.runCommand ??
      (async () => ({ status: 'ok' as const, output: ['ok'] })),
  )
  const onTokenInvalid = overrides.onTokenInvalid ?? vi.fn(async () => true)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider lang="zh">{children}</I18nProvider>
  )
  const view = renderHook(
    () =>
      useCommandRunner({
        dataset: overrides.ds ?? dataset,
        transport: fakeTransport(runCommand),
        authenticated: overrides.authenticated ?? true,
        ingameAllowed: overrides.ingameAllowed ?? false,
        onTokenInvalid,
        appendResult,
        pushHistory,
      }),
    { wrapper },
  )
  return { ...view, appendResult, pushHistory, runCommand, onTokenInvalid }
}

function lastHistory(call: { mock: { calls: unknown[][] } }): HistoryEntry {
  return call.mock.calls.at(-1)?.[0] as HistoryEntry
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCommandRunner', () => {
  it('空输入只追加一条 rejected，不发请求', async () => {
    const { result, appendResult, runCommand, pushHistory } = setup()
    let outcome = { dispatched: true }
    await act(async () => {
      outcome = await result.current.run('   ')
    })
    expect(outcome.dispatched).toBe(false)
    expect(runCommand).not.toHaveBeenCalled()
    expect(appendResult).toHaveBeenCalledWith('—', expect.objectContaining({ status: 'rejected' }))
    expect(pushHistory).not.toHaveBeenCalled()
  })

  it('allowServer=false 的指令在前端拒绝（Tier A），并记一条 rejected 历史', async () => {
    const { result, appendResult, runCommand, pushHistory } = setup()
    let outcome = { dispatched: true }
    await act(async () => {
      outcome = await result.current.run('/item 29')
    })
    expect(outcome.dispatched).toBe(false)
    expect(runCommand).not.toHaveBeenCalled()
    expect(appendResult).toHaveBeenCalledWith(
      '/item 29',
      expect.objectContaining({ status: 'rejected' }),
    )
    expect(lastHistory(pushHistory)).toMatchObject({ cmd: '/item 29', status: 'rejected', ok: false })
  })

  it('Tier B 打开后 allowServer=false 的指令以 ingame 身份执行', async () => {
    const { result, runCommand } = setup({ ingameAllowed: true })
    await act(async () => {
      await result.current.run('/item 29')
    })
    expect(runCommand).toHaveBeenCalledWith('/item 29', true)
  })

  it('未登录时不发请求，只追加 rejected', async () => {
    const { result, runCommand, appendResult } = setup({ authenticated: false })
    let outcome = { dispatched: true }
    await act(async () => {
      outcome = await result.current.run('/time day')
    })
    expect(outcome.dispatched).toBe(false)
    expect(runCommand).not.toHaveBeenCalled()
    expect(appendResult).toHaveBeenCalledWith(
      '/time day',
      expect.objectContaining({ status: 'rejected' }),
    )
  })

  it('token 失效 → 登录成功后自动重试一次，只追加最终结果', async () => {
    let calls = 0
    const { result, appendResult, pushHistory } = setup({
      runCommand: async () => {
        calls += 1
        return calls === 1
          ? { status: 'token_invalid', output: [], message: '登录已失效' }
          : { status: 'ok', output: ['已把时间设置为 12:00'] }
      },
    })
    let outcome = { dispatched: false }
    await act(async () => {
      outcome = await result.current.run('/time 12:00')
    })
    expect(calls).toBe(2)
    expect(outcome.dispatched).toBe(true)
    expect(appendResult).toHaveBeenCalledTimes(1)
    expect(appendResult).toHaveBeenCalledWith(
      '/time 12:00',
      expect.objectContaining({ status: 'ok' }),
    )
    expect(lastHistory(pushHistory)).toMatchObject({ status: 'ok', ok: true })
  })

  it('登录被取消时不重试，结果仍是 token_invalid', async () => {
    let calls = 0
    const { result, appendResult } = setup({
      runCommand: async () => {
        calls += 1
        return { status: 'token_invalid', output: [], message: '登录已失效' }
      },
      onTokenInvalid: async () => false,
    })
    await act(async () => {
      await result.current.run('/time day')
    })
    expect(calls).toBe(1)
    expect(appendResult).toHaveBeenCalledWith(
      '/time day',
      expect.objectContaining({ status: 'token_invalid' }),
    )
  })

  it('执行中的重复提交被挡住（只发一次请求）', async () => {
    let release: (r: CommandResult) => void = () => {}
    const runCommand = vi.fn(
      () =>
        new Promise<CommandResult>((resolve) => {
          release = resolve
        }),
    )
    const { result } = setup({ runCommand })
    let first: Promise<unknown> = Promise.resolve()
    let second: { dispatched: boolean } = { dispatched: true }
    await act(async () => {
      first = result.current.run('/time day')
      second = await result.current.run('/time day')
      release({ status: 'ok', output: ['done'] })
      await first
    })
    expect(second.dispatched).toBe(false)
    expect(runCommand).toHaveBeenCalledTimes(1)
  })
})
