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
            { id: 'players', label: '玩家管理', icon: Users, group: 'extension' },
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
    expect(within(crumb).queryByText('扩展')).toBeNull()
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
  it('首组不带标题；工具 / 扩展分组按顺序渲染入口', () => {
    render(
      <I18nProvider lang="zh">
        <AppShell
          activeTab="home"
          onTabChange={vi.fn()}
          nav={[
            { id: 'home', label: '首页', icon: Home },
            { id: 'requisition', label: '物资申请', icon: ClipboardList },
            { id: 'items', label: '物品 ID', icon: Home, group: 'tools' },
            { id: 'save', label: '玩家存档', icon: Home, group: 'tools' },
            { id: 'store', label: '鱼店', icon: Fish, group: 'extension' },
            { id: 'players', label: '玩家管理', icon: Users, group: 'extension' },
            { id: 'world', label: '世界管理', icon: Globe2, group: 'extension' },
            { id: 'm:test', label: '测试模块', icon: Plug, group: 'extension' },
          ]}
          headerRight={<div>账号</div>}
          sidebarCollapsed={false}
          onToggleSidebar={vi.fn()}
        >
          <p>content</p>
        </AppShell>
      </I18nProvider>,
    )

    // 分组标题只有「工具 / 扩展」两项：首组（首页 / 物资申请）不带标题。
    const labels = [...document.querySelectorAll('[data-slot="sidebar-group-label"]')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['工具', '扩展'])

    // 组内顺序：首组「首页 → 物资申请」，工具组「物品 ID → 玩家存档」，扩展组按给定顺序。
    const navButtons = within(document.querySelector('[data-slot="sidebar-content"]') as HTMLElement)
      .getAllByRole('button')
      .map((el) => el.textContent)
    expect(navButtons).toEqual([
      '首页',
      '物资申请',
      '物品 ID',
      '玩家存档',
      '鱼店',
      '玩家管理',
      '世界管理',
      '测试模块',
    ])
  })
})

describe('AppShell 滚动条槽（聊天页整页滚动）', () => {
  const renderShell = (activeTab: 'home' | 'chat') =>
    render(
      <I18nProvider lang="zh">
        <AppShell
          activeTab={activeTab}
          onTabChange={vi.fn()}
          nav={[{ id: 'home', label: '首页', icon: Home }]}
          headerRight={<span>账号</span>}
          sidebarCollapsed={false}
          onToggleSidebar={vi.fn()}
        >
          <p>content</p>
        </AppShell>
      </I18nProvider>,
    )

  it('「聊天」页给主内容区常驻预留滚动条槽，避免切筛选时整列左右跳', () => {
    renderShell('chat')
    const main = document.querySelector('main') as HTMLElement
    expect(main.className).toContain('[scrollbar-gutter:stable]')
    main.remove()
  })

  it('其它页面不预留（保持原有宽度，不被空槽占位）', () => {
    renderShell('home')
    const main = document.querySelector('main') as HTMLElement
    expect(main.className).not.toContain('scrollbar-gutter')
    main.remove()
  })
})
