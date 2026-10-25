import { render, screen, waitFor, within } from '@testing-library/react'
import { ClipboardList, Fish, Globe2, Home, Plug, Users } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { TopBarActions } from '@/components/TopBar'
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

describe('AppShell 顶栏', () => {
  it('显示收起侧栏按钮与当前页面面包屑（不带分组）', () => {
    render(
      <I18nProvider lang="zh">
        <AppShell
          activeTab="players"
          onTabChange={vi.fn()}
          nav={[
            { id: 'home', label: '首页', icon: Home },
            { id: 'players', label: '玩家管理', icon: Users, group: 'players' },
          ]}
          headerRight={<div>账号</div>}
          sidebarCollapsed={false}
          onToggleSidebar={vi.fn()}
        >
          <p>content</p>
        </AppShell>
      </I18nProvider>,
    )

    // 展开态：侧栏页头有「隐藏侧栏」，顶栏没有收起 / 展开按钮。
    expect(screen.getByRole('button', { name: '隐藏侧栏' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '显示侧栏' })).toBeNull()
    const crumb = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(within(crumb).queryByText('玩家')).toBeNull()
    expect(within(crumb).getByRole('link', { name: '玩家管理' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('页面的 TopBarActions 渲染到顶栏右侧插槽', async () => {
    render(
      <I18nProvider lang="zh">
        <AppShell
          activeTab="home"
          onTabChange={vi.fn()}
          nav={[{ id: 'home', label: '首页', icon: Home }]}
          headerRight={<div>账号</div>}
          sidebarCollapsed={false}
          onToggleSidebar={vi.fn()}
        >
          <TopBarActions>
            <button type="button">页面动作</button>
          </TopBarActions>
        </AppShell>
      </I18nProvider>,
    )

    const header = document.querySelector('header')
    expect(header).toBeTruthy()
    await waitFor(() => expect(within(header!).getByRole('button', { name: '页面动作' })).toBeTruthy())
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
