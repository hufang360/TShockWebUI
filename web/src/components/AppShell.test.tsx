import { render, screen } from '@testing-library/react'
import { ClipboardList, Fish, Globe2, Home, Plug, Users } from 'lucide-react'
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

    const skip = screen.getByRole('link', { name: '跳到主内容' })
    expect(skip.getAttribute('href')).toBe('#main-content')
    expect(document.querySelector('main')?.id).toBe('main-content')

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

describe('AppShell 侧栏模块分类', () => {
  it('按玩家 / 世界 / 商店 / 服务 / 自定义分组渲染入口', () => {
    render(
      <I18nProvider lang="zh">
        <AppShell
          activeTab="home"
          onTabChange={vi.fn()}
          nav={[
            { id: 'home', label: '首页', icon: Home },
            { id: 'players', label: '玩家管理', icon: Users, group: 'players' },
            { id: 'world', label: '世界管理', icon: Globe2, group: 'world' },
            { id: 'store', label: '鱼店', icon: Fish, group: 'store' },
            { id: 'requisition', label: '物资申请', icon: ClipboardList, group: 'services' },
            { id: 'm:test', label: '测试模块', icon: Plug, group: 'custom' },
          ]}
          headerRight={<div>账号</div>}
          sidebarCollapsed={false}
          onToggleSidebar={vi.fn()}
        >
          <p>content</p>
        </AppShell>
      </I18nProvider>,
    )

    for (const label of ['玩家', '世界', '商店', '服务', '自定义']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: '玩家管理' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '世界管理' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '鱼店' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '物资申请' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '测试模块' })).toBeTruthy()
  })
})
