import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { CommandResult, Settings } from '@/types'
import { CommandPage } from './CommandPage'

const settings: Settings = {
  theme: 'dark',
  fontSize: 15,
  showIcons: true,
  insertWithCount: false,
  liveMode: false,
  language: 'zh',
  compact: true,
  commandInterval: 2000,
  refreshInterval: 120000,
  eventsRefreshInterval: 180000,
}

function fakeTransport(runCommand: (cmd: string) => Promise<CommandResult>): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'Alice' }),
    login: async () => ({ username: 'Alice' }),    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    servers: async () => ({
      allowCustom: true,
      default: { scheme: 'http', host: '127.0.0.1', port: 7878 },
    }),
    playersList: async () => [],
    runCommand,
    ...playerStubs,
  }
}

function renderEditor(transport: BackendTransport, onTokenInvalid: () => Promise<boolean>) {
  return render(
    <I18nProvider lang="zh">
      <CommandPage
        dataset={makeDataset()}
        transport={transport}
        authenticated
        settings={settings}
        serverId="default"
        players={[]}
        ingameAllowed={false}
        onTokenInvalid={onTokenInvalid}
      />
    </I18nProvider>,
  )
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CommandPage token 失效处理', () => {
  it('token_invalid 时请求重新登录，登录成功后自动重试一次', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ status: 'token_invalid', output: [], message: '登录已失效' })
      .mockResolvedValueOnce({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' })
    const onTokenInvalid = vi.fn().mockResolvedValue(true)

    renderEditor(fakeTransport(runCommand), onTokenInvalid)
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2))
    expect(onTokenInvalid).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('已把时间设置为 12:00')).toBeTruthy()
  })

  it('取消登录则只执行一次、不重试', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'token_invalid', output: [], message: '登录已失效' })
    const onTokenInvalid = vi.fn().mockResolvedValue(false)

    renderEditor(fakeTransport(runCommand), onTokenInvalid)
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(onTokenInvalid).toHaveBeenCalledTimes(1))
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('allowServer=false 的指令前端直接拒绝，不发请求', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/i 29'))
    const runCommand = vi.fn()
    const onTokenInvalid = vi.fn().mockResolvedValue(true)

    renderEditor(fakeTransport(runCommand), onTokenInvalid)
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(screen.getAllByText(/只能在游戏内执行/).length).toBeGreaterThan(0))
    expect(runCommand).not.toHaveBeenCalled()
  })
})

describe('CommandPage 收藏', () => {
  it('可收藏当前指令，再次点击取消收藏', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time 12:00'))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    // 收藏入口在侧栏「指令」页内。
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '指令' }))
    fireEvent.click(await screen.findByRole('button', { name: '收藏' }))
    await waitFor(() =>
      expect(localStorage.getItem('tswui:favorites')).toContain('/time 12:00'),
    )
    expect(screen.getByRole('button', { name: '取消收藏' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:favorites') ?? '[]')).toEqual([]),
    )
    expect(screen.getByRole('button', { name: '收藏' })).toBeTruthy()
  })
})

describe('CommandPage 服务器动态', () => {
  it('「动态」tab 渲染事件流（含聊天）', async () => {
    const transport: BackendTransport = {
      ...fakeTransport(vi.fn()),
      events: async () => ({
        events: [
          { seq: 2, type: 'chat', text: 'Alice: 你好', time: new Date().toISOString() },
          { seq: 1, type: 'join', text: 'Alice 加入了服务器', time: new Date().toISOString() },
        ],
        lastSeq: 2,
      }),
    }
    render(
      <I18nProvider lang="zh">
        <CommandPage
          dataset={makeDataset()}
          transport={transport}
          authenticated
          settings={settings}
          serverId="default"
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
        />
      </I18nProvider>,
    )
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '动态' }))
    expect(await screen.findByText('Alice: 你好')).toBeTruthy()
    expect(screen.getByText('Alice 加入了服务器')).toBeTruthy()
  })
})

describe('CommandPage 物品面板', () => {
  it('选中物品后「前往物品图鉴」回传物品 id', async () => {
    const onOpenInDex = vi.fn()
    render(
      <I18nProvider lang="zh">
        <CommandPage
          dataset={makeDataset()}
          transport={fakeTransport(vi.fn())}
          authenticated
          settings={settings}
          serverId="default"
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
          onOpenInDex={onOpenInDex}
        />
      </I18nProvider>,
    )
    const input = await screen.findByPlaceholderText('ID / 名称（Enter 查找）')
    fireEvent.change(input, { target: { value: '生命' } })
    fireEvent.click(await screen.findByRole('button', { name: /生命水晶/ }))
    fireEvent.click(screen.getByRole('button', { name: /前往 物品图鉴/ }))
    expect(onOpenInDex).toHaveBeenCalledWith(29)
  })
})

describe('CommandPage 物品收藏', () => {
  it('图鉴收藏的物品出现在「收藏」tab', async () => {
    localStorage.setItem('tswui:itemFavorites', JSON.stringify([{ id: 29, ts: 1 }]))
    render(
      <I18nProvider lang="zh">
        <CommandPage
          dataset={makeDataset()}
          transport={fakeTransport(vi.fn())}
          authenticated
          settings={settings}
          serverId="default"
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
        />
      </I18nProvider>,
    )
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '收藏' }))
    expect(await screen.findByText('物品收藏（1）')).toBeTruthy()
    expect(screen.getByText('生命水晶')).toBeTruthy()
  })
})
