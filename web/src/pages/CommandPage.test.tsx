import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

function renderEditor(
  transport: BackendTransport,
  onTokenInvalid: () => Promise<boolean>,
  authenticated = true,
  onLogin: () => void = vi.fn(),
) {
  return render(
    <I18nProvider lang="zh">
      <CommandPage
        dataset={makeDataset()}
        transport={transport}
        authenticated={authenticated}
        settings={settings}
        serverId="default"
        players={[]}
        ingameAllowed={false}
        onTokenInvalid={onTokenInvalid}
        onLogin={onLogin}
      />
    </I18nProvider>,
  )
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CommandPage 未登录', () => {
  it('隐藏编辑器，显示登录提示与登录按钮', () => {
    const onLogin = vi.fn()
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true), false, onLogin)

    expect(screen.getByText('请先登录！')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })

  it('登录后重新量高，左卡片撑满（回归：登录后高度变窄）', () => {
    const transport = fakeTransport(vi.fn())
    const page = (authenticated: boolean) => (
      <I18nProvider lang="zh">
        <main>
          <CommandPage
            dataset={makeDataset()}
            transport={transport}
            authenticated={authenticated}
            settings={settings}
            serverId="default"
            players={[]}
            ingameAllowed={false}
            onTokenInvalid={vi.fn().mockResolvedValue(true)}
            onLogin={vi.fn()}
          />
        </main>
      </I18nProvider>
    )

    const { rerender } = render(page(false))
    // 未登录：顶部 tab 仍在（可以看「小抄」），指令 tab 里是登录提示。
    expect(screen.getByTestId('command-workspace')).toBeTruthy()
    expect(screen.getByText('请先登录！')).toBeTruthy()

    rerender(page(true))
    // 登录后重新量高把工作区撑满。
    expect(screen.getByTestId('command-workspace').style.height).not.toBe('')
  })
})

describe('CommandPage 输入模式', () => {
  it('工具 tabs 使用标准胶囊样式且不换行；空态不描边、引导块居中', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const tabs = screen.getByRole('tab', { name: '物品' }).closest('[data-slot="tabs-list"]')
    expect(tabs?.className).toContain('bg-accent')
    expect(tabs?.className).toContain('flex-nowrap')
    expect(tabs?.className).not.toContain('border-b')

    // 空态不再是一整块虚线占位：工作区就是画布，引导块居中，输入框在底部。
    const empty = screen.getByText('开始一条指令').closest('[data-slot="empty"]')
    expect(empty?.className).not.toContain('border-dashed')
    expect(empty?.parentElement?.className).toContain('justify-center')
  })

  it('底部输入框可切换为聊天模式，并保留指令草稿', async () => {
    const sendChat = vi.fn(async (text: string) => ({
      name: 'Alice',
      text,
      line: `[WebUI] Alice: ${text}`,
    }))
    const transport = { ...fakeTransport(vi.fn()), sendChat }
    renderEditor(transport, vi.fn().mockResolvedValue(true))

    const commandInput = screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    fireEvent.change(commandInput, { target: { value: '/time' } })

    const commandModeToggle = screen.getByRole('button', { name: '切换到聊天输入' })
    expect(
      commandModeToggle.compareDocumentPosition(screen.getByRole('button', { name: '执行' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    fireEvent.click(commandModeToggle)
    const chatInput = screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）')
    const chatModeToggle = screen.getByRole('button', { name: '切换到指令输入' })
    const chatSend = screen.getByRole('button', { name: '发送发言' })
    expect(
      chatModeToggle.compareDocumentPosition(chatSend) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // 模式切换保持弱化；聊天发送与指令发送一致，使用主色飞机按钮。
    expect(chatModeToggle.className).toContain('hover:bg-accent')
    expect(chatModeToggle.className).not.toContain('bg-secondary')
    expect(chatSend.className).toContain('bg-primary')
    expect(chatSend.className).not.toContain('bg-transparent')
    expect(chatSend.querySelector('.lucide-send')).toBeTruthy()
    expect(chatSend.querySelector('.lucide-message-circle')).toBeNull()
    fireEvent.change(chatInput, { target: { value: '大家好啊' } })
    fireEvent.click(chatSend)

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith('大家好啊'))
    expect(await screen.findByText(/已发送/)).toBeTruthy()

    fireEvent.click(chatModeToggle)
    expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe('/time')
  })
})

describe('CommandPage 工具面板', () => {
  const toolsTabs = () =>
    within(screen.getByRole('tab', { name: '物品' }).closest('[data-slot="tabs-list"]') as HTMLElement)

  it('指令库在工具栏最左侧（指令库 / 物品 / 收藏 / 历史）', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    expect(toolsTabs().getAllByRole('tab').map((el) => el.textContent)).toEqual([
      '指令库',
      '物品',
      '收藏',
      '历史',
    ])
  })

  it('指令库 tab：列出全部指令，点一条填进输入框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    fireEvent.mouseDown(toolsTabs().getByRole('tab', { name: '指令库' }))
    fireEvent.click(await screen.findByTitle('Shows command help.'))
    expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe('/help ')
  })

  it('旧版本存过的工具 tab（已移除的「动态」）回落到物品', () => {
    localStorage.setItem('tswui:commandTab', JSON.stringify('events'))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    expect(toolsTabs().getByRole('tab', { name: '物品' }).getAttribute('aria-selected')).toBe('true')
  })

  it('空态的「打开指令库」直接切到指令库 tab 并展开工具面板', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: /打开指令库/ }))
    expect((await screen.findAllByPlaceholderText(/搜索指令/)).length).toBeGreaterThan(0)
    expect(toolsTabs().getByRole('tab', { name: '指令库' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })
})

describe('CommandPage 输入框（聊天式外壳）', () => {
  /** 输入框所在的那张卡片（rounded-2xl 外壳）。 */
  const composer = () =>
    (screen.getByPlaceholderText(/输入指令/) as HTMLElement).closest('.rounded-2xl') as HTMLElement

  it('工具按钮在左下角、发送与模式切换在右下角', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const card = composer()
    const tools = within(card).getByRole('group', { name: '工具面板' })
    const send = within(card).getByRole('button', { name: '执行' })
    const group = tools.parentElement as HTMLElement

    // 顺序：工具按钮组在前，右侧（modeToggle + 发送）在后且靠右。
    expect(group.firstElementChild).toBe(tools)
    expect(group.lastElementChild?.className).toContain('ml-auto')
    expect(within(group.lastElementChild as HTMLElement).getByRole('button', { name: '执行' })).toBe(
      send,
    )
    // 四个按钮按「指令库 / 物品 / 收藏 / 历史」排
    expect(
      within(tools)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['指令库', '物品', '收藏', '历史'])
  })

  it('点工具按钮切到对应面板 tab；再点一次收起面板', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const tools = within(composer()).getByRole('group', { name: '工具面板' })
    const favorites = within(tools).getByRole('button', { name: '收藏' })

    fireEvent.click(favorites)
    expect(favorites.getAttribute('aria-pressed')).toBe('true')
    // 桌面宽屏下右侧面板可见
    expect(screen.getByTestId('command-workspace')).toBeTruthy()

    fireEvent.click(favorites)
    expect(favorites.getAttribute('aria-pressed')).toBe('false')
  })

  it('聊天模式下不显示这四个工具按钮', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '切换到聊天输入' }))
    const chat = screen.getByPlaceholderText(/发消息给游戏内的玩家/)
    const card = chat.closest('.rounded-2xl') as HTMLElement
    expect(within(card).queryByRole('group', { name: '工具面板' })).toBeNull()
    // 发送键仍在右下
    expect(within(card).getByRole('button', { name: '发送发言' })).toBeTruthy()
  })
})

describe('CommandPage 结果区跟随最新一条', () => {
  it('新结果返回后自动滚到最底（滚动容器就是结果面板自己）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time day'))
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['已设置为白天'] })
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(await screen.findByText('已设置为白天')).toBeTruthy()

    // jsdom 不做布局：手动给滚动容器一个可滚高度，再发一条看是否贴底。
    const scroller = (screen.getByText('/time day').closest('.group\\/result') as HTMLElement)
      .parentElement?.parentElement as HTMLElement
    expect(scroller.className).toContain('overflow-y-auto')
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true })

    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1))

    // 执行后会清空输入，再敲一条。
    fireEvent.change(screen.getByPlaceholderText(/输入指令/), { target: { value: '/time day' } })
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(scroller.scrollTop).toBe(1000))
  })
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
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '聊天' }))
    expect(await screen.findByText('Alice: 你好')).toBeTruthy()
    expect(screen.getByText('Alice 加入了服务器')).toBeTruthy()
  })
})

describe('CommandPage 物品面板', () => {
  it('选中物品后「前往物品 ID」回传物品 id', async () => {
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
          onLogin={vi.fn()}
          onOpenInDex={onOpenInDex}
        />
      </I18nProvider>,
    )
    const input = await screen.findByPlaceholderText('搜索物品（ID / 名称）')
    fireEvent.change(input, { target: { value: '生命' } })
    fireEvent.click(await screen.findByRole('button', { name: /生命水晶/ }))
    fireEvent.click(screen.getByRole('button', { name: /前往 物品 ID/ }))
    expect(onOpenInDex).toHaveBeenCalledWith(29)
  })

  it('键盘上下键移动时高亮结果行', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const input = await screen.findByPlaceholderText('搜索物品（ID / 名称）')
    fireEvent.change(input, { target: { value: '生命' } })
    const row = await screen.findByRole('button', { name: /生命水晶/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row)
    expect(row.className).toContain('bg-accent')
  })
})

describe('CommandPage 物品收藏', () => {
  it('物品 tab 默认展示收藏物品，点击追加 ID 并从收藏移除', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/give'))
    localStorage.setItem('tswui:itemFavorites', JSON.stringify([{ id: 29, ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    // 默认就是「物品」tab：搜索为空时展示收藏物品。
    fireEvent.click(await screen.findByRole('button', { name: /生命水晶/ }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('/give 29 '),
    )
    expect(JSON.parse(localStorage.getItem('tswui:itemFavorites') ?? '[]')).toEqual([])
  })

  it('收藏 tab 只显示指令收藏（物品收藏已移到物品 tab）', async () => {
    localStorage.setItem('tswui:itemFavorites', JSON.stringify([{ id: 29, ts: 1 }]))
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '收藏' }))
    expect(await screen.findByText('/time 12:00')).toBeTruthy()
    expect(screen.queryByText('生命水晶')).toBeNull()
  })

  it('收藏 tab 搜索过滤指令收藏', async () => {
    localStorage.setItem(
      'tswui:favorites',
      JSON.stringify([{ cmd: '/time 12:00', ts: 1 }, { cmd: '/give 29 Alice', ts: 2 }]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '收藏' }))
    expect(await screen.findByText('/time 12:00')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('搜索收藏指令（指令名 / 参数）'), {
      target: { value: 'give' },
    })
    expect(screen.getByText('/give 29 Alice')).toBeTruthy()
    expect(screen.queryByText('/time 12:00')).toBeNull()
  })

  it('清空收藏清空指令收藏', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '收藏' }))
    // 清空需要二次确认：先点「清空」，再点「确认清空」。
    fireEvent.click(await screen.findByRole('button', { name: '清空' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:favorites') ?? '[]')).toEqual([]),
    )
    expect(await screen.findByText('还没有收藏任何指令')).toBeTruthy()
  })

  it('点击收藏指令替换输入框内容（不执行）', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    const runCommand = vi.fn()
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '/time 12:00' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('/time 12:00'),
    )
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('批量删除指令收藏', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '/time 12:00' }))
    fireEvent.click(screen.getByRole('button', { name: '删除（1）' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:favorites') ?? '[]')).toEqual([]),
    )
  })
})

describe('CommandPage 执行后清空输入框', () => {
  it('发送成功后输入框清空（结果仍在结果区）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' })

    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await screen.findByText('已把时间设置为 12:00')
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe(''),
    )
  })

  it('前端拦下的指令不清空（保留原文便于修改重发）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/i 29'))
    const runCommand = vi.fn()

    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(screen.getAllByText(/只能在游戏内执行/).length).toBeGreaterThan(0))
    expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe('/i 29')
  })
})

describe('CommandPage 历史', () => {
  it('批量删除：进入删除状态后可多选删除', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
        { cmd: '/time 13:00', ts: 2, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '历史' }))
    // 默认逐行不显示删除图标，只有一个「删除」入口。
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: /\/time 12:00/ }))
    fireEvent.click(screen.getByRole('button', { name: /\/time 13:00/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除（2）' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toEqual([]),
    )
    expect(await screen.findByText('暂无历史')).toBeTruthy()
  })

  it('清空历史需要二次确认', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([{ cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' }]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '历史' }))
    fireEvent.click(await screen.findByRole('button', { name: '清空历史' }))
    // 首次点击只展开确认，不直接清空。
    expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toHaveLength(1)

    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toEqual([]),
    )
    expect(await screen.findByText('暂无历史')).toBeTruthy()
  })

  it('历史搜索按指令文本过滤', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
        { cmd: '/give 29 Alice', ts: 2, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '历史' }))
    fireEvent.change(await screen.findByPlaceholderText('搜索历史指令'), { target: { value: 'give' } })
    expect(screen.getByText('/give 29 Alice')).toBeTruthy()
    expect(screen.queryByText('/time 12:00')).toBeNull()
  })

  it('去重保留最新、删除较旧的重复记录', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 3, ok: true, status: 'ok' },
        { cmd: '/give 29 Alice', ts: 2, ok: true, status: 'ok' },
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    fireEvent.mouseDown(await screen.findByRole('tab', { name: '历史' }))
    fireEvent.click(await screen.findByRole('button', { name: '去重' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认去重' }))

    await waitFor(() => {
      const after = JSON.parse(localStorage.getItem('tswui:history') ?? '[]') as Array<{
        cmd: string
      }>
      expect(after).toHaveLength(2)
      expect(after.map((h) => h.cmd)).toEqual(['/time 12:00', '/give 29 Alice'])
    })
  })
})

describe('CommandPage 结果持久化', () => {
  it('执行结果存本机（按服务器），重新挂载后仍在', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const transport = fakeTransport(
      vi.fn().mockResolvedValue({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' }),
    )
    const page = () => (
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
          onLogin={vi.fn()}
        />
      </I18nProvider>
    )

    const first = render(page())
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await screen.findByText('已把时间设置为 12:00')
    const stored = JSON.parse(localStorage.getItem('tswui:commandResults') ?? '{}') as Record<
      string,
      unknown[]
    >
    expect(stored.default).toHaveLength(1)
    first.unmount()

    render(page())
    expect(await screen.findByText('已把时间设置为 12:00')).toBeTruthy()
  })

  it('结果按服务器分开：切换服务器看不到另一台的结果', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const transport = fakeTransport(
      vi.fn().mockResolvedValue({ status: 'ok', output: ['服务器 A 的输出'], message: '' }),
    )
    const page = (serverId: string) => (
      <I18nProvider lang="zh">
        <CommandPage
          dataset={makeDataset()}
          transport={transport}
          authenticated
          settings={settings}
          serverId={serverId}
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
          onLogin={vi.fn()}
        />
      </I18nProvider>
    )

    const first = render(page('server-a'))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await screen.findByText('服务器 A 的输出')
    first.unmount()

    // 换到另一台服务器：不应看到 A 的结果。
    const second = render(page('server-b'))
    expect(screen.queryByText('服务器 A 的输出')).toBeNull()
    second.unmount()

    // 切回 A：结果仍在。
    render(page('server-a'))
    expect(await screen.findByText('服务器 A 的输出')).toBeTruthy()
  })
})

describe('CommandPage 右侧 tab 记忆', () => {
  it('切换 tab 后写入本机，重新挂载恢复', async () => {
    const transport = fakeTransport(vi.fn())
    const page = () => (
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
          onLogin={vi.fn()}
        />
      </I18nProvider>
    )

    const first = render(page())
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '历史' }))
    await waitFor(() => expect(localStorage.getItem('tswui:commandTab')).toBe('"history"'))
    first.unmount()

    render(page())
    // 默认应停在「历史」tab。
    expect(await screen.findByPlaceholderText('搜索历史指令')).toBeTruthy()
  })
})
