import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LoginDialog } from '@/components/LoginDialog'
import { I18nProvider } from '@/lib/i18n'
import { TshockRequestError, type BackendTransport } from '@/lib/tshock'
import type { CommandResult } from '@/types'
import { playerStubs } from '@/test/playerStubs'

function makeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: false, username: null }),
    servers: async () => ({ allowCustom: false, default: null }),
    login: async () => ({ username: 'x' }),
    loginWithToken: async () => ({ username: 'x' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    playersList: async () => [],
    runCommand: async (): Promise<CommandResult> => ({ status: 'ok', output: [] }),
    ...playerStubs,
    ...overrides,
  }
}

function renderDialog(overrides: Partial<Parameters<typeof LoginDialog>[0]> = {}) {
  const onSuccess = vi.fn()
  const onSelectServer = vi.fn()
  render(
    <I18nProvider lang="zh">
      <LoginDialog
        open
        onClose={() => {}}
        transport={makeTransport()}
        onSuccess={onSuccess}
        serverId="default"
        serverLabel="127.0.0.*.*:7878"
        serverOnline
        servers={[]}
        info={{ allowCustom: true, default: { scheme: 'http', host: '127.0.0.1', port: 7878 } }}
        onSelectServer={onSelectServer}
        onAddServer={vi.fn()}
        onEditServer={vi.fn()}
        onRemoveServer={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onSuccess, onSelectServer }
}

it('显示当前服务器；点击服务器一行打开「切换服务器」弹框', () => {
  const { onSelectServer } = renderDialog()
  expect(screen.getByText('127.0.0.*.*:7878')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /^服务器/ }))
  expect(screen.getByText('后端服务器')).toBeTruthy()
  expect(screen.getByRole('button', { name: /添加服务器/ })).toBeTruthy()

  // 选中内置服务器 → 回调（由 App 切换上游并保留登录框）。
  fireEvent.click(screen.getByRole('button', { name: /127\.0\.0\.1:7878/ }))
  expect(onSelectServer).toHaveBeenCalledWith('default')
})

it('默认只显示账号密码，帮助浮层默认收起（界面简洁）', () => {
  renderDialog()
  // 主路径两个输入都在。
  expect(screen.getByPlaceholderText('输入玩家名')).toBeTruthy()
  expect(screen.getByPlaceholderText('密码')).toBeTruthy()
  // 次要方式收成「其他登录方式」分隔行 + 两个 Alt Line 按钮；右侧插画列存在（装饰）。
  expect(screen.getByText('其他登录方式')).toBeTruthy()
  expect(document.querySelector('img[src$="login-art.png"]')).toBeTruthy()
  // 帮助文案在底部浮层里，默认不渲染；点「登录帮助」才出现（不依赖具体文案）。
  const content = () => document.querySelector('[data-slot="popover-content"]')
  expect(content()).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '帮助' }))
  expect(content()).toBeTruthy()
})

it('登录原因里的换行会被保留（whitespace-pre-line）', () => {
  renderDialog({ reason: '登录状态已失效，请重新登录。\n一般是因为TShock服务器重启过了' })
  const desc = screen.getByText(/登录状态已失效/)
  expect(desc.className).toContain('whitespace-pre-line')
  expect(desc.textContent).toBe('登录状态已失效，请重新登录。\n一般是因为TShock服务器重启过了')
})

it('帮助浮层 hover 打开后，点击玩家名输入框会关闭浮层并聚焦输入框', () => {
  renderDialog()
  const trigger = screen.getByRole('button', { name: '帮助' })
  fireEvent.pointerEnter(trigger)
  expect(document.querySelector('[data-slot="popover-content"]')).toBeTruthy()

  const input = screen.getByPlaceholderText('输入玩家名')
  fireEvent.focus(input)
  fireEvent.pointerDown(input)
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
  expect(document.activeElement).toBe(input)
})

it('在线授权：请求登录成功后回调用户名', async () => {
  const { onSuccess } = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '在线授权' }))
  fireEvent.change(screen.getByPlaceholderText('输入玩家名'), { target: { value: 'Alice' } })
  fireEvent.click(screen.getByRole('button', { name: '请求登录' }))

  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ username: 'Alice' }))
})

it('在线授权：玩家不在线时展示后端文案', async () => {
  renderDialog({
    transport: makeTransport({
      loginOnline: async () => {
        throw new TshockRequestError('validation', '该玩家不在线')
      },
    }),
  })
  fireEvent.click(screen.getByRole('button', { name: '在线授权' }))
  fireEvent.change(screen.getByPlaceholderText('输入玩家名'), { target: { value: 'Ghost' } })
  fireEvent.click(screen.getByRole('button', { name: '请求登录' }))

  expect(await screen.findByText('该玩家不在线')).toBeTruthy()
})

it('密码登录失败：把「密码错 / 缺权限 / 限流」的同一 403 拆成可核对清单', async () => {
  renderDialog({
    transport: makeTransport({
      // 未装插件：后端无法预检限流，三条原因都列。
      webauthCapabilities: async () => ({ plugin: false }),
      login: async () => {
        throw new TshockRequestError('auth', '账号或密码错误；也可能是账号所属用户组缺少 tshock.rest.useapi 权限')
      },
    }),
  })
  fireEvent.change(screen.getByPlaceholderText('输入玩家名'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'bad' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))

  expect(await screen.findByText('登录失败')).toBeTruthy()
  expect(screen.getByText('玩家名或密码不正确')).toBeTruthy()
  expect(screen.getByText(/缺少 tshock\.rest\.useapi 权限/)).toBeTruthy()
  expect(screen.getByText(/建令牌限流/)).toBeTruthy()
  // 可复制的赋权命令仍在
  expect(screen.getByText('/group addperm default tshock.rest.useapi tshock.rest.command')).toBeTruthy()
})

it('装了信使插件：后端已预检限流，清单不再列「限流」（精确化）', async () => {
  renderDialog({
    transport: makeTransport({
      webauthCapabilities: async () => ({ plugin: true }),
      login: async () => {
        throw new TshockRequestError('auth', '账号或密码错误')
      },
    }),
  })
  fireEvent.change(screen.getByPlaceholderText('输入玩家名'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'bad' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))

  expect(await screen.findByText('登录失败')).toBeTruthy()
  await waitFor(() => expect(screen.queryByText(/建令牌限流/)).toBeNull())
  expect(screen.getByText('玩家名或密码不正确')).toBeTruthy()
})

it('限流：显示精确提示（不再列其它原因）', async () => {
  renderDialog({
    transport: makeTransport({
      login: async () => {
        throw new TshockRequestError('rate_limited', '已触发 TShock 建令牌限流')
      },
    }),
  })
  fireEvent.change(screen.getByPlaceholderText('输入玩家名'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'bad' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))

  expect(await screen.findByText(/每分钟只恢复 1 个/)).toBeTruthy()
  expect(screen.queryByText('玩家名或密码不正确')).toBeNull()
})

it('在线授权：未安装信使插件时禁用并提示', async () => {
  renderDialog({ transport: makeTransport({ webauthCapabilities: async () => ({ plugin: false }) }) })
  fireEvent.click(screen.getByRole('button', { name: '在线授权' }))

  await waitFor(() =>
    expect(screen.getByRole('button', { name: '请求登录' })).toHaveProperty('disabled', true),
  )
  expect(screen.getByText(/未安装/)).toBeTruthy()
})

it('可切到访问令牌再切回账号密码，并可用令牌登录', async () => {
  const { onSuccess } = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '令牌登录' }))
  expect(screen.getByPlaceholderText('ApplicationRestToken')).toBeTruthy()
  expect(screen.queryByPlaceholderText('密码')).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('ApplicationRestToken'), { target: { value: 'tok' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() => expect(onSuccess).toHaveBeenCalled())

  fireEvent.click(screen.getByRole('button', { name: '密码登录' }))
  expect(screen.getByPlaceholderText('密码')).toBeTruthy()
})
