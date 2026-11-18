import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { makeDataset } from '@/test/fixtures'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import type { CommandResult, Dataset, HistoryEntry } from '@/types'
import { NO_INGAME, type IngamePolicy } from '@/lib/ingame'
import { useCommandRunner } from './useCommandRunner'

const dataset: Dataset = makeDataset()

function fakeTransport(runCommand: (cmd: string, ingame?: boolean) => Promise<CommandResult>) {
  return { mock: false, label: 'test', runCommand } as unknown as BackendTransport
}

function setup(overrides: {
  runCommand?: (cmd: string, ingame?: boolean) => Promise<CommandResult>
  authenticated?: boolean
  ingame?: IngamePolicy
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
        ingame: overrides.ingame ?? NO_INGAME,
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

  it('放行（名单为空 = 不限定）时 allowServer=false 的指令以 ingame 身份执行', async () => {
    const { result, runCommand } = setup({ ingame: { enabled: true, commands: [] } })
    await act(async () => {
      await result.current.run('/item 29')
    })
    expect(runCommand).toHaveBeenCalledWith('/item 29', true)
  })

  it('名单放行的指令走 ingame（别名也算），名单外的仍在前端拒绝', async () => {
    const { result, runCommand } = setup({ ingame: { enabled: true, commands: ['item'] } })
    await act(async () => {
      await result.current.run('/item 29')
    })
    expect(runCommand).toHaveBeenCalledWith('/item 29', true)

    // 别名同样命中：`/i` 是 item 的别名（数据里的定义带 aliases）。
    await act(async () => {
      await result.current.run('/i 29')
    })
    expect(runCommand).toHaveBeenCalledWith('/i 29', true)
  })

  it('名单不含这条时仍按 Tier A 拒绝，不发请求', async () => {
    const { result, runCommand, appendResult } = setup({
      ingame: { enabled: true, commands: ['spawnboss', 'spawnmob'] },
    })
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
  })

  it('仅游戏内被拦时，文案指出真正的原因（总闸 / 插件 / 名单）', async () => {
    const messages: string[] = []
    const collect = (overrides: Parameters<typeof setup>[0]) =>
      setup({
        ...overrides,
        runCommand: async () => ({ status: 'ok', output: [] }),
      })

    for (const policy of [
      { enabled: false, commands: [], plugin: true },
      { enabled: false, commands: [], plugin: false },
      { enabled: true, commands: ['spawnmob'], plugin: true },
      { enabled: true, commands: [], plugin: true, reachable: false },
    ]) {
      const { result, appendResult } = collect({ ingame: policy })
      await act(async () => {
        await result.current.run('/item 29')
      })
      messages.push(
        (appendResult.mock.calls.at(-1)?.[1] as { message: string }).message,
      )
    }

    expect(messages[0]).toContain('TSWUI_ALLOW_INGAME_COMMANDS')
    expect(messages[1]).toContain('信使插件')
    expect(messages[2]).toContain('不在服务器放行的游戏内指令名单里')
    expect(messages[3]).toContain('连不上服务器')
  })

  it('未登录时「仅游戏内」指令先提示登录（能力矩阵还没拿到，别误报服务器没开）', async () => {
    const { result, appendResult, runCommand } = setup({ authenticated: false })
    await act(async () => {
      await result.current.run('/item 29')
    })
    expect(runCommand).not.toHaveBeenCalled()
    expect(appendResult).toHaveBeenCalledWith(
      '/item 29',
      expect.objectContaining({ status: 'rejected', message: '请先登录后再执行指令' }),
    )
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
