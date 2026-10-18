import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WebAccountSection } from '@/components/WebAccountSection'
import { I18nProvider } from '@/lib/i18n'
import { TshockRequestError, type BackendTransport, type MeInfo, type SessionInfo } from '@/lib/tshock'
import type { CommandResult } from '@/types'
import { playerStubs } from '@/test/playerStubs'

function makeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'hf' }),
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

function renderSection(transport: BackendTransport) {
  render(
    <I18nProvider lang="zh">
      <WebAccountSection transport={transport} authenticated serverId="default" />
    </I18nProvider>,
  )
}

/**
 * 回归：插件是后来才装的（或后端二进制过期）时，「未安装」提示必须可自助重试，
 * 不能一直卡住直到整页刷新。
 */
it('插件缺失时可点「重新检测」恢复，无需刷新页面', async () => {
  const pluginMissing = () => new TshockRequestError('plugin_missing', '服务器未安装信使插件')
  const me = vi.fn(async (): Promise<MeInfo> => {
    throw pluginMissing()
  })
  const sessions = vi.fn(async (): Promise<SessionInfo[]> => {
    throw pluginMissing()
  })
  const transport = makeTransport({ me, sessions })

  renderSection(transport)

  await screen.findByText('服务器未安装信使插件，无法管理网页会话。')
  const recheck = screen.getByRole('button', { name: '重新检测' })

  // 服务器上装好插件后：同一个传输层开始返回真实数据。
  me.mockResolvedValue({
    username: 'hf',
    group: 'default',
    permissions: [],
    canUseApi: true,
    canRunCommands: true,
  })
  sessions.mockResolvedValue([])

  fireEvent.click(recheck)

  await waitFor(() => {
    expect(screen.queryByText('服务器未安装信使插件，无法管理网页会话。')).toBeNull()
  })
  expect(screen.getByText('用户组: default')).toBeTruthy()
  expect(screen.getByText('没有其它网页会话')).toBeTruthy()
})
