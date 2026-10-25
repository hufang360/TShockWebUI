import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalTopBarButton } from '@/components/TerminalTopBarButton'
import { makeDataset } from '@/test/fixtures'
import { TerminalProvider } from '@/lib/terminalContext'
import { I18nProvider } from '@/lib/i18n'
import type { BackendTransport } from '@/lib/tshock'
import type { CommandResult, Settings } from '@/types'
import { CommandTerminal } from './CommandTerminal'

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

function fakeTransport(runCommand: (cmd: string, ingame?: boolean) => Promise<CommandResult>) {
  return { mock: false, label: 'test', runCommand } as unknown as BackendTransport
}

type HarnessOpts = {
  authenticated?: boolean
  visible?: boolean
  fabVisible?: boolean
}

function tree(
  runCommand: (cmd: string, ingame?: boolean) => Promise<CommandResult>,
  opts: HarnessOpts,
  onNavigate: (tab: string) => void,
) {
  return (
    <I18nProvider lang="zh">
      <TerminalProvider>
        <TerminalTopBarButton visible={opts.fabVisible ?? true} />
        <CommandTerminal
          visible={opts.visible ?? true}
          dataset={makeDataset()}
          transport={fakeTransport(runCommand)}
          authenticated={opts.authenticated ?? true}
          serverId="default"
          players={[]}
          ingameAllowed={false}
          runtimeValues={{}}
          settings={settings}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
          onLogin={vi.fn()}
          onNavigate={onNavigate as never}
        />
      </TerminalProvider>
    </I18nProvider>
  )
}

const okRun = async () => ({ status: 'ok' as const, output: ['终端输出一'] })

function renderTerminal(
  runCommand: (cmd: string, ingame?: boolean) => Promise<CommandResult> = okRun,
  opts: HarnessOpts & { onNavigate?: (tab: string) => void } = {},
) {
  const onNavigate = opts.onNavigate ?? vi.fn()
  const view = render(tree(runCommand, opts, onNavigate))
  return { onNavigate, view }
}

function fab() {
  return screen.queryByTestId('terminal-topbar')
}

function openTerminal() {
  fireEvent.click(screen.getByTestId('terminal-topbar'))
  return screen.getByTestId('terminal-window')
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
})

describe('CommandTerminal', () => {
  it('默认不渲染；点「指令」悬浮按钮后出现浮动窗口', () => {
    renderTerminal()
    expect(fab()).toBeTruthy()
    expect(screen.queryByTestId('terminal-window')).toBeNull()
    const win = openTerminal()
    expect(within(win).getByPlaceholderText(/输入指令/)).toBeTruthy()
  })

  it('窗口标题是「指令」，输入框用紧凑尺寸', () => {
    renderTerminal()
    const win = openTerminal()
    expect(screen.getByRole('dialog', { name: '指令' })).toBe(win)
    const input = within(win).getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    expect(input.className).toContain('h-8')
  })

  it('Ctrl + ` 可开关终端', () => {
    renderTerminal()
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    expect(screen.getByTestId('terminal-window')).toBeTruthy()
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    expect(screen.queryByTestId('terminal-window')).toBeNull()
  })

  it('执行后显示输出并清空输入框', async () => {
    renderTerminal()
    const win = openTerminal()
    const input = within(win).getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '/help' } })
    // 第一下 Enter 会被补全下拉接管（接受候选）；Esc 收起候选后再回车才是执行。
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await within(win).findByText('终端输出一')).toBeTruthy()
    expect(input.value).toBe('')
  })

  it('被前置校验拒绝时保留输入（方便就地改）', async () => {
    const runCommand = vi.fn(async () => ({ status: 'ok' as const, output: [] }))
    renderTerminal(runCommand)
    const win = openTerminal()
    const input = within(win).getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    // /item 在数据集里是 allowServer=false：前端直接拒绝，不发请求。
    fireEvent.change(input, { target: { value: '/item 29' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await within(win).findByText(/只能在游戏内执行/)).toBeTruthy()
    expect(runCommand).not.toHaveBeenCalled()
    expect(input.value).toBe('/item 29')
  })

  it('Esc 关闭终端', () => {
    renderTerminal()
    openTerminal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('terminal-window')).toBeNull()
  })

  it('结果写入与指令页共用的 tswui:commandResults', async () => {
    renderTerminal()
    const win = openTerminal()
    const input = within(win).getByPlaceholderText(/输入指令/)
    fireEvent.change(input, { target: { value: '/help' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      const raw = localStorage.getItem('tswui:commandResults')
      expect(raw).toBeTruthy()
      const stored = JSON.parse(raw ?? '{}') as Record<string, { command: string }[]>
      expect(stored.default?.[0]?.command).toBe('/help')
    })
  })

  it('恢复上次记住的位置与尺寸', () => {
    localStorage.setItem('tswui:terminal', JSON.stringify({ x: 100, y: 80, w: 400, h: 500 }))
    renderTerminal()
    const win = openTerminal()
    expect(win.style.left).toBe('100px')
    expect(win.style.top).toBe('80px')
    expect(win.style.width).toBe('400px')
    expect(win.style.height).toBe('500px')
  })

  it('「在指令页中打开」把当前输入交给指令页草稿并跳转', () => {
    const { onNavigate } = renderTerminal()
    const win = openTerminal()
    const input = within(win).getByPlaceholderText(/输入指令/)
    fireEvent.change(input, { target: { value: '/time day' } })
    fireEvent.click(within(win).getByRole('button', { name: '在指令页中打开' }))
    expect(localStorage.getItem('tswui:draft')).toBe(JSON.stringify('/time day'))
    expect(onNavigate).toHaveBeenCalledWith('editor')
    expect(screen.queryByTestId('terminal-window')).toBeNull()
  })

  it('窄屏使用底部抽屉而不是浮动窗口', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 420 })
    renderTerminal()
    fireEvent.click(screen.getByTestId('terminal-topbar'))
    expect(screen.queryByTestId('terminal-window')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('终端顶栏入口', () => {
  it('不可见时（指令 / 设置页）不渲染按钮', () => {
    renderTerminal(okRun, { visible: false, fabVisible: false })
    expect(fab()).toBeNull()
  })

  it('终端打开后顶栏按钮保持可点（aria-pressed=true）', () => {
    renderTerminal()
    openTerminal()
    expect(fab()?.getAttribute('aria-pressed')).toBe('true')
  })

  it('切到不允许的页面时自动收起终端', () => {
    const { onNavigate, view } = renderTerminal()
    openTerminal()
    view.rerender(tree(okRun, { visible: false, fabVisible: false }, onNavigate))
    expect(screen.queryByTestId('terminal-window')).toBeNull()
  })
})
