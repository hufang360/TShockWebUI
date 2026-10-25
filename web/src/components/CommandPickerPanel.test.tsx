import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { CommandPickerPanel } from './CommandPickerPanel'

function renderPanel() {
  const onLoad = vi.fn()
  render(
    <I18nProvider lang="zh">
      <CommandPickerPanel view="commands" dataset={makeDataset()} onLoad={onLoad} />
    </I18nProvider>,
  )
  return { onLoad }
}

describe('CommandPickerPanel（指令列表）', () => {
  it('「游戏内」指令排到最下并收进可折叠分组（默认收起）', () => {
    renderPanel()
    // 可执行指令直接可见
    expect(screen.getByTitle('Shows command help.')).toBeTruthy()
    expect(screen.queryByText('/item')).toBeNull()

    const group = screen.getByRole('button', { name: /游戏内指令（只能进游戏执行）/ })
    expect(group.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('/item')).toBeTruthy()
  })

  it('搜索只命中「游戏内」指令时自动展开', () => {
    renderPanel()
    const input = screen.getByPlaceholderText(/搜索指令/)
    fireEvent.change(input, { target: { value: 'item' } })
    // 没有可执行指令命中 → 自动展开，直接能看到 /item
    expect(screen.getByText('/item')).toBeTruthy()
  })

  it('点一行载入指令', () => {
    const { onLoad } = renderPanel()
    fireEvent.click(screen.getByTitle('Shows command help.'))
    expect(onLoad).toHaveBeenCalledWith('/help ')
  })

  it('指令行的注释保留完整行高', () => {
    renderPanel()
    const help = screen.getByText('Shows command help.')
    const row = help.closest('button')
    expect(row?.className).toContain('min-h-16')
    expect(help.className).toContain('leading-5')
  })

  it('不显示收藏星标（收藏是独立入口）', async () => {
    renderPanel()
    await screen.findByPlaceholderText('搜索指令（名称 / 别名 / 帮助）')
    expect(screen.queryByRole('button', { name: '收藏' })).toBeNull()
    expect(screen.queryByRole('button', { name: '取消收藏' })).toBeNull()
  })

  it('搜索前导 / 仍能匹配指令', () => {
    renderPanel()
    fireEvent.change(screen.getByPlaceholderText('搜索指令（名称 / 别名 / 帮助）'), {
      target: { value: '/time' },
    })
    expect(screen.getByText('/time')).toBeTruthy()
  })

  it('搜索框 ↓ 进入指令列表并高亮', () => {
    renderPanel()
    const input = screen.getByPlaceholderText('搜索指令（名称 / 别名 / 帮助）')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const focused = document.activeElement as HTMLElement
    expect(focused.tagName).toBe('BUTTON')
    expect(focused.className).toContain('bg-accent')
    expect(focused.textContent).toContain('/help')
  })
})
