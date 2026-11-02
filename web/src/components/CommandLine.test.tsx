import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { useTerminal } from '@/lib/terminalContext'
import { TerminalProvider } from '@/lib/terminalContext'
import { CommandLine } from './CommandLine'

/** 探针：把终端的开关状态与最后填进去的文本显示出来（真实终端由 App 渲染）。 */
function TerminalProbe() {
  const { isOpen, request } = useTerminal()
  return (
    <div>
      <span data-testid="terminal-open">{isOpen ? 'open' : 'closed'}</span>
      <span data-testid="terminal-text">{request?.text ?? ''}</span>
    </div>
  )
}

function renderLine(commands = ['/spawnmob 4', '/sb eoc']) {
  return render(
    <I18nProvider lang="zh">
      <TerminalProvider>
        <CommandLine label="相关指令" commands={commands} />
        <TerminalProbe />
      </TerminalProvider>
    </I18nProvider>,
  )
}

describe('CommandLine（相关指令）', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('分组标题带条目数量，且可折叠', () => {
    renderLine()
    expect(screen.getByText('相关指令（2）')).toBeTruthy()
    expect(screen.getAllByTestId('command-row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /相关指令/ }))
    expect(screen.queryAllByTestId('command-row')).toHaveLength(0)
  })

  it('带 note 的条目（如 `/sb all`）悬停出说明 Tooltip', async () => {
    render(
      <I18nProvider lang="zh">
        <TerminalProvider>
          <CommandLine
            label="相关指令"
            commands={[{ command: '/sb all', note: { key: 'commandLine.note.spawnAll' } }]}
          />
        </TerminalProvider>
      </I18nProvider>,
    )
    expect(screen.queryByText('召唤所有Boss')).toBeNull()
    const row = screen.getByTestId('command-row')
    fireEvent.pointerMove(row, { pointerType: 'mouse' })
    fireEvent.pointerEnter(row, { pointerType: 'mouse' })
    expect(await screen.findByText('召唤所有Boss')).toBeTruthy()
  })

  it('每条指令一行；点条目本身不复制', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderLine()
    const [row] = screen.getAllByTestId('command-row')
    fireEvent.click(row)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('复制按钮只复制，不执行也不开终端', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderLine()
    const [row] = screen.getAllByTestId('command-row')
    fireEvent.click(within(row).getByRole('button', { name: '复制' }))
    await screen.findByText('已复制')
    expect(writeText).toHaveBeenCalledWith('/spawnmob 4')
    expect(screen.getByTestId('terminal-open').textContent).toBe('closed')
  })

  it('终端按钮把指令填进浮动终端并让它弹出来', () => {
    renderLine()
    const [, row] = screen.getAllByTestId('command-row')
    expect(screen.getByTestId('terminal-open').textContent).toBe('closed')
    fireEvent.click(within(row).getByRole('button', { name: '填充指令' }))
    expect(screen.getByTestId('terminal-text').textContent).toBe('/sb eoc')
    expect(screen.getByTestId('terminal-open').textContent).toBe('open')
  })

  it('填充指令后回调 onOpenTerminal（调用方用它关掉挡住浮窗的抽屉）', () => {
    const onOpenTerminal = vi.fn()
    render(
      <I18nProvider lang="zh">
        <TerminalProvider>
          <CommandLine label="相关指令" commands={['/spawnmob 4']} onOpenTerminal={onOpenTerminal} />
        </TerminalProvider>
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '填充指令' }))
    expect(onOpenTerminal).toHaveBeenCalledTimes(1)
  })

  it('⭐ 收藏写进 tswui:favorites（与「指令」页共用）', () => {
    renderLine()
    const [row] = screen.getAllByTestId('command-row')
    fireEvent.click(within(row).getByRole('button', { name: '收藏这条指令' }))
    const saved = JSON.parse(window.localStorage.getItem('tswui:favorites') ?? '[]')
    expect(saved.map((f: { cmd: string }) => f.cmd)).toEqual(['/spawnmob 4'])
    // 再点一次取消收藏
    fireEvent.click(within(row).getByRole('button', { name: '取消收藏' }))
    expect(JSON.parse(window.localStorage.getItem('tswui:favorites') ?? '[]')).toEqual([])
  })
})
