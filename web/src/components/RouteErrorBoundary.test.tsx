import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { RouteErrorBoundary } from './RouteErrorBoundary'

afterEach(() => {
  vi.restoreAllMocks()
})

it('懒加载页面异常时显示可恢复提示，而不是空白页', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const Broken = () => {
    throw new Error('chunk load failed')
  }

  render(
    <I18nProvider lang="zh">
      <RouteErrorBoundary>
        <Broken />
      </RouteErrorBoundary>
    </I18nProvider>,
  )

  expect(screen.getByText('页面加载失败')).toBeTruthy()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
})
