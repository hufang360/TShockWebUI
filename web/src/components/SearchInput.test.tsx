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
