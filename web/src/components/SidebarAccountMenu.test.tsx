import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { clearSelfAvatar, setSelfAvatar } from '@/lib/selfAvatar'
import { emptyPlayerLook, type BackendTransport } from '@/lib/tshock'
import { SidebarAccountMenu } from './SidebarAccountMenu'

const transport = {
  serverStatus: async () => ({ reachable: true }),
} as unknown as BackendTransport

function renderMenu(overrides: Partial<Parameters<typeof SidebarAccountMenu>[0]> = {}) {
  const handlers = {
    onSelectServer: vi.fn(),
    onAddServer: vi.fn(),
    onEditServer: vi.fn(),
    onRemoveServer: vi.fn(),
    onLogin: vi.fn(),
    onLogout: vi.fn(),
  }
  render(
    <I18nProvider lang="zh">
      <SidebarAccountMenu
        serverId="default"
        serverLabel="127.0.0.*.*:7878"
        serverOnline
        username="Alice"
        mock={false}
        servers={[]}
        activeId="default"
        info={{ allowCustom: true, default: { scheme: 'http', host: '127.0.0.1', port: 7878 } }}
        transport={transport}
        {...handlers}
        {...overrides}
      />
    </I18nProvider>,
  )
  return handlers
}

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: '账号与服务器' }), { key: 'ArrowDown' })
}

afterEach(() => {
  clearSelfAvatar()
})

describe('SidebarAccountMenu', () => {
  it('展示用户名 + 服务器地址，不出现「服务器默认」', () => {
    renderMenu()
    expect(screen.getByRole('button', { name: '账号与服务器' })).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('127.0.0.*.*:7878')).toBeTruthy()
    expect(screen.queryByText('服务器默认')).toBeNull()
  })

  it('菜单含「切换服务器」与「退出」', async () => {
    const { onLogout } = renderMenu()
    openMenu()
    expect(await screen.findByRole('menuitem', { name: '切换服务器' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '退出' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('未登录时菜单项为「登录」', async () => {
    const { onLogin } = renderMenu({ username: null })
    expect(screen.getByText('未登录')).toBeTruthy()
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })

  it('未登录时账号卡片上方有登录按钮，点击直接打开登录', () => {
    const { onLogin } = renderMenu({ username: null })
    const button = screen.getByRole('button', { name: '登录' })
    const trigger = screen.getByRole('button', { name: '账号与服务器' })
    // 登录按钮在账号卡片之前（上方）。
    expect(button.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(button)
    expect(onLogin).toHaveBeenCalledTimes(1)
  })

  it('已登录时没有单独的登录按钮', () => {
    renderMenu()
    expect(screen.queryByRole('button', { name: '登录' })).toBeNull()
  })

  it('有「自己」的外观时用全身图作头像', () => {
    setSelfAvatar('default', emptyPlayerLook('Alice'))
    renderMenu()
    expect(screen.getByRole('img', { name: 'Alice' })).toBeTruthy()
  })

  it('打开「切换服务器」弹出服务器弹框', async () => {
    renderMenu()
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: '切换服务器' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    // 表单默认收起，点「添加服务器」才出现 IP 输入框。
    expect(screen.queryByLabelText('IP / 域名')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /添加服务器/ }))
    expect(screen.getByLabelText('IP / 域名')).toBeTruthy()
  })
})
