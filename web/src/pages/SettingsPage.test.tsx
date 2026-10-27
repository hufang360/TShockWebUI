import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { DEFAULT_MODULES } from '@/lib/modules'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport, ServerCapabilities } from '@/lib/tshock'
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

/**
 * 只改某几项能力的传输层：SettingsPage 现在读统一能力矩阵（/api/capabilities），
 * 不再分别调 player/fish/batch/requests 的探测端点。
 */
function capsTransport(
  patch: Partial<ServerCapabilities>,
  overrides: Partial<BackendTransport> = {},
): BackendTransport {
  const base = fakeTransport(overrides)
  return {
    ...base,
    capabilities: async () => ({ ...(await base.capabilities()), ...patch }),
  }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

/** 切到「激活模块」的某个 tab（Radix Tabs 用 mousedown 激活）。 */
function openModuleTab(name: '内置模块' | '已适配' | '自定义') {
  fireEvent.mouseDown(screen.getByRole('tab', { name }))
}

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
    expect(screen.queryByText('批量执行卡片')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsPage 批量执行卡片', () => {
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
    const sw = await screen.findByRole('switch', { name: '批量执行卡片' })
    await waitFor(() => expect(sw.hasAttribute('disabled')).toBe(false))
  })

  it('插件未安装时开关禁用并提示', async () => {
    renderSettings(capsTransport({ batch: { plugin: false } }))
    const sw = await screen.findByRole('switch', { name: '批量执行卡片' })
    await waitFor(() => expect(sw.hasAttribute('disabled')).toBe(true))
    expect(screen.getByText('需服务器安装信使插件后可用')).toBeTruthy()
  })

  it('批量执行卡片位于「执行行为」卡片内', async () => {
    renderSettings(capsTransport({ batch: { plugin: true, ingame: true } }))
    const sw = await screen.findByRole('switch', { name: '批量执行卡片' })
    const card = sw.closest('[data-slot="card"]')
    expect(card?.textContent).toContain('执行行为')
    expect(card?.textContent).not.toContain('数据刷新')
    expect(card?.textContent).not.toContain('界面偏好')
  })

  it('两栏结构：界面偏好 / 激活模块在左列，执行行为 / 数据刷新 / 账户在右列', async () => {
    renderSettings(capsTransport({ batch: { plugin: true, ingame: true } }))
    const accountCard = (await screen.findByText('在线授权 / 账户')).closest('[data-slot="card"]')
    const prefCard = screen.getByText('界面偏好').closest('[data-slot="card"]')
    const executionCard = screen.getByText('执行行为').closest('[data-slot="card"]')
    const refreshCard = screen.getByText('数据刷新').closest('[data-slot="card"]')
    const activateCard = screen.getByText('激活模块').closest('[data-slot="card"]')

    const rightCol = accountCard?.parentElement
    const leftCol = activateCard?.parentElement
    const grid = rightCol?.parentElement

    expect(grid?.className).toContain('xl:grid-cols-[minmax(0,1fr)_360px]')
    expect(leftCol).not.toBe(rightCol)
    // 左列：界面偏好在最上，激活模块紧随其后。
    expect(prefCard?.parentElement).toBe(leftCol)
    expect(leftCol?.firstElementChild).toBe(prefCard)
    expect(executionCard?.parentElement).toBe(rightCol)
    expect(refreshCard?.parentElement).toBe(rightCol)
    expect(grid?.lastElementChild).toBe(rightCol)
  })
})

describe('SettingsPage 激活模块', () => {
  it('按来源分三个 tab：内置模块 / 已适配 / 自定义', async () => {
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={capsTransport({})}
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

    expect(await screen.findByRole('tab', { name: '内置模块' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '已适配' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '自定义' })).toBeTruthy()

    // 内置模块：信使插件提供的物资申请。
    expect(screen.getByRole('switch', { name: '物资申请' })).toBeTruthy()
    expect(screen.queryByRole('switch', { name: '玩家管理' })).toBeNull()

    // 已适配：PlayerManager / FishShop / WorldModify。
    openModuleTab('已适配')
    expect(await screen.findByRole('switch', { name: '玩家管理' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '鱼店' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '世界管理' })).toBeTruthy()
    expect(screen.getByText('依赖插件 WorldModify（/wm、/wi、/bi 等）')).toBeTruthy()

    // 自定义：创建表单。
    openModuleTab('自定义')
    expect(await screen.findByPlaceholderText('模块名称')).toBeTruthy()
  })

  it('已安装且授权的模块可打开开关', async () => {
    const onModulesChange = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={capsTransport({})}
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

    openModuleTab('已适配')
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
          transport={capsTransport({})}
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

    openModuleTab('已适配')
    const sw = (await screen.findByRole('switch', { name: '玩家管理' })) as HTMLButtonElement
    await waitFor(() => expect(sw.disabled).toBe(false))
    fireEvent.click(sw)
    expect(onModuleUserSet).toHaveBeenCalledWith('players')
  })

  it('插件未安装时仍可打开模块开关', async () => {
    const onModulesChange = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={capsTransport({ player: { plugin: false, permission: false } })}
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

    openModuleTab('已适配')
    const sw = (await screen.findByRole('switch', { name: '玩家管理' })) as HTMLButtonElement
    await waitFor(() => expect(sw.disabled).toBe(false))
    expect(screen.getByText('未安装')).toBeTruthy()
    fireEvent.click(sw)
    expect(onModulesChange).toHaveBeenCalledWith({ byServer: { default: ['players'] } })
  })

  it('插件移除后，曾经开启的模块仍可关闭', async () => {
    const onModulesChange = vi.fn()
    render(
      <I18nProvider lang="zh">
        <SettingsPage
          settings={settings}
          onChange={vi.fn()}
          serverId="default"
          transport={capsTransport({ player: { plugin: false, permission: false } })}
          authenticated
          modules={{ byServer: { default: ['players'] } }}
          onModulesChange={onModulesChange}
          customModules={[]}
          onCustomModulesChange={vi.fn()}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )

    openModuleTab('已适配')
    const sw = (await screen.findByRole('switch', { name: '玩家管理' })) as HTMLButtonElement
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
    expect(sw.disabled).toBe(false)
    fireEvent.click(sw)
    expect(onModulesChange).toHaveBeenCalledWith({ byServer: {} })
  })

  it('切换服务器后重新探测（不同服务器插件不同），开关始终可操作', async () => {
    let server = 'online'
    const transport = fakeTransport({
      capabilities: async () => ({
        ...(await playerStubs.capabilities()),
        player:
          server === 'online' ? { plugin: true, permission: true } : { plugin: false, permission: false },
      }),
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

    openModuleTab('已适配')
    const sw = (await screen.findByRole('switch', { name: '玩家管理' })) as HTMLButtonElement
    await waitFor(() => expect(sw.disabled).toBe(false))

    // 切到本地服务器：插件不存在，但开关仍可操作。
    server = 'local'
    rerender(view('local'))
    await waitFor(() => expect(screen.getByText('未安装')).toBeTruthy())
    expect(screen.getByRole('switch', { name: '玩家管理' }).hasAttribute('disabled')).toBe(false)
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
    openModuleTab('自定义')

    const create = screen.getByRole('button', { name: /创建模块/ })
    expect(create.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('模块名称'), { target: { value: '我的模块' } })
    expect(create.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: 'time' } })
    expect(create.hasAttribute('disabled')).toBe(false)
    fireEvent.click(create)

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
    openModuleTab('自定义')

    const input = screen.getByDisplayValue('旧名')
    fireEvent.change(input, { target: { value: '新名' } })
    expect(onCustomModulesChange).toHaveBeenCalledWith([{ id: 'm:1', name: '新名', command: '/old', desc: '' }])
  })

  it('自定义模块可用下移按钮调整侧栏顺序', () => {
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
          customModules={[
            { id: 'm:1', name: '模块A', command: '/a', desc: '' },
            { id: 'm:2', name: '模块B', command: '/b', desc: '' },
          ]}
          onCustomModulesChange={onCustomModulesChange}
          onTokenInvalid={vi.fn()}
          onLogin={vi.fn()}
        />
      </I18nProvider>,
    )
    openModuleTab('自定义')

    const first = screen.getByDisplayValue('模块A').closest('li') as HTMLElement
    fireEvent.click(within(first).getByRole('button', { name: '下移' }))
    expect(onCustomModulesChange).toHaveBeenCalledWith([
      { id: 'm:2', name: '模块B', command: '/b', desc: '' },
      { id: 'm:1', name: '模块A', command: '/a', desc: '' },
    ])
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
    openModuleTab('自定义')

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
    openModuleTab('自定义')

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

describe('SettingsPage 世界管理插件探测', () => {
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

  /** 世界管理那一行（`ModuleRow` 是 `<li>`）。 */
  const worldRow = () => screen.getByText('世界管理').closest('li') as HTMLElement

  it('/wi 返回「指令不存在」→ 世界管理显示未安装', async () => {
    renderSettings(
      fakeTransport({
        runCommand: async () => ({ status: 'command_not_found', output: [], message: '' }),
      }),
    )
    openModuleTab('已适配')
    await waitFor(() => expect(within(worldRow()).getByText('未安装')).toBeTruthy())
  })

  it('/wi 返回权限不足 → 世界管理显示无权限（不误报未安装）', async () => {
    renderSettings(
      fakeTransport({
        runCommand: async () => ({
          status: 'no_permission',
          output: ['你没有权限使用该指令。'],
          message: '权限不足，无法执行该指令',
        }),
      }),
    )
    openModuleTab('已适配')
    await waitFor(() => expect(within(worldRow()).getByText('无权限')).toBeTruthy())
    expect(within(worldRow()).queryByText('未安装')).toBeNull()
    expect(within(worldRow()).getByText('已安装插件，但你的用户组缺少权限，暂不可用。')).toBeTruthy()
  })

  it('/wi 成功 → 世界管理显示已安装', async () => {
    renderSettings(fakeTransport())
    openModuleTab('已适配')
    await waitFor(() => expect(within(worldRow()).getByText('已安装')).toBeTruthy())
  })
})
