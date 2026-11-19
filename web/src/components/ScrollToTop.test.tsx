import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { ScrollToTop } from './ScrollToTop'

const mount = (visible: boolean, onClick = vi.fn()) =>
  render(
    <I18nProvider lang="zh">
      <ScrollToTop visible={visible} onClick={onClick} />
    </I18nProvider>,
  )

describe('ScrollToTop', () => {
  it('滚够距离才出现（否则整个不渲染）', () => {
    const hidden = mount(false)
    expect(screen.queryByRole('button', { name: '回到顶部' })).toBeNull()
    hidden.unmount()

    mount(true)
    expect(screen.getByRole('button', { name: '回到顶部' })).toBeTruthy()
  })

  it('点一下把滚动位置交回调用方', () => {
    const onClick = vi.fn()
    mount(true, onClick)
    fireEvent.click(screen.getByRole('button', { name: '回到顶部' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
