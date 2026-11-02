import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster, toast } from '@/components/ui'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { CommandResult, Settings } from '@/types'
import { CommandPage } from './CommandPage'

/**
 * 「指令」页与「聊天」合并后的行为：宽屏两栏 / 窄屏 tab / 一个输入框两种模式。
 *
 * 判定规则与游戏内一致：首字符 `/` = 指令，其它文本 = 发到游戏内聊天。
 */

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

const okResult: CommandResult = { status: 'ok', output: ['[Mock] 世界时间：上午 8:30'] }

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
    runCommand: vi.fn(async () => okResult),
    events: vi.fn(async () => ({
      events: [
        { seq: 1, type: 'join', text: '小明 加入了服务器', time: new Date().toISOString() },
      ],
      lastSeq: 1,
    })),
    ...overrides,
  } as unknown as BackendTransport
}

function renderPage(transport: BackendTransport) {
  return render(
    <I18nProvider lang="zh">
      <main data-testid="page-scroll-host">
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
      </main>
      <Toaster closeButton />
    </I18nProvider>,
  )
}

const composer = () => document.querySelector('[data-slot=composer]') as HTMLElement
const editor = () => screen.getByRole('textbox') as HTMLTextAreaElement

/** 输入一段文本（模拟真实打字：受控组件走 change）。 */
function type(value: string) {
  fireEvent.change(editor(), { target: { value } })
}

/** 发送键 = composer 里的最后一个按钮（trailing 里最右那个）。 */
function sendButton() {
  const buttons = within(composer()).getAllByRole('button')
  return buttons[buttons.length - 1]
}

beforeEach(() => {
  localStorage.clear()
  toast.dismiss()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
})

afterEach(() => {
  localStorage.clear()
  toast.dismiss()
  vi.restoreAllMocks()
})

describe('指令页：宽屏两栏', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  })

  it('结果与聊天同屏：没有 tab，两栏之间是可拖的分隔条', async () => {
    renderPage(fakeTransport())

    // 没有窄屏的「结果 / 聊天」分段 tab。
    expect(screen.queryByRole('radiogroup', { name: '切换结果 / 聊天' })).toBeNull()

    // 聊天事件流与指令空态同时可见。
    expect(await screen.findByText('小明 加入了服务器')).toBeTruthy()
    expect(screen.getByText('开始一条指令')).toBeTruthy()

    // shadcn Resizable：一个横向 PanelGroup + 两块 Panel + 中间一根可拖的分隔条。
    const group = document.querySelector('[data-slot="resizable-panel-group"]') as HTMLElement
    expect(group).toBeTruthy()
    expect(group.getAttribute('data-panel-group-direction')).toBe('horizontal')
    const panels = document.querySelectorAll('[data-slot="resizable-panel"]')
    expect(panels).toHaveLength(2)
    const handle = document.querySelector('[data-slot="resizable-handle"]') as HTMLElement
    expect(handle).toBeTruthy()
    // 分隔条在中间（结果面板之后、聊天面板之前）。
    expect(
      panels[0].compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(handle.compareDocumentPosition(panels[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('底部只剩状态行 + 筛选；上次刷新与刷新按钮在顶栏右侧', async () => {
    renderPage(
      fakeTransport({
        serverInfoExtra: async () =>
          ({ name: '测试世界', time: 1000, dayTime: true, hardMode: true, raining: true }) as never,
      }),
    )

    // 状态行：`『世界名』 · 困难模式 · 下雨`，纯文字（不是 Badge），截断 + 悬停给完整状态（不含世界名）。
    const statusLine = await screen.findByTitle('困难模式 · 下雨')
    expect(statusLine.textContent).toBe('『测试世界』 · 困难模式 · 下雨')
    expect(statusLine.className).toContain('truncate')
    expect(statusLine.querySelector('[data-slot=badge]')).toBeNull()

    // 筛选 chips 在状态行之后（同一块信息区）。
    const all = screen.getByRole('button', { name: '全部' })
    expect(statusLine.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 上次刷新（带游戏内时间）+ 刷新按钮都不在输入条里，而是在顶栏那一簇。
    expect(within(composer()).queryByRole('button', { name: /刷新服务器动态/ })).toBeNull()
    expect(screen.getByText(/上次刷新/).textContent).toContain('游戏内')
    expect(screen.getByRole('button', { name: /刷新服务器动态/ })).toBeTruthy()
    // 宽屏页头右侧已经看得到 → 聊天栏底部**连「游戏内」半行都不留**，只剩状态行。
    expect(screen.getAllByText(/上次刷新/)).toHaveLength(1)
    expect(screen.getAllByText(/游戏内/)).toHaveLength(1)
    expect(statusLine.nextElementSibling?.textContent ?? '').not.toContain('游戏内')
  })

})

describe('指令页：窄屏 tab', () => {
  it('默认显示结果，点「聊天」切到事件流；两块都常驻（切走只是隐藏）', async () => {
    renderPage(fakeTransport())

    const tabs = screen.getByRole('radiogroup', { name: '切换结果 / 聊天' })
    expect(within(tabs).getByRole('radio', { name: /结果/ })).toBeTruthy()

    // 结果 tab：聊天块存在但被隐藏（事件流仍然挂着，不会因为切 tab 重连）。
    const join = await screen.findByText('小明 加入了服务器')
    expect(join.closest('.hidden')).toBeTruthy()

    fireEvent.click(within(tabs).getByRole('radio', { name: '聊天' }))
    expect(screen.getByText('小明 加入了服务器').closest('.hidden')).toBeNull()
    // 结果区切走（空态隐藏）。
    expect(screen.getByText('开始一条指令').closest('.hidden')).toBeTruthy()
  })

  it('窄屏顶栏折叠：聊天栏底部补一行「上次刷新 … · 游戏内 …」', async () => {
    renderPage(
      fakeTransport({
        serverInfoExtra: async () =>
          ({ name: 'MockWorld', time: 1000, dayTime: true, hardMode: true }) as never,
      }),
    )

    // 状态行仍在（带世界名）。
    const status = await screen.findByTitle('困难模式')
    expect(status.textContent).toBe('『MockWorld』 · 困难模式')
    // 手机端顶栏折进 `…`，所以底部补一行刷新时间。
    const refreshLine = status.nextElementSibling as HTMLElement
    expect(refreshLine.textContent).toContain('上次刷新')
    expect(refreshLine.textContent).toContain('游戏内 04:46')
  })

  it('结果区动作在结果栏底部（图标居右）；切到聊天 tab 时随结果块一起隐藏', async () => {
    renderPage(fakeTransport())
    const tabs = screen.getByRole('radiogroup', { name: '切换结果 / 聊天' })

    // 先在指令模式跑一条，让结果区里有一条记录。
    type('/time 12:00')
    fireEvent.keyDown(editor(), { key: 'Enter' })
    const collapseAll = await screen.findByRole('button', { name: '折叠全部' })

    // 右对齐的一行（`justify-end`），且排在结果正文之后（= 结果栏底部）。
    const row = collapseAll.parentElement as HTMLElement
    expect(row.className).toContain('justify-end')
    expect(row.className).toContain('shrink-0')

    fireEvent.click(within(tabs).getByRole('radio', { name: '聊天' }))
    expect(screen.getByRole('button', { name: '折叠全部' }).closest('.hidden')).toBeTruthy()
  })

  it('「↓ 最新」的宿主只有一个，且跟着当前 tab 归属（不会投给隐藏的那一栏）', async () => {
    renderPage(fakeTransport())
    const tabs = screen.getByRole('radiogroup', { name: '切换结果 / 聊天' })

    // 结果 tab：宿主挂在结果栏的列表上。
    expect(screen.queryAllByTestId('jump-slot')).toHaveLength(1)
    fireEvent.click(within(tabs).getByRole('radio', { name: '聊天' }))
    expect(screen.queryAllByTestId('jump-slot')).toHaveLength(1)
  })
})

describe('指令页：一个输入框两种模式', () => {
  it('非 `/` 文本 = 聊天：发送键变「发送发言」，Enter 走 /api/chat 且不进指令结果', async () => {
    const runCommand = vi.fn(async () => okResult)
    const sendChat = vi.fn(async (text: string) => ({
      name: 'Alice',
      text,
      line: `[WebUI] Alice: ${text}`,
    }))
    renderPage(fakeTransport({ runCommand, sendChat }))

    // 指令模式（空输入）：主色飞机 + 「执行指令」。
    expect(sendButton().getAttribute('aria-label')).toBe('执行')

    type('大家好啊')
    await waitFor(() =>
      expect(editor().getAttribute('placeholder')).toBe('发消息给游戏内的玩家（会显示你是谁）'),
    )
    expect(sendButton().getAttribute('aria-label')).toBe('发送发言')

    fireEvent.keyDown(editor(), { key: 'Enter' })

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith('大家好啊'))
    expect(runCommand).not.toHaveBeenCalled()
    // 发送成功后清空，并回到指令模式。
    await waitFor(() => expect(editor().value).toBe(''))
    expect(sendButton().getAttribute('aria-label')).toBe('执行')
    // 发言成功的提示走 sonner。
    expect(await screen.findByText('已发送（显示为 [WebUI] Alice）')).toBeTruthy()
  })

  it('`/` 开头又回到指令模式：Enter 执行指令，不发聊天', async () => {
    const runCommand = vi.fn(async () => okResult)
    const sendChat = vi.fn()
    renderPage(fakeTransport({ runCommand, sendChat }))

    type('随便写的')
    expect(sendButton().getAttribute('aria-label')).toBe('发送发言')
    type('/time 12:00')
    await waitFor(() => expect(sendButton().getAttribute('aria-label')).toBe('执行'))

    fireEvent.keyDown(editor(), { key: 'Enter' })

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/time 12:00', expect.anything()))
    expect(sendChat).not.toHaveBeenCalled()
  })

  it('聊天模式不弹补全下拉，也不回翻指令历史', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([{ cmd: '/time 12:00', ts: Date.now() }]),
    )
    renderPage(fakeTransport())

    type('你好')
    // 补全：指令模式下 `/` 开头才有候选。
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(editor(), { key: 'ArrowUp' })
    expect(editor().value).toBe('你好')
  })

  it('聊天失败：输入框左下角显示原因 + 「重试」，输入保留', async () => {
    const sendChat = vi.fn(async () => {
      throw new Error('插件不可用')
    })
    renderPage(fakeTransport({ sendChat }))

    type('在吗')
    fireEvent.keyDown(editor(), { key: 'Enter' })

    expect(await screen.findByText('插件不可用')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(editor().value).toBe('在吗')
  })
})
