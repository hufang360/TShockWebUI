import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { CommandResult } from '@/types'
import { CommandCard } from './CommandCard'

beforeEach(() => {
  window.localStorage.clear()
})

function renderCard(result?: CommandResult, onRefresh = vi.fn()) {
  render(
    <I18nProvider lang="zh">
      <CommandCard
        title="测试卡片"
        command="/time"
        result={result}
        onRefresh={onRefresh}
      />
    </I18nProvider>,
  )
}

describe('CommandCard 刷新按钮提示', () => {
  it('有结果时 tooltip 显示最后的执行时间', async () => {
    // 断言**字面量**而不是 `toLocaleTimeString()`：时间跟界面语言走（中文 24 小时制），
    // 用系统 locale 的期望值会让这条测试在英文 locale 的机器（如 CI runner）上假失败。
    const ts = new Date(2026, 0, 2, 13, 32, 50).getTime()
    renderCard({ status: 'ok', output: ['ok'], ts })
    fireEvent.focus(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText('执行于 13:32:50')).toBeTruthy()
  })

  it('没有结果时 tooltip 显示「尚未执行」', async () => {
    renderCard()
    fireEvent.focus(screen.getByRole('button', { name: '刷新' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain('尚未执行')
  })

  it('默认不在底部显示执行时间（时间只藏在刷新 Tooltip 里）', () => {
    renderCard({ status: 'ok', output: ['ok'], ts: Date.now() })
    expect(screen.queryByText(/执行于/)).toBeNull()
  })

  it('手动执行的卡：底部**左下角**常显「执行于 HH:MM:SS」', () => {
    const ts = new Date(2026, 0, 2, 13, 32, 50).getTime()
    render(
      <I18nProvider lang="zh">
        <CommandCard
          title="在线玩家"
          result={{ status: 'ok', output: ['ok'], ts }}
          action="run"
        />
      </I18nProvider>,
    )
    const label = screen.getByText(/执行于/)
    expect(label.textContent).toContain('13:32:50')
    // 左下角：它是底部那一行的第一个子元素（后面才是备注），不是靠右的尾巴。
    expect(label.parentElement?.firstElementChild).toBe(label)
  })

  it('手动执行的卡：执行按钮常显（有结果也不淡出，折叠也还在）', () => {
    const onRefresh = vi.fn()
    render(
      <I18nProvider lang="zh">
        <CommandCard
          title="在线玩家"
          action="run"
          result={{ status: 'ok', output: ['ok'], ts: Date.now() }}
          onRefresh={onRefresh}
        />
      </I18nProvider>,
    )
    const card = screen.getByText('在线玩家').closest('[data-slot="card"]') as HTMLElement
    const button = within(card).getByRole('button', { name: '执行' })
    // 按钮所在的右上角容器不能带 hover 才显示的那套 opacity 类。
    expect(button.parentElement?.className).not.toContain('opacity-0')
    // 折叠起来也保留按钮：常显 = 不靠 hover、也不靠展开。
    fireEvent.click(within(card).getByText('在线玩家'))
    expect(within(card).queryByText('ok')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: '执行' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    // 点执行不会顺手把卡片展开。
    expect(within(card).queryByText('ok')).toBeNull()
  })

  it('自动刷新的卡：有结果时按钮仍然 hover 才出现', () => {
    // 自动刷新的卡有结果时仍然 hover 才出现（正文有内容，按钮不必抢眼）。
    render(
      <I18nProvider lang="zh">
        <CommandCard
          title="在线玩家"
          result={{ status: 'ok', output: ['ok'], ts: Date.now() }}
          onRefresh={vi.fn()}
        />
      </I18nProvider>,
    )
    const refresh = screen.getByRole('button', { name: '刷新' })
    expect(refresh.parentElement?.className).toContain('opacity-0')
  })

  it('手动执行卡（action="run"）常显「执行于 …」，超过一天标 warning', async () => {
    const view = (ts: number, command = '/who') => (
      <I18nProvider lang="zh">
        <CommandCard
          title="在线玩家"
          command={command}
          action="run"
          result={{ status: 'ok', output: ['在线玩家 (1): hf'], ts }}
        />
      </I18nProvider>
    )
    const fresh = render(view(Date.now() - 60 * 60_000))
    expect(screen.getByText(/执行于/).className).not.toContain('text-warning')
    fresh.unmount()

    // 25 小时前的快照：超过了「一天」的阈值，时间变警告色，悬停说明原因。
    render(view(Date.now() - 25 * 60 * 60_000))
    const label = screen.getByText(/执行于/)
    expect(label.className).toContain('text-warning')
    fireEvent.focus(label)
    expect((await screen.findByRole('tooltip')).textContent).toContain('可能已过时')
  })

  it('带 help 字样的指令不算过时（教程 / 指令列表不会随时间变旧）', () => {
    render(
      <I18nProvider lang="zh">
        <CommandCard
          title="帮助"
          command="/help Fishing"
          action="run"
          result={{ status: 'ok', output: ['用法: /help'], ts: Date.now() - 3 * 24 * 60 * 60_000 }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText(/执行于/).className).not.toContain('text-warning')
  })

  it('自动刷新的卡片默认不占底部时间行（只看 Tooltip）', () => {
    renderCard({ status: 'ok', output: ['ok'], ts: Date.now() - 60 * 60_000 })
    expect(screen.queryByText(/执行于|上次刷新/)).toBeNull()
  })

  it('点击整个表头折叠 / 展开卡片', () => {
    renderCard({ status: 'ok', output: ['结果内容'], ts: Date.now() })
    expect(screen.getByText('结果内容')).toBeTruthy()
    fireEvent.click(screen.getByText('测试卡片'))
    expect(screen.queryByText('结果内容')).toBeNull()
    fireEvent.click(screen.getByText('测试卡片'))
    expect(screen.getByText('结果内容')).toBeTruthy()
  })

  it('按 collapseKey 记忆折叠状态（切换模块回来仍保持）', () => {
    const view = () => (
      <I18nProvider lang="zh">
        <CommandCard
          title="测试卡片"
          command="/time"
          result={{ status: 'ok', output: ['结果内容'], ts: Date.now() }}
          collapseKey="home:test"
        />
      </I18nProvider>
    )
    const first = render(view())
    fireEvent.click(screen.getByText('测试卡片'))
    expect(screen.queryByText('结果内容')).toBeNull()
    // 切走（卸载）再回来（重新挂载）：仍是折叠状态。
    first.unmount()
    render(view())
    expect(screen.queryByText('结果内容')).toBeNull()
  })
})
