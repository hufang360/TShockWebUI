import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DEFAULT_MODULES } from '@/lib/modules'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport } from '@/lib/tshock'
import type { Settings } from '@/types'
import { APP_VERSION } from '@/lib/version'
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

describe('SettingsPage 未登录', () => {
  it('隐藏设置内容，显示登录提示与登录按钮', () => {
    const onLogin = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={fakeTransport()}
          authenticated={false}
          modules={DEFAULT_MODULES}
          onModulesChange={vi.fn()}
          customModules={[]}
          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={onLogin}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('请先登录！')).toBeTruthy()
    expect(screen.queryByText('统一执行')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })
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

  it('统一执行位于「数据刷新」卡片内（不在界面偏好）', async () => {
    renderSettings(fakeTransport({ batchCapabilities: async () => ({ plugin: true }) }))
    const sw = await screen.findByRole('switch', { name: '统一执行' })
    const card = sw.closest('[data-slot="card"]')
    expect(card?.textContent).toContain('数据刷新')
    expect(card?.textContent).not.toContain('界面偏好')
  })

  it('两栏结构：激活模块在左列，界面偏好 / 数据刷新 / 账户在右列', async () => {
    renderSettings(fakeTransport({ batchCapabilities: async () => ({ plugin: true }) }))
    const accountCard = (await screen.findByText('在线授权 / 账户')).closest('[data-slot="card"]')
    const prefCard = screen.getByText('界面偏好').closest('[data-slot="card"]')
    const refreshCard = screen.getByText('数据刷新').closest('[data-slot="card"]')
    const activateCard = screen.getByText('激活模块').closest('[data-slot="card"]')

    const rightCol = accountCard?.parentElement
    const leftCol = activateCard?.parentElement
    const grid = rightCol?.parentElement

    expect(grid?.className).toContain('xl:grid-cols-[minmax(0,1fr)_360px]')
    // 左列只放激活模块；右列含界面偏好 / 数据刷新 / 账户，且为 grid 的最后一列。
    expect(leftCol).not.toBe(rightCol)
    expect(prefCard?.parentElement).toBe(rightCol)
    expect(refreshCard?.parentElement).toBe(rightCol)
    expect(grid?.lastElementChild).toBe(rightCol)
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

  it('手动拨动开关会记录「用户选择过」（用于关闭自动激活）', async () => {
    const onModuleUserSet = vi.fn()
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
          onModulesChange={vi.fn()}
          onModuleUserSet={onModuleUserSet}
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
    expect(onModuleUserSet).toHaveBeenCalledWith('players')
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
          customModules={[{ id: 'm:1', name: '旧名', command: '/old', desc: '' }]}
          onCustomModulesChange={onCustomModulesChange}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    const input = screen.getByDisplayValue('旧名')
    fireEvent.change(input, { target: { value: '新名' } })
    expect(onCustomModulesChange).toHaveBeenCalledWith([{ id: 'm:1', name: '新名', command: '/old', desc: '' }])
  })

  it('修改自定义模块主指令会同步自动生成的「帮助」卡片', async () => {
    localStorage.setItem(
      'tswui:moduleCards',
      JSON.stringify({ byServer: { default: { 'm:1': [{ id: 'c:1', name: '帮助', command: '/old help' }] } } }),
    )
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
          customModules={[{ id: 'm:1', name: '旧名', command: '/old', desc: '' }]}
          onCustomModulesChange={onCustomModulesChange}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.change(screen.getByDisplayValue('/old'), { target: { value: '/new' } })
    expect(onCustomModulesChange).toHaveBeenCalledWith([{ id: 'm:1', name: '旧名', command: '/new', desc: '' }])
    await waitFor(() => {
      const raw = JSON.parse(localStorage.getItem('tswui:moduleCards') ?? '{}') as {
        byServer?: Record<string, Record<string, { command: string }[]>>
      }
      expect(raw.byServer?.default?.['m:1']?.[0]?.command).toBe('/new help')
    })
  })

  it('自定义模块可修改顶部说明文字', () => {
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
          customModules={[{ id: 'm:1', name: '旧名', command: '/old', desc: '' }]}
          onCustomModulesChange={onCustomModulesChange}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.change(screen.getByPlaceholderText('模块顶部说明（可留空）'), {
      target: { value: '我的钓鱼模块' },
    })
    expect(onCustomModulesChange).toHaveBeenCalledWith([
      { id: 'm:1', name: '旧名', command: '/old', desc: '我的钓鱼模块' },
    ])
  })

  it('页面底部显示版本号', () => {
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
    expect(screen.getByText(`TShockWebUI ${APP_VERSION}`)).toBeTruthy()
  })
})
