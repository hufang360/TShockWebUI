import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { CommandResultsProvider } from '@/lib/commandResults'
import { ExecutionQueueProvider } from '@/lib/executionQueue'
import { DEFAULT_HOME_CARDS, createCustomCard } from '@/lib/homeCards'
import { resetRefreshGate } from '@/lib/refreshGate'
import type { BackendTransport } from '@/lib/tshock'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { CommandResult } from '@/types'
import { HomePage } from './HomePage'

function fakeTransport(runCommand: (cmd: string) => Promise<CommandResult>): BackendTransport {
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
    runCommand,
    ...playerStubs,
  }
}

function seedHomeCards(value: unknown) {
  localStorage.setItem('tswui:homeCards', JSON.stringify(value))
}

function renderPage(
  transport: BackendTransport,
  authenticated = true,
  onLogin: () => void = vi.fn(),
) {
  return render(
    <I18nProvider lang="zh">
      <ExecutionQueueProvider interval={0}>
        <CommandResultsProvider>
          <HomePage
            dataset={makeDataset()}
            transport={transport}
            authenticated={authenticated}
            username="Alice"
            serverId="builtin"
            refreshInterval={120000}
            eventsRefreshInterval={180000}
            onTokenInvalid={vi.fn().mockResolvedValue(true)}
            onLogin={onLogin}
            onNavigate={vi.fn()}
          />
        </CommandResultsProvider>
      </ExecutionQueueProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRefreshGate()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('HomePage 未登录', () => {
  it('隐藏卡片内容，显示登录提示与登录按钮', () => {
    const onLogin = vi.fn()
    renderPage(fakeTransport(vi.fn()), false, onLogin)

    expect(screen.getByText('请先登录！')).toBeTruthy()
    expect(screen.queryByText('服务器状态')).toBeNull()
    expect(screen.queryByRole('button', { name: '管理卡片' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })
})

describe('HomePage 卡片管理', () => {
  it('默认渲染内置卡片，并可打开管理弹框列出所有卡片', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    expect(screen.getByText('服务器状态')).toBeTruthy()
    expect(screen.getByText('在线玩家')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '管理卡片' }))
    const dialog = screen.getByRole('dialog')
    // 内置卡片行：有「内置」徽标与指令，且不可编辑。
    const timeRow = within(dialog).getByRole('listitem', { name: '游戏时间' })
    expect(within(timeRow).getByText('内置')).toBeTruthy()
    expect(within(timeRow).getByText('/time')).toBeTruthy()
    expect(within(timeRow).queryByRole('textbox')).toBeNull()
    expect(within(timeRow).queryByRole('button', { name: '删除卡片' })).toBeNull()
  })

  it('内置卡片可隐藏，隐藏后首页不再渲染', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    fireEvent.click(screen.getByRole('button', { name: '管理卡片' }))
    const dialog = screen.getByRole('dialog')
    const timeRow = within(dialog).getByRole('listitem', { name: '游戏时间' })
    fireEvent.click(within(timeRow).getByRole('switch', { name: '隐藏' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))

    await waitFor(() => expect(screen.queryByText('游戏时间')).toBeNull())
    // 其余卡片仍在。
    expect(screen.getByText('在线玩家')).toBeTruthy()
  })

  it('自定义卡片按名称与指令渲染，并自动执行', async () => {
    const card = createCustomCard('钓鲈鱼', 'fish 鲈鱼')
    seedHomeCards({ ...DEFAULT_HOME_CARDS, order: [...DEFAULT_HOME_CARDS.order, card.id], custom: [card] })
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['ok'] })
    renderPage(fakeTransport(runCommand))

    // 自定义卡片随首页自动执行。
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/fish 鲈鱼'))

    const cardEl = screen.getByText('钓鲈鱼').closest('[data-slot="card"]') as HTMLElement
    expect(within(cardEl).getByText('/fish 鲈鱼')).toBeTruthy()
  })

  it('可添加自定义卡片并持久化到 localStorage', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    fireEvent.click(screen.getByRole('button', { name: '管理卡片' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))

    const nameInput = within(dialog).getByPlaceholderText('卡片名称')
    const cmdInput = within(dialog).getByPlaceholderText('/指令')
    // 点击「添加」后自动聚焦到名称输入框。
    expect(document.activeElement).toBe(nameInput)
    fireEvent.change(nameInput, { target: { value: '全服 公告' } })
    fireEvent.change(cmdInput, { target: { value: 'say hello' } })
    fireEvent.blur(cmdInput)

    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.getByText('全服 公告')).toBeTruthy())

    const stored = JSON.parse(localStorage.getItem('tswui:homeCards') ?? '{}')
    expect(stored.custom).toHaveLength(1)
    expect(stored.custom[0]).toMatchObject({ name: '全服 公告', command: '/say hello' })
  })

  it('自定义卡片可删除', async () => {
    const card = createCustomCard('钓鲈鱼', 'fish')
    seedHomeCards({ ...DEFAULT_HOME_CARDS, order: [...DEFAULT_HOME_CARDS.order, card.id], custom: [card] })
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    fireEvent.click(screen.getByRole('button', { name: '管理卡片' }))
    const dialog = screen.getByRole('dialog')
    const row = within(dialog).getByRole('listitem', { name: '钓鲈鱼' })
    fireEvent.click(within(row).getByRole('button', { name: '删除卡片' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))

    await waitFor(() => expect(screen.queryByText('钓鲈鱼')).toBeNull())
    const stored = JSON.parse(localStorage.getItem('tswui:homeCards') ?? '{}')
    expect(stored.custom).toHaveLength(0)
  })

  it('刷新按实际卡片顺序串行执行（自定义卡片在最前）', async () => {
    const card = createCustomCard('钓鲈鱼', 'fish 鲈鱼')
    seedHomeCards({ ...DEFAULT_HOME_CARDS, order: [card.id, ...DEFAULT_HOME_CARDS.order], custom: [card] })
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    // 等最后一条内置卡片执行完，检查整体调用顺序。
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/alldeath'))
    const calls = runCommand.mock.calls.map((c) => c[0])
    expect(calls[0]).toBe('/fish 鲈鱼')
    expect(calls[1]).toBe('/who')
  })

  it('2 分钟内的重复进入不会再次自动刷新卡片', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    const transport = fakeTransport(runCommand)
    const first = renderPage(transport)
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/who'))
    const callsAfterFirst = runCommand.mock.calls.length
    first.unmount()

    // 重新进入页面：闸门内 → 不再自动执行卡片指令。
    renderPage(transport)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(runCommand.mock.calls.length).toBe(callsAfterFirst)
  })

  it('点击「刷新全部」会再次执行自定义卡片', async () => {
    const card = createCustomCard('钓鲈鱼', 'fish 鲈鱼')
    seedHomeCards({ ...DEFAULT_HOME_CARDS, order: [...DEFAULT_HOME_CARDS.order, card.id], custom: [card] })
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/fish 鲈鱼'))
    const before = runCommand.mock.calls.filter((c) => c[0] === '/fish 鲈鱼').length

    // 等初始批次跑完，按钮恢复可点。
    await waitFor(() => screen.getByRole('button', { name: '刷新全部' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新全部' }))
    await waitFor(() =>
      expect(runCommand.mock.calls.filter((c) => c[0] === '/fish 鲈鱼').length).toBeGreaterThan(
        before,
      ),
    )
  })

  it('切走再切回：后台继续执行，结果仍在', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const runCommand = vi.fn().mockImplementation((cmd: string): Promise<CommandResult> => {
      // /who 卡住，模拟「刷新中途切页」。
      if (cmd === '/who') {
        return gate.then(() => ({ status: 'ok', output: ['在线玩家列表'] }))
      }
      return Promise.resolve({ status: 'ok', output: [] })
    })
    const transport = fakeTransport(runCommand)

    function Shell({ home }: { home: boolean }) {
      return (
        <I18nProvider lang="zh">
          <ExecutionQueueProvider interval={0}>
            <CommandResultsProvider>
              {home ? (
                <HomePage
                  dataset={makeDataset()}
                  transport={transport}
                  authenticated
                  username="Alice"
                  serverId="builtin"
                  refreshInterval={120000}
                  eventsRefreshInterval={180000}
                  onTokenInvalid={vi.fn().mockResolvedValue(true)}
                  onLogin={vi.fn()}
                  onNavigate={vi.fn()}
                />
              ) : (
                <p>其他页面</p>
              )}
            </CommandResultsProvider>
          </ExecutionQueueProvider>
        </I18nProvider>
      )
    }

    const view = render(<Shell home />)
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/who'))

    // 切走：HomePage 卸载，但队列不被取消，继续在后台执行。
    view.rerender(<Shell home={false} />)
    expect(screen.getByText('其他页面')).toBeTruthy()
    release()
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/alldeath'))

    // 切回：已完成的结果从全局存储直接读取。
    view.rerender(<Shell home />)
    await waitFor(() => expect(screen.getByText('在线玩家列表')).toBeTruthy())
  })

  it('最近执行：去重、成功普通色、失败红色、不显示状态标签', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time', ts: 3, ok: false, status: 'command_error' },
        { cmd: '/who', ts: 2, ok: true, status: 'ok' },
        { cmd: '/time', ts: 1, ok: true, status: 'ok' },
      ]),
    )
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    const recentCard = screen.getByText('最近执行').closest('[data-slot="card"]') as HTMLElement
    // 同一条指令只保留最近一次。
    const times = within(recentCard).getAllByText('/time')
    expect(times).toHaveLength(1)
    // 最近一次 /time 是失败 → 红色。
    expect(times[0].className).toContain('text-destructive')
    // /who 成功 → 普通前景色（不再用绿色）
    expect(within(recentCard).getByText('/who').className).toContain('text-foreground')
    // 不再显示「执行成功」状态标签。
    expect(within(recentCard).queryByText('执行成功')).toBeNull()
  })

  it('两栏布局：概览卡在右栏，指令卡在左栏', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport(runCommand))

    const left = await screen.findByTestId('home-left')
    const right = screen.getByTestId('home-right')
    // 右栏：服务器状态 / 服务器动态 / 快捷入口 / 最近执行
    for (const title of ['服务器状态', '服务器动态', '快捷入口', '最近执行']) {
      expect(within(right).getByText(title)).toBeTruthy()
    }
    // 左栏：指令卡
    expect(within(left).getByText('在线玩家')).toBeTruthy()
  })

  it('统一执行：勾选后「刷新全部」用一次批量请求执行全部卡片', async () => {
    localStorage.setItem('tswui:homeBatch', 'true')
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    const runBatch = vi
      .fn()
      .mockImplementation((cmds: string[]): Promise<CommandResult[]> =>
        Promise.resolve(cmds.map(() => ({ status: 'ok', output: [] }))),
      )
    renderPage({ ...fakeTransport(runCommand), runBatch })

    await waitFor(() => expect(runBatch).toHaveBeenCalled())
    const cmds = runBatch.mock.calls[0][0] as string[]
    expect(cmds).toContain('/who')
    expect(cmds).toContain('/time')
    // 批量模式下不应再逐条调用 runCommand。
    expect(runCommand).not.toHaveBeenCalled()

    const before = runBatch.mock.calls.length
    fireEvent.click(await screen.findByRole('button', { name: '刷新全部' }))
    await waitFor(() => expect(runBatch.mock.calls.length).toBeGreaterThan(before))
  })
})
