import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport, PlayerCapabilities, PlayerLook } from '@/lib/tshock'
import { emptyPlayerLook, TshockRequestError } from '@/lib/tshock'
import { clearSelfAvatar, getSelfAvatar } from '@/lib/selfAvatar'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import { PlayerManagerPage } from './PlayerManagerPage'

function makeTransport(over: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'Alice' }),
    servers: async () => ({ allowCustom: false, default: null }),
    login: async () => ({ username: 'Alice' }),
    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    playersList: async () => ['Alice'],
    runCommand: async () => ({ status: 'ok', output: [] }),
    ...playerStubs,
    ...over,
  }
}

function renderPage(transport: BackendTransport, authenticated = true, username: string | null = 'Alice') {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <PlayerManagerPage
          serverId="default"
          transport={transport}
          authenticated={authenticated}
          username={username}
          players={['Alice', 'Bob']}
          onTokenInvalid={() => {}}
          onLogin={() => {}}
        />
      </DatasetProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() })
  // 模块状态（玩家名）存在 localStorage：不清会跨用例串味。
  localStorage.clear()
  clearSelfAvatar()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PlayerManagerPage', () => {
  it('未登录时提示先登录', () => {
    renderPage(makeTransport(), false)
    expect(screen.getByText('请先登录，再查看玩家资料。')).toBeTruthy()
  })

  it('服务器未安装插件时给出提醒', async () => {
    const cap: PlayerCapabilities = { plugin: false, permission: false }
    renderPage(makeTransport({ playerCapabilities: async () => cap }))
    expect(await screen.findByText(/未安装 PlayerManager 插件/)).toBeTruthy()
  })

  it('查到「自己」时把外观记入侧栏头像缓存', async () => {
    const playerLook = vi.fn(async (name: string) => emptyPlayerLook(name))
    renderPage(makeTransport({ playerLook }))

    // 默认自动查当前登录账号（Alice）。
    await waitFor(() => expect(getSelfAvatar('default')?.name).toBe('Alice'))
  })

  it('没有 playermanager 权限时给出提醒', async () => {
    const cap: PlayerCapabilities = { plugin: true, permission: false }
    renderPage(makeTransport({ playerCapabilities: async () => cap }))
    expect(await screen.findByText(/你没有 playermanager 权限/)).toBeTruthy()
  })

  it('有权限时可查看背包并渲染物品', async () => {
    const look: PlayerLook = {
      ...emptyPlayerLook('hf'),
      health: 400,
      maxHealth: 500,
      mana: 100,
      maxMana: 200,
      items: [
        { slot: 0, id: 4956, stack: 1, prefix: 0, favorited: false },
        { slot: 1, id: 0, stack: 0, prefix: 0, favorited: false },
      ],
    }
    const playerLook = vi.fn(async () => look)
    renderPage(makeTransport({ playerLook }))

    const input = await screen.findByPlaceholderText(/输入玩家名/)
    fireEvent.change(input, { target: { value: 'hf' } })
    fireEvent.click(screen.getByRole('button', { name: /查看背包/ }))

    await waitFor(() => expect(playerLook).toHaveBeenCalledWith('hf'))
    expect(await screen.findByText('hf')).toBeTruthy()
    expect(screen.getByText('在线')).toBeTruthy()
    expect(screen.getByText('背包')).toBeTruthy()
    // 每个槽位都有底框（空格子与有物品的格子都一样），图标压在底框上面。
    expect(document.querySelectorAll('[data-slot-frame]').length).toBe(2)
  })

  it('空格子 tooltip（shadcn Tooltip）：背包 #N，钱币/弹药不显示', async () => {
    const items = Array.from({ length: 350 }, (_, slot) => ({
      slot,
      id: 0,
      stack: 0,
      prefix: 0,
      favorited: false,
    }))
    const look: PlayerLook = { ...emptyPlayerLook('hf'), items }
    renderPage(makeTransport({ playerLook: async () => look }))

    const input = await screen.findByPlaceholderText(/输入玩家名/)
    fireEvent.change(input, { target: { value: 'hf' } })
    fireEvent.click(screen.getByRole('button', { name: /查看背包/ }))
    await waitFor(() => expect(screen.getByText('背包')).toBeTruthy())

    const frames = document.querySelectorAll('[data-slot-frame]')
    const slotAt = (i: number) => frames[i].parentElement as HTMLElement

    // 背包第 10 格 → #10（1 基）
    fireEvent.focus(slotAt(9))
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('#10')
    fireEvent.blur(slotAt(9))
    expect(screen.queryByRole('tooltip')).toBeNull()

    // 钱币列的第一格：不弹 tooltip
    const coinsHeading = [...document.querySelectorAll('h3')].find((h) => h.textContent === '钱币')
    const coinSlot = coinsHeading?.parentElement?.querySelector('[data-slot-frame]')?.parentElement
    expect(coinSlot).toBeTruthy()
    fireEvent.focus(coinSlot as HTMLElement)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('默认查看自己的背包；切走再回来走缓存不重拉，刷新按钮重新拉取', async () => {
    const playerLook = vi.fn(async (target: string): Promise<PlayerLook> => ({
      ...emptyPlayerLook(target),
      items: [{ slot: 0, id: 4956, stack: 1, prefix: 0, favorited: false }],
    }))
    const transport = makeTransport({ playerLook })

    // 首次进入：默认玩家名 = 当前登录用户，并自动拉取
    const first = renderPage(transport)
    await waitFor(() => expect(playerLook).toHaveBeenCalledWith('Alice'))
    expect(await screen.findByText('Alice')).toBeTruthy()

    // 切到别的模块再回来（卸载后重新挂载，同一 transport）：不再探测/拉取
    first.unmount()
    renderPage(transport)
    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(playerLook).toHaveBeenCalledTimes(1)

    // 刷新按钮：手动重新拉取一次
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }))
    await waitFor(() => expect(playerLook).toHaveBeenCalledTimes(2))
  })

  it('下载存档会调用导出并触发浏览器下载', async () => {
    const playerExport = vi.fn(async (name: string) => ({
      filename: `${name}.plr`,
      blob: new Blob([new Uint8Array([1, 2, 3])]),
    }))
    renderPage(makeTransport({ playerExport }))

    const input = await screen.findByPlaceholderText(/输入玩家名/)
    fireEvent.change(input, { target: { value: 'hf' } })
    fireEvent.click(screen.getByRole('button', { name: /下载存档/ }))

    await waitFor(() => expect(playerExport).toHaveBeenCalledWith('hf'))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('导入 .plr：本地解析、标记「本地导入」并禁用导出', async () => {
    const look: PlayerLook = {
      ...emptyPlayerLook('本地角色', false),
      items: [{ slot: 0, id: 4956, stack: 1, prefix: 0, favorited: false }],
    }
    const importPlayer = vi.fn(async () => look)
    const { container } = renderPage(makeTransport({ importPlayer }))

    await screen.findByPlaceholderText(/输入玩家名/)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()
    const file = new File([new Uint8Array([1, 2, 3])], 'x.plr')
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(importPlayer).toHaveBeenCalled())
    expect(await screen.findByText('本地导入')).toBeTruthy()
    expect(screen.getByText('本地角色')).toBeTruthy()
    // 导入的角色不能从服务器导出
    const exportBtn = screen.getByRole('button', { name: /下载存档/ }) as HTMLButtonElement
    expect(exportBtn.disabled).toBe(true)
  })

  it('输入时清除上一次的错误', async () => {
    const playerLook = vi.fn(async () => {
      throw new TshockRequestError('bad_response', 'boom')
    })
    renderPage(makeTransport({ playerLook }))

    const input = await screen.findByPlaceholderText(/输入玩家名/)
    fireEvent.change(input, { target: { value: 'hf' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('服务器返回的数据无法解析。')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'hfx' } })
    expect(screen.queryByText('服务器返回的数据无法解析。')).toBeNull()
  })

  it('上游 4xx 的具体错误（如查无此玩家）原样显示', async () => {
    const playerLook = vi.fn(async () => {
      throw new TshockRequestError('validation', '找不到名为 hf 的玩家!')
    })
    renderPage(makeTransport({ playerLook }))

    const input = await screen.findByPlaceholderText(/输入玩家名/)
    fireEvent.change(input, { target: { value: 'hf' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('找不到名为 hf 的玩家!')).toBeTruthy()
  })

  it('银行 / 配装分组可折叠（aria-expanded 切换）', async () => {
    const items = Array.from({ length: 350 }, (_, slot) => ({
      slot,
      id: 0,
      stack: 0,
      prefix: 0,
      favorited: false,
    }))
    // 给猪猪存钱罐放一件物品，让分组真的渲染出来
    items[99] = { slot: 99, id: 74, stack: 1, prefix: 0, favorited: false }
    renderPage(makeTransport({ playerLook: async () => ({ ...emptyPlayerLook('hf'), items }) }))

    const input = await screen.findByPlaceholderText(/输入玩家名/)
    fireEvent.change(input, { target: { value: 'hf' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // 关闭简约视图才能看到银行 / 配装
    const compact = await screen.findByLabelText('简约视图')
    fireEvent.click(compact)
    const trigger = await screen.findByRole('button', { name: /猪猪存钱罐/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(trigger)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
  })
})

describe('PlayerManagerPage 探测失败（旧后端 / 网络异常）', () => {
  it('探测失败时显示提醒而不是空白页', async () => {
    const transport = makeTransport({
      playerCapabilities: async () => {
        throw new Error('Unexpected token <')
      },
    })
    renderPage(transport)
    expect(await screen.findByText('无法检测 PlayerManager 插件')).toBeTruthy()
    // 不应再是纯空白：仍有页面标题
    expect(screen.getByText('玩家管理')).toBeTruthy()
  })
})
