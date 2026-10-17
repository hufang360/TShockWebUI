import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import type { Lang, ThemeName } from '@/types'
import { QuickPreferences } from './QuickPreferences'

function renderPrefs(theme: ThemeName, language: Lang) {
  const onThemeChange = vi.fn()
  const onLanguageChange = vi.fn()
  render(
    <I18nProvider lang="zh">
      <QuickPreferences
        theme={theme}
        language={language}
        onThemeChange={onThemeChange}
        onLanguageChange={onLanguageChange}
      />
    </I18nProvider>,
  )
  return { onThemeChange, onLanguageChange }
}

describe('QuickPreferences 主题', () => {
  it('按 自动 → 浅色 → 深色 循环切换', () => {
    const a = renderPrefs('auto', 'zh')
    fireEvent.click(screen.getByRole('button', { name: /主题：自动/ }))
    expect(a.onThemeChange).toHaveBeenCalledWith('light')

    const b = renderPrefs('light', 'zh')
    fireEvent.click(screen.getAllByRole('button', { name: /主题：浅色/ })[0])
    expect(b.onThemeChange).toHaveBeenCalledWith('dark')

    const c = renderPrefs('dark', 'zh')
    fireEvent.click(screen.getAllByRole('button', { name: /主题：深色/ })[0])
    expect(c.onThemeChange).toHaveBeenCalledWith('auto')
  })

  it('图标随状态变化：自动=电脑 / 浅色=太阳 / 深色=月亮', () => {
    renderPrefs('auto', 'zh')
    expect(document.querySelector('.lucide-monitor')).toBeTruthy()

    renderPrefs('light', 'zh')
    expect(document.querySelector('.lucide-sun')).toBeTruthy()

    renderPrefs('dark', 'zh')
    expect(document.querySelector('.lucide-moon')).toBeTruthy()
  })
})

describe('QuickPreferences 语言', () => {
  it('中文时显示「中」，点击切到英文', () => {
    const { onLanguageChange } = renderPrefs('dark', 'zh')
    const btn = screen.getByRole('button', { name: /语言：中文/ })
    expect(btn.textContent).toBe('中')
    fireEvent.click(btn)
    expect(onLanguageChange).toHaveBeenCalledWith('en')
  })

  it('英文时显示「EN」，点击切回中文', () => {
    const { onLanguageChange } = renderPrefs('dark', 'en')
    const btn = screen.getByRole('button', { name: /语言：English/ })
    expect(btn.textContent).toBe('EN')
    fireEvent.click(btn)
    expect(onLanguageChange).toHaveBeenCalledWith('zh')
  })
})
