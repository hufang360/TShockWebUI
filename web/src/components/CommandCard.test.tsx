import { fireEvent, render, screen } from '@testing-library/react'
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
      <CommandCard title="测试卡片" command="/time" result={result} onRefresh={onRefresh} />
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
    expect(await screen.findByText('尚未执行')).toBeTruthy()
  })

  it('底部不再显示执行时间', () => {
    renderCard({ status: 'ok', output: ['ok'], ts: Date.now() })
    expect(screen.queryByText(/执行于/)).toBeNull()
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
