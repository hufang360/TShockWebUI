import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster, toast } from '@/components/ui'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import { recipeFavoriteKey } from '@/lib/recipeFavorites'
import { makeDataset } from '@/test/fixtures'
import type { Dataset } from '@/types'
import { playerStubs } from '@/test/playerStubs'
import { ChatPage } from './ChatPage'

function fakeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return {
    ...playerStubs,
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'Alice' }),
    login: async () => ({ username: 'Alice' }),
    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    servers: async () => ({
      allowCustom: true,
      default: { scheme: 'http', host: '127.0.0.1', port: 7878 },
    }),
    playersList: async () => [],
    runCommand: vi.fn(),
    events: async () => ({
      events: [
        { seq: 2, type: 'chat', text: 'Alice: 你好', time: new Date().toISOString() },
        { seq: 1, type: 'join', text: 'Alice 加入了服务器', time: new Date().toISOString() },
      ],
      lastSeq: 2,
    }),
    ...overrides,
  } as unknown as BackendTransport
}

function renderChat(
  transport: BackendTransport,
  authenticated = true,
  onLogin = vi.fn(),
  dataset: Dataset = makeDataset(),
) {
  return render(
    <I18nProvider lang="zh">
      <ChatPage
        dataset={dataset}
        transport={transport}
        authenticated={authenticated}
        serverId="default"
        refreshInterval={180000}
        onTokenInvalid={vi.fn().mockResolvedValue(true)}
        onLogin={onLogin}
      />
      {/* 发言成功的提示走 sonner（全局挂在 App 上），页面单测里也挂一个。 */}
      <Toaster closeButton />
    </I18nProvider>,
  )
}

afterEach(() => {
  localStorage.clear()
  toast.dismiss()
  vi.restoreAllMocks()
})

describe('ChatPage', () => {
  it('未登录时只显示登录提示，不拉事件流', () => {
    const events = vi.fn()
    const onLogin = vi.fn()
    renderChat(fakeTransport({ events }), false, onLogin)

    expect(screen.getByText('请先登录！')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/发消息给游戏内的玩家/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(events).not.toHaveBeenCalled()
  })

  it('登录后渲染事件流（含聊天 / 进出服）', async () => {
    renderChat(fakeTransport())

    expect(await screen.findByText('Alice: 你好')).toBeTruthy()
    expect(screen.getByText('Alice 加入了服务器')).toBeTruthy()
  })

  it('贴底输入框可发言，成功后提示已发送', async () => {
    const sendChat = vi.fn(async (text: string) => ({
      name: 'Alice',
      text,
      line: `[WebUI] Alice: ${text}`,
    }))
    renderChat(fakeTransport({ sendChat }))

    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）')
    const send = screen.getByRole('button', { name: '发送发言' })
    // 发送键与指令页一致：主色飞机按钮。
    expect(send.className).toContain('bg-primary')
    expect(send.querySelector('.lucide-send')).toBeTruthy()

    fireEvent.change(input, { target: { value: '大家好啊' } })
    fireEvent.click(send)

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith('大家好啊'))
    expect(await screen.findByText(/已发送/)).toBeTruthy()
  })

  it('草稿存本机：重新进页面还在', async () => {
    const first = renderChat(fakeTransport())
    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）')
    fireEvent.change(input, { target: { value: '还没发出去的话' } })
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:chat:draft') ?? '""')).toBe('还没发出去的话'),
    )
    first.unmount()

    renderChat(fakeTransport())
    expect(
      (screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）') as HTMLInputElement).value,
    ).toBe('还没发出去的话')
  })

  it('世界状态徽标在筛选 chips 的上一行（单行靠左），chips 与徽标都在输入框上方', async () => {
    renderChat(
      fakeTransport({
        serverInfoExtra: async () => ({ hardMode: true, raining: true }) as never,
      }),
    )

    const chip = await screen.findByRole('button', { name: '全部' })
    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）')
    // chips 在输入框之前（即「输入框上方」）。
    expect(chip.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 徽标单独一行、在 chips 之前；靠左且不换行。
    const flags = (await screen.findByText('困难模式')).parentElement as HTMLElement
    expect(flags.className).toContain('flex-nowrap')
    expect(flags.className).toContain('justify-start')
    expect(flags.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('下雨')).toBeTruthy()
  })

  it('刷新（上次刷新 + 刷新按钮）与终端入口都在发送按钮左边', async () => {
    renderChat(fakeTransport())

    const send = screen.getByRole('button', { name: '发送发言' })
    const refresh = await screen.findByRole('button', { name: /刷新服务器动态/ })
    const terminal = screen.getByRole('button', { name: '指令' })

    // 三者同属 Composer 的工具行（trailing 区），且在发送按钮之前。
    const row = send.parentElement as HTMLElement
    expect(row.contains(refresh)).toBe(true)
    expect(row.contains(terminal)).toBe(true)
    expect(refresh.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(terminal.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 「上次刷新」文案也在这一簇里（手机端 CSS 隐藏，但元素存在）。
    expect(await screen.findByText(/上次刷新/)).toBeTruthy()
  })

  it('按 `/` 快捷键把焦点交到输入框（聊天不补字符）', () => {
    renderChat(fakeTransport())
    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)

    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('')
  })

  it('左下角「物品」点开搜物品弹框，选中即把 [i:ID] 追加到输入框', async () => {
    renderChat(fakeTransport())
    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）') as HTMLInputElement

    fireEvent.click(screen.getByRole('button', { name: '物品' }))
    const dialog = await screen.findByRole('dialog')
    // 弹框里没有 tab 栏（只有一个物品面板）。
    expect(within(dialog).queryAllByRole('tab')).toHaveLength(0)

    fireEvent.change(within(dialog).getByPlaceholderText('搜索物品（ID / 名称）'), {
      target: { value: '生命水晶' },
    })
    fireEvent.click(await within(dialog).findByText('生命水晶'))

    await waitFor(() => expect(input.value).toBe('[i:29]'))
    // 选完弹框收起，焦点回到输入框末尾。
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(input)
  })

  it('左下角「合成表」：点一条把带 [i:ID] 标签的记录填进输入框', async () => {
    const recipe = {
      result: { id: 22, stack: 1 },
      ingredients: [{ id: 11, stack: 3 }],
      station: 17,
      stationItems: [17] as number[],
      env: [] as string[],
      flags: [] as string[],
    }
    const dataset = makeDataset({
      items: [
        { id: 11, key: 'IronOre', name: '铁矿', icon: 11, frames: 1, sprite: [16, 16], tags: [] },
        { id: 22, key: 'IronBar', name: '铁锭', icon: 22, frames: 1, sprite: [16, 16], tags: [] },
      ],
      recipes: {
        meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
        groups: {},
        recipes: [recipe],
        byResult: { '22': [0] },
        byIngredient: { '11': [0] },
      },
    })
    localStorage.setItem(
      'tswui:recipeFavorites',
      JSON.stringify([{ key: recipeFavoriteKey(recipe), ts: 1 }]),
    )
    renderChat(fakeTransport(), true, vi.fn(), dataset)
    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）') as HTMLInputElement

    // 先打一句话：填充的合成记录要接在它后面（中间补一个空格）。
    fireEvent.change(input, { target: { value: '看这个' } })
    fireEvent.click(screen.getByRole('button', { name: '合成表' }))
    const dialog = await screen.findByRole('dialog')
    // 弹框里没有「清空」按钮。
    expect(within(dialog).queryByRole('button', { name: '清空' })).toBeNull()
    fireEvent.click(within(dialog).getByTestId('recipe-row'))

    // 格式固定：材料标签连写 @ 制作站标签 -> 产物标签（不带名称 / 数量 / 中文箭头）。
    await waitFor(() => expect(input.value).toBe('看这个 [i:11] @ [i:17] -> [i:22]'))
    // 选完弹框收起，焦点回到输入框。
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(input)
  })

  it('列表底部仍显示「世界名 · 刷新于 · 游戏内」', async () => {
    renderChat(
      fakeTransport({
        serverInfoExtra: async () => ({ name: '测试世界', time: 1000, dayTime: true }) as never,
      }),
    )

    const label = await screen.findByTitle(/测试世界/)
    expect(label.textContent).toContain('刷新于')
    expect(label.textContent).toContain('游戏内')
  })

  it('发送成功用 sonner 提示：多条堆叠、每条可关闭、不占输入框高度', async () => {
    const sendChat = vi.fn(async (text: string) => ({
      name: 'hf',
      text,
      line: `[WebUI] hf: ${text}`,
    }))
    renderChat(fakeTransport({ sendChat }))
    // sonner 的提示是全局单例，退场有动画：先确认是空的，再按条数断言。
    act(() => toast.dismiss())
    await waitFor(() => expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(0))

    const input = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）')
    fireEvent.change(input, { target: { value: '一' } })
    fireEvent.click(screen.getByRole('button', { name: '发送发言' }))
    expect(await screen.findByText('已发送（显示为 [WebUI] hf）')).toBeTruthy()

    // 再发一条：堆叠成两条，而不是替换掉上一条。
    fireEvent.change(input, { target: { value: '二' } })
    fireEvent.click(screen.getByRole('button', { name: '发送发言' }))
    await waitFor(() =>
      expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(2),
    )

    // 每条都有独立的关闭按钮，点掉一条就少一条。
    const closeButtons = document.querySelectorAll('[data-close-button]')
    expect(closeButtons.length).toBe(2)
    fireEvent.click(closeButtons[0])
    await waitFor(() =>
      expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(1),
    )
  })
})
