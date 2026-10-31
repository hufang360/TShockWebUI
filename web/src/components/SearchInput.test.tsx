import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { SearchInput } from './SearchInput'

describe('SearchInput', () => {
  it('有内容时出现圆形清空按钮，点击清空', () => {
    const onValueChange = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SearchInput value="time" onValueChange={onValueChange} placeholder="搜索" />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(onValueChange).toHaveBeenCalledWith('')
  })

  it('空内容时不显示清空按钮', () => {
    render(
      <I18nProvider lang="zh">
        <SearchInput value="" onValueChange={vi.fn()} placeholder="搜索" />
      </I18nProvider>,
    )
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()
  })
})

describe('SearchInput 最近搜索', () => {
  it('可逐条删除记录，输入框最右侧可显示搜索图标', () => {
    const onHistoryRemove = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SearchInput
          value=""
          onValueChange={vi.fn()}
          history={['木匣', '铁镐']}
          historyOnFocus
          onHistoryRemove={onHistoryRemove}
          trailingIcon={<span data-testid="trailing-search">S</span>}
          placeholder="搜索"
        />
      </I18nProvider>,
    )

    const input = screen.getByPlaceholderText('搜索')
    fireEvent.focus(input)
    expect(screen.getByTestId('search-history-list')).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('search-history-list')).getAllByRole('button', { name: '删除记录' })[0]!)
    expect(onHistoryRemove).toHaveBeenCalledWith('木匣')
    const group = input.closest('[data-slot="input-group"]')
    expect(group?.lastElementChild?.contains(screen.getByTestId('trailing-search'))).toBe(true)
  })
})

describe('SearchInput 快捷键与结果数', () => {
  const renderOne = (props: Partial<Parameters<typeof SearchInput>[0]> = {}) =>
    render(
      <I18nProvider lang="zh">
        <SearchInput
          value=""
          onValueChange={vi.fn()}
          history={['木匣']}
          resultLabel="12 个结果"
          shortcut
          placeholder="搜索"
          {...props}
        />
      </I18nProvider>,
    )

  it('失焦且没内容：右侧只显示 `/`，结果数与最近搜索让位', () => {
    renderOne()
    expect(screen.getByTestId('search-shortcut').textContent).toBe('/')
    expect(screen.queryByText('12 个结果')).toBeNull()
    expect(screen.queryByRole('button', { name: '最近搜索' })).toBeNull()
  })

  it('按 `/` 聚焦搜索框（不是在输入框里打字时）', () => {
    renderOne()
    const input = screen.getByPlaceholderText('搜索')
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(input)
  })

  it('聚焦后隐藏 `/`，显示结果数与最近搜索', () => {
    renderOne()
    fireEvent.focus(screen.getByPlaceholderText('搜索'))
    expect(screen.queryByTestId('search-shortcut')).toBeNull()
    expect(screen.getByText('12 个结果')).toBeTruthy()
    expect(screen.getByRole('button', { name: '最近搜索' })).toBeTruthy()
  })

  it('有内容时即使失焦也隐藏 `/`（显示结果数与清空）', () => {
    renderOne({ value: '铁镐' })
    expect(screen.queryByTestId('search-shortcut')).toBeNull()
    expect(screen.getByText('12 个结果')).toBeTruthy()
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy()
  })

  it('不开 shortcut 时不显示 `/`，也不抢 `/` 焦点', () => {
    renderOne({ shortcut: false })
    expect(screen.queryByTestId('search-shortcut')).toBeNull()
    const input = screen.getByPlaceholderText('搜索')
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).not.toBe(input)
  })
})
