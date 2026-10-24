import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { CommandResultsProvider } from '@/lib/commandResults'
import { ExecutionQueueProvider } from '@/lib/executionQueue'
import { DatasetProvider } from '@/lib/datasetContext'
import { resetRefreshGate } from '@/lib/refreshGate'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport } from '@/lib/tshock'
import { CommandModulePage, type FixedCardDef } from './CommandModulePage'

function fakeTransport(runCommand: (cmd: string) => Promise<{ status: 'ok'; output: string[] }>) {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'Alice' }),
    login: async () => ({ username: 'Alice' }),
    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    servers: async () => ({ allowCustom: false, default: null }),
    playersList: async () => [],
    runCommand: vi.fn(runCommand),
    ...playerStubs,
  } as unknown as BackendTransport
}

function renderPage(
  transport: BackendTransport,
  fixedCards: FixedCardDef[] = [
    { nameKey: 'world.card.info', command: '/wi' },
    { nameKey: 'world.card.boss', command: '/bi' },
  ],
  authenticated = true,
  onLogin: () => void = vi.fn(),
) {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <ExecutionQueueProvider interval={0}>
          <CommandResultsProvider serverId="default">
            <CommandModulePage
              dataset={makeDataset()}
              transport={transport}
              authenticated={authenticated}
              serverId="default"
              refreshInterval={0}
              onTokenInvalid={vi.fn().mockResolvedValue(true)}
              onLogin={onLogin}
              moduleId="world"
              keyPrefix="world:"
              title="世界管理"
              fixedCards={fixedCards}
            />
          </CommandResultsProvider>
        </ExecutionQueueProvider>
      </DatasetProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetRefreshGate()
})

afterEach(() => {
  localStorage.clear()
})

describe('CommandModulePage 未登录', () => {
  it('隐藏卡片列表，显示登录提示与登录按钮', () => {
    const onLogin = vi.fn()
    const transport = fakeTransport(async () => ({ status: 'ok', output: [] }))
    renderPage(transport, undefined, false, onLogin)

    expect(screen.getByText('请先登录！')).toBeTruthy()
    expect(screen.queryByText('指令卡片')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })
})

describe('CommandModulePage', () => {
  it('渲染固定卡片，并能添加自定义指令卡片', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['世界：测试'] })
    renderPage(fakeTransport(runCommand))

    // 固定卡片标题
    expect(screen.getByText('世界信息')).toBeTruthy()
    expect(screen.getByText('Boss 进度')).toBeTruthy()

    // 管理卡片弹框里添加一张卡片
    fireEvent.click(screen.getByRole('button', { name: /管理卡片/ }))
    fireEvent.click(screen.getByRole('button', { name: '添加卡片' }))
    fireEvent.change(screen.getByLabelText('卡片名称'), { target: { value: '时间' } })
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'time' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect((await screen.findAllByText('时间')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('/time').length).toBeGreaterThan(0)
  })

  it('手动执行的固定卡片：不自动执行、刷新全部也不执行，按钮为「执行」', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand), [
      { nameKey: 'world.card.info', command: '/wi' },
      { nameKey: 'world.card.relive', command: '/relive', manual: true },
    ])

    // 自动只跑非手动的 /wi。
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/wi'))
    expect(runCommand).not.toHaveBeenCalledWith('/relive')

    // 手动卡片的按钮是「执行」，不是「刷新」。
    expect(screen.getByRole('button', { name: '执行' })).toBeTruthy()

    // 「刷新全部」也不会执行手动卡片。
    fireEvent.click(screen.getByRole('button', { name: /刷新全部/ }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(runCommand).not.toHaveBeenCalledWith('/relive')

    // 点卡片自己的按钮才执行。
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/relive'))
  })
})
