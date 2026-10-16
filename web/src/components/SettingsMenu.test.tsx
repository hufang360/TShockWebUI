import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { SettingsMenu } from './SettingsMenu'

function renderMenu(onOpen = vi.fn(), active = false) {
  render(
    <I18nProvider lang="zh">
      <SettingsMenu onOpen={onOpen} active={active} />
    </I18nProvider>,
  )
  return onOpen
}

describe('SettingsMenu', () => {
  it('点击打开设置（切到正文设置页）', () => {
    const onOpen = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('当前在设置页时标记 aria-current', () => {
    renderMenu(vi.fn(), true)
    expect(screen.getByRole('button', { name: '设置' }).getAttribute('aria-current')).toBe('page')
  })
})
