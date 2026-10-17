import { render, screen } from '@testing-library/react'
import { Home } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { AppShell } from './AppShell'

describe('AppShell 侧栏底部', () => {
  it('sidebarExtra（执行队列）渲染在账号区上方，同处页脚', () => {
    render(
      <I18nProvider lang="zh">
        <AppShell
          activeTab="home"
          onTabChange={vi.fn()}
          nav={[{ id: 'home', label: '首页', icon: Home }]}
          sidebarExtra={<div data-testid="extra">执行队列</div>}
          headerRight={<div data-testid="account">账号</div>}
          sidebarCollapsed={false}
          onToggleSidebar={vi.fn()}
        >
          <p>content</p>
        </AppShell>
      </I18nProvider>,
    )

    const footer = document.querySelector('[data-slot="sidebar-footer"]')
    const extra = screen.getByTestId('extra')
    const account = screen.getByTestId('account')
    expect(footer).toBeTruthy()
    expect(footer!.contains(extra)).toBe(true)
    expect(footer!.contains(account)).toBe(true)
    // extra 出现在 account 之前。
    expect(extra.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
