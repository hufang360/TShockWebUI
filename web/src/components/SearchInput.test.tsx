import { fireEvent, render, screen } from '@testing-library/react'
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
