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

function renderDialog(transport: BackendTransport, onSuccess = vi.fn()) {
  render(
    <I18nProvider lang="zh">
      <LoginDialog open onClose={() => {}} transport={transport} onSuccess={onSuccess} serverId="builtin" />
    </I18nProvider>,
  )
  return onSuccess
}

it('在线授权：请求登录成功后回调用户名', async () => {
  const onSuccess = renderDialog(makeTransport())
  fireEvent.mouseDown(screen.getByRole('tab', { name: '在线授权' }))
  fireEvent.change(screen.getByPlaceholderText('TShock 账号'), { target: { value: 'Alice' } })
  fireEvent.click(screen.getByRole('button', { name: '请求登录' }))

  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ username: 'Alice' }))
})

it('在线授权：玩家不在线时展示后端文案', async () => {
  const transport = makeTransport({
    loginOnline: async () => {
      throw new TshockRequestError('validation', '该玩家不在线')
    },
  })
  renderDialog(transport)
  fireEvent.mouseDown(screen.getByRole('tab', { name: '在线授权' }))
  fireEvent.change(screen.getByPlaceholderText('TShock 账号'), { target: { value: 'Ghost' } })
  fireEvent.click(screen.getByRole('button', { name: '请求登录' }))

  expect(await screen.findByText('该玩家不在线')).toBeTruthy()
})

it('在线授权：未安装信使插件时禁用并提示', async () => {
  renderDialog(makeTransport({ webauthCapabilities: async () => ({ plugin: false }) }))
  fireEvent.mouseDown(screen.getByRole('tab', { name: '在线授权' }))

  await waitFor(() => expect(screen.getByRole('button', { name: '请求登录' })).toHaveProperty('disabled', true))
  expect(screen.getByText(/未安装/)).toBeTruthy()
})
