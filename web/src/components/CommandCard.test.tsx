import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { CommandResult } from '@/types'
import { CommandCard } from './CommandCard'

beforeEach(() => {
  window.localStorage.clear()
})

function renderCard(result?: CommandResult, onRefresh = vi.fn(), showLastRunAt = false) {
  render(
    <I18nProvider lang="zh">
      <CommandCard
        title="测试卡片"
        command="/time"
        result={result}
        onRefresh={onRefresh}
        showLastRunAt={showLastRunAt}
      />
    </I18nProvider>,
  )
}

describe('CommandCard 刷新按钮提示', () => {
  it('有结果时 tooltip 显示最后的执行时间', async () => {
    const ts = new Date(2026, 0, 2, 3, 4, 5).getTime()
    renderCard({ status: 'ok', output: ['ok'], ts })
    fireEvent.focus(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText(`执行于 ${new Date(ts).toLocaleTimeString()}`)).toBeTruthy()
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

  it('showLastRunAt：底部**左下角**常显「上次刷新 HH:MM:SS」（手动执行的卡说「执行于」）', () => {
    const ts = new Date(2026, 0, 2, 13, 32, 50).getTime()
    const { unmount } = render(
      <I18nProvider lang="zh">
        <CommandCard title="游戏时间" result={{ status: 'ok', output: ['ok'], ts }} showLastRunAt />
      </I18nProvider>,
    )
    const label = screen.getByText(/上次刷新/)
    expect(label.textContent).toContain('13:32:50')
    // 左下角：它是底部那一行的第一个子元素（后面才是备注），不是靠右的尾巴。
    expect(label.parentElement?.firstElementChild).toBe(label)
    unmount()

    // action='run'（手动执行卡）用「执行于」。
    render(
      <I18nProvider lang="zh">
        <CommandCard
          title="游戏时间"
          result={{ status: 'ok', output: ['ok'], ts }}
          showLastRunAt
          action="run"
        />
      </I18nProvider>,
    )
    expect(screen.getByText(/执行于/).textContent).toContain('13:32:50')
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
