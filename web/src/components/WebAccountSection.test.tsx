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

/**
 * 游戏内 `/group` 之后：点「刷新组与权限」要能拿到新用户组 / 权限，
 * 并把「组变了」这件事交给上层（模块探测 / 指令目录重拉）。
 */
it('刷新组与权限：显示组变化并通知上层', async () => {
  const onPermissionsChanged = vi.fn()
  const refreshMe = vi.fn(
    async (): Promise<MeInfo> => ({
      username: 'hf',
      group: 'vip',
      permissions: ['tshock.rest.useapi', 'tshock.rest.command'],
      canUseApi: true,
      canRunCommands: true,
      previousGroup: 'default',
    }),
  )
  const transport = makeTransport({ refreshMe })

  render(
    <I18nProvider lang="zh">
      <WebAccountSection
        transport={transport}
        authenticated
        serverId="default"
        onPermissionsChanged={onPermissionsChanged}
      />
    </I18nProvider>,
  )

  fireEvent.click(await screen.findByRole('button', { name: '刷新组与权限' }))

  await screen.findByText('用户组 default → vip，权限已更新')
  expect(screen.getByText('用户组: vip')).toBeTruthy()
  expect(onPermissionsChanged).toHaveBeenCalledTimes(1)
})

it('刷新组与权限：组没变也给反馈', async () => {
  const refreshMe = vi.fn(
    async (): Promise<MeInfo> => ({
      username: 'hf',
      group: 'default',
      permissions: [],
      canUseApi: true,
      canRunCommands: true,
      previousGroup: 'default',
    }),
  )
  renderSection(makeTransport({ refreshMe }))

  fireEvent.click(await screen.findByRole('button', { name: '刷新组与权限' }))
  await screen.findByText('用户组仍是 default')
})

it('刷新组与权限：旧插件（没有 me_refresh）提示升级或重新登录', async () => {
  const refreshMe = vi.fn(async (): Promise<MeInfo> => {
    throw new TshockRequestError('plugin_outdated', '插件缺少 me_refresh 能力')
  })
  renderSection(makeTransport({ refreshMe }))

  fireEvent.click(await screen.findByRole('button', { name: '刷新组与权限' }))
  await screen.findByText('插件版本过旧，无法刷新；请升级插件或重新登录')
})

it('刷新组与权限：服务器预置令牌时如实说明，不假装换组', async () => {
  const refreshMe = vi.fn(
    async (): Promise<MeInfo> => ({
      username: 'hf',
      group: 'default',
      permissions: [],
      canUseApi: true,
      canRunCommands: true,
      previousGroup: 'default',
      fixedToken: true,
    }),
  )
  renderSection(makeTransport({ refreshMe }))

  fireEvent.click(await screen.findByRole('button', { name: '刷新组与权限' }))
  await screen.findByText('这个会话用的是服务器预置令牌，用户组由服务器配置决定')
})
