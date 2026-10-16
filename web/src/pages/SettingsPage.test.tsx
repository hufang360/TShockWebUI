import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DEFAULT_MODULES } from '@/lib/modules'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport } from '@/lib/tshock'
import type { Settings } from '@/types'
import { SettingsPage } from './SettingsPage'

const settings: Settings = {
  theme: 'dark',
  fontSize: 15,
  showIcons: true,
  insertWithCount: false,
  liveMode: false,
  language: 'zh',
  compact: true,
  commandInterval: 2000,
  refreshInterval: 120000,
  eventsRefreshInterval: 180000,
}

function fakeTransport(overrides: Partial<BackendTransport> = {}): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'Alice' }),
    login: async () => ({ username: 'Alice' }),
    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    servers: async () => ({ allowCustom: false, default: null }),
    playersList: async () => [],
    runCommand: async () => ({ status: 'ok', output: [] }),
    ...playerStubs,
    ...overrides,
  }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('SettingsPage 统一执行（批量执行开关）', () => {
  const renderSettings = (transport: BackendTransport) =>
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={transport}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={vi.fn()}

          customModules={[]}

          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

  it('插件已安装时开关可用', async () => {
    renderSettings(fakeTransport())
    const sw = await screen.findByRole('switch', { name: '统一执行' })
    await waitFor(() => expect(sw.hasAttribute('disabled')).toBe(false))
  })

  it('插件未安装时开关禁用并提示', async () => {
    renderSettings(fakeTransport({ batchCapabilities: async () => ({ plugin: false }) }))
    const sw = await screen.findByRole('switch', { name: '统一执行' })
    await waitFor(() => expect(sw.hasAttribute('disabled')).toBe(true))
    expect(screen.getByText('需服务器安装信使插件后可用')).toBeTruthy()
  })
})

describe('SettingsPage 激活模块', () => {
  it('已安装且授权的模块可打开开关', async () => {
    const onModulesChange = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={fakeTransport({
            playerCapabilities: async () => ({ plugin: true, permission: true }),
            fishCapabilities: async () => ({ plugin: true, permission: true }),
          })}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={onModulesChange}
          customModules={[]}
          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    const sw = (await screen.findByRole('switch', { name: '玩家管理' })) as HTMLButtonElement
    await waitFor(() => expect(sw.disabled).toBe(false))
    fireEvent.click(sw)
    expect(onModulesChange).toHaveBeenCalledWith({ byServer: { default: ['players'] } })
  })

  it('未安装插件的模块开关禁用并提示', async () => {
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={fakeTransport({
            playerCapabilities: async () => ({ plugin: false, permission: false }),
            fishCapabilities: async () => ({ plugin: true, permission: true }),
          })}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={vi.fn()}

          customModules={[]}

          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    const sw = (await screen.findByRole('switch', { name: '玩家管理' })) as HTMLButtonElement
    await waitFor(() => expect(sw.disabled).toBe(true))
    expect(screen.getByText('未安装')).toBeTruthy()
  })

  it('切换服务器后重新探测（不同服务器插件不同）', async () => {
    let server = 'online'
    const transport = fakeTransport({
      playerCapabilities: async () =>
        server === 'online' ? { plugin: true, permission: true } : { plugin: false, permission: false },
      fishCapabilities: async () => ({ plugin: true, permission: true }),
    })
    const view = (serverId: string) => (
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId={serverId}
          transport={transport}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={vi.fn()}

          customModules={[]}

          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>
    )
    const { rerender } = render(view('online'))

    const sw = (await screen.findByRole('switch', { name: '玩家管理' })) as HTMLButtonElement
    await waitFor(() => expect(sw.disabled).toBe(false))

    // 切到本地服务器：玩家管理插件不存在 → 开关变灰。
    server = 'local'
    rerender(view('local'))
    await waitFor(() => expect(screen.getByRole('switch', { name: '玩家管理' }).hasAttribute('disabled')).toBe(true))
  })

  it('服务器动态刷新间隔：默认组不能选 1 分钟', async () => {
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={fakeTransport({})}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={vi.fn()}
          customModules={[]}
          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )
    const select = (await screen.findByLabelText('服务器动态刷新间隔')) as HTMLSelectElement
    await waitFor(() => {
      const opt = Array.from(select.options).find((o) => o.value === '60000')
      expect(opt?.disabled).toBe(true)
    })
  })

  it('服务器动态刷新间隔：vip 组可选 1 分钟', async () => {
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={fakeTransport({
            me: async () => ({
              username: 'vipuser',
              group: 'vip',
              permissions: [],
              canUseApi: true,
              canRunCommands: true,
            }),
          })}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={vi.fn()}
          customModules={[]}
          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )
    const select = (await screen.findByLabelText('服务器动态刷新间隔')) as HTMLSelectElement
    await waitFor(() => {
      const opt = Array.from(select.options).find((o) => o.value === '60000')
      expect(opt?.disabled).toBe(false)
    })
  })

  it('创建自定义模块：写入定义、把指令当成首张卡片并自动激活', async () => {
    const onCustomModulesChange = vi.fn()
    const onModulesChange = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={fakeTransport({})}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={onModulesChange}
          customModules={[]}
          onCustomModulesChange={onCustomModulesChange}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: '自定义' }))
    fireEvent.change(screen.getByLabelText('模块名称'), { target: { value: '我的模块' } })
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'time' } })
    fireEvent.click(screen.getByRole('button', { name: /创建模块/ }))

    expect(onCustomModulesChange).toHaveBeenCalledTimes(1)
    const created = onCustomModulesChange.mock.calls[0][0] as { id: string; name: string }[]
    expect(created).toHaveLength(1)
    expect(created[0].name).toBe('我的模块')
    // 创建的模块被自动激活。
    expect(onModulesChange).toHaveBeenCalledWith({ byServer: { default: [created[0].id] } })
    // 自动生成「帮助」卡片：名称「帮助」、指令 `<前缀> help`。
    const stored = JSON.parse(localStorage.getItem('tswui:moduleCards') ?? '{}')
    expect(stored.byServer.default[created[0].id][0].command).toBe('/time help')
    expect(stored.byServer.default[created[0].id][0].name).toBe('帮助')
  })

  it('自定义模块创建后可重命名', async () => {
    const onCustomModulesChange = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={fakeTransport({})}
          authenticated
          modules={DEFAULT_MODULES}
          onModulesChange={vi.fn()}
          customModules={[{ id: 'm:1', name: '旧名' }]}
          onCustomModulesChange={onCustomModulesChange}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: '自定义' }))
    const input = screen.getByDisplayValue('旧名')
    fireEvent.change(input, { target: { value: '新名' } })
    expect(onCustomModulesChange).toHaveBeenCalledWith([{ id: 'm:1', name: '新名' }])
  })
})
