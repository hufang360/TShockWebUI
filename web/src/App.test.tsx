import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui'
import App from './App'
import { HttpTransport, MockTransport } from '@/lib/tshock'

// vitest 的 cwd 为 web/，数据在仓库根的 data/
const dataDir = path.resolve(process.cwd(), '../data') + path.sep

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const rel = url.replace(/^.*\/data\//, '')
      try {
        const body = readFileSync(`${dataDir}${rel}`)
        return new Response(body, {
          status: 200,
          headers: { 'content-type': rel.endsWith('.png') ? 'image/png' : 'application/json' },
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }),
  )
}

/** 打开侧栏底部账号菜单（Radix DropdownMenu 由 ArrowDown 触发）。 */
function openAccountMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: '账号与服务器' }), { key: 'ArrowDown' })
}

/** 打开账号菜单并点选一项（如 '登录' / '退出登录' / '切换服务器'）。 */
async function clickAccountItem(name: string) {
  // 先等 login / 确认框之类关闭，避免模态遮罩挡住菜单。
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  openAccountMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

/** 通过账号菜单登录（MockTransport 接受任意账号密码）。 */
async function loginAsAlice() {
  await clickAccountItem('登录')
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByPlaceholderText('输入玩家名'), {
    target: { value: 'Alice' },
  })
  fireEvent.change(within(dialog).getByPlaceholderText('密码'), { target: { value: 'pw' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

it('应用可启动并加载真实数据（Mock 传输标识存在）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)

  expect(await screen.findByText('WebUI')).toBeTruthy()
  expect((await screen.findAllByText('指令')).length).toBeGreaterThan(0)
  // Mock 必须显式标注，不得冒充真实服务器
  expect(screen.getAllByText(/Mock/).length).toBeGreaterThan(0)
  expect(screen.getByText(/未连接真实服务器/)).toBeTruthy()
})

it('全局挂了 sonner 的 Toaster（主题跟随界面设置）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // Toaster 本身是空的，发一条提示才会挂出 `<ol data-sonner-toaster>`。
  act(() => {
    toast.success('已发送（显示为 [WebUI] hf）')
  })
  const container = await waitFor(() => {
    const el = document.querySelector('[data-sonner-toaster]')
    if (!el) throw new Error('toaster 还没挂载')
    return el as HTMLElement
  })
  // 默认设置是深色主题。
  expect(container.getAttribute('data-sonner-theme')).toBe('dark')
  toast.dismiss()
})

it('未登录时首页 / 指令只显示登录提示，设置页仍可改界面偏好', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // 首页：隐藏卡片，显示登录提示。
  expect(screen.getByText('请先登录！')).toBeTruthy()
  expect(screen.queryByText('服务器状态')).toBeNull()

  // 指令页：隐藏编辑器，显示登录提示。
  fireEvent.click(screen.getAllByRole('button', { name: '指令' })[0])
  expect(await screen.findByText('请先登录！')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '执行' })).toBeNull()

  // 设置页：界面偏好是纯本地设置，不登录也能改；要 token 的部分才用登录提示代替。
  fireEvent.click(screen.getAllByRole('button', { name: '设置' })[0])
  // 设置页是懒加载路由，等页面标题出现后再断言，避免命中上一页尚未卸载的登录提示。
  // 页面标题现在只在顶栏出现（内容区不再重复「设置」）。
  expect(await screen.findByText('设置', { selector: '[data-slot="breadcrumb-page"]' })).toBeTruthy()
  // 顶栏标题跟随导航立即更新，所以还要等设置页专有文案，确认懒加载页面已挂载。
  expect(await screen.findByText('偏好仅保存在本机，不会上传。')).toBeTruthy()
  expect(screen.getByRole('switch', { name: '紧凑视图' })).toBeTruthy()
  expect(screen.queryByText('激活模块')).toBeNull()
  expect(screen.getByText('请先登录！')).toBeTruthy()

  // 提示里的登录按钮能打开登录框（侧栏还有一条登录按钮，这里限定正文）。
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '登录' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(document.body, { key: 'Escape' })
})

it('页签同步到 URL hash，并可从 hash 直接打开', async () => {
  mockFetch()
  window.history.replaceState(null, '', '#/settings')
  render(<App transport={new MockTransport()} />)

  // 页面标题现在只在顶栏出现（内容区不再重复「设置」）。
  expect(await screen.findByText('设置', { selector: '[data-slot="breadcrumb-page"]' })).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: '物品 ID' })[0])
  expect(await screen.findByLabelText('物品 ID')).toBeTruthy()
  expect(window.location.hash).toBe('#/items')
})

it('指令页使用 #/cmd，并兼容旧 #/editor', async () => {
  mockFetch()
  window.history.replaceState(null, '', '#/editor')
  render(<App transport={new MockTransport()} />)

  expect(await screen.findByTestId('command-workspace')).toBeTruthy()
  await waitFor(() => expect(window.location.hash).toBe('#/cmd'))
})

it('未登录时侧栏账号上方有一条登录按钮，点击直接打开登录框', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // 侧栏（导航区）里的登录按钮，直接打开登录框。
  const sidebarLogin = within(screen.getByTestId('sidebar')).getAllByRole('button', { name: '登录' })[0]
  fireEvent.click(sidebarLogin)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(document.body, { key: 'Escape' })
})

it('登录只缓存 tswui:me，不持久化任何 token', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await clickAccountItem('登录')
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByPlaceholderText('输入玩家名'), {
    target: { value: 'Alice' },
  })
  fireEvent.change(within(dialog).getByPlaceholderText('密码'), {
    target: { value: 'pw' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }))

  await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())

  // 旧版 token 键必须不存在，也不得出现任何含 token 的键
  expect(localStorage.getItem('tswui:auth')).toBeNull()
  expect(Object.keys(localStorage).some((k) => k.toLowerCase().includes('token'))).toBe(false)
  expect(localStorage.getItem('tswui:me')).toContain('Alice')
  expect(localStorage.getItem('tswui:me')).not.toContain('token')
})

it('检测到信使插件后自动开启「统一执行」（用户未手动设置过）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await loginAsAlice()

  // MockTransport 的 batchCapabilities 返回 plugin=true → App 自动写入 homeBatch=true。
  await waitFor(() => expect(localStorage.getItem('tswui:homeBatch')).toBe('true'))
  expect(localStorage.getItem('tswui:homeBatchSet')).toBeNull()
})

it('用户手动关过「统一执行」后，重登不会被自动覆盖', async () => {
  mockFetch()
  localStorage.setItem('tswui:homeBatchSet', 'true')
  localStorage.setItem('tswui:homeBatch', 'false')
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await loginAsAlice()

  await new Promise((r) => setTimeout(r, 50))
  expect(localStorage.getItem('tswui:homeBatch')).toBe('false')
})

it('检测到角色档案 / 鱼店插件后自动激活侧边栏入口（用户未手动设置过）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await loginAsAlice()

  // MockTransport 的角色档案 / 鱼店探测都返回 plugin + permission → App 自动写入已激活模块。
  await waitFor(() => {
    const prefs = JSON.parse(localStorage.getItem('tswui:modules') ?? '{}')
    expect(prefs.byServer?.default ?? []).toEqual(expect.arrayContaining(['players', 'store']))
  })
  // 自动激活不算「用户手动设置过」。
  expect(localStorage.getItem('tswui:modulesSet')).toBeNull()
  // 侧边栏出现对应入口。
  expect(screen.getAllByRole('button', { name: '玩家管理' }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('button', { name: '鱼店' }).length).toBeGreaterThan(0)
})

it('关闭模块后侧边栏入口隐藏，直达 URL 回到首页', async () => {
  mockFetch()
  localStorage.setItem('tswui:modules', JSON.stringify({ byServer: { default: ['store'] } }))
  localStorage.setItem('tswui:modulesSet', JSON.stringify({ byServer: { default: ['players', 'store'] } }))
  window.location.hash = '#/players'
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  const sidebar = screen.getByTestId('sidebar')
  expect(within(sidebar).queryByRole('button', { name: '玩家管理' })).toBeNull()
  expect(within(sidebar).getByRole('button', { name: '鱼店' })).toBeTruthy()
  await waitFor(() => expect(window.location.hash).toBe('#/home'))
})

it('用户手动关过的模块，重登不会被自动激活覆盖', async () => {
  mockFetch()
  localStorage.setItem(
    'tswui:modulesSet',
    JSON.stringify({ byServer: { default: ['players', 'store'] } }),
  )
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await loginAsAlice()

  await new Promise((r) => setTimeout(r, 80))
  expect(localStorage.getItem('tswui:modules')).toBeNull()
})

it('记住密码：登录后写入 tswui:login，重新打开自动回填账号密码', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await clickAccountItem('登录')
  let dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByPlaceholderText('输入玩家名'), { target: { value: 'Alice' } })
  fireEvent.change(within(dialog).getByPlaceholderText('密码'), { target: { value: 'pw' } })
  // 「记住密码」默认勾选（Radix Checkbox：用 data-state 表达勾选态）
  const remember = within(dialog).getByRole('checkbox')
  expect(remember.getAttribute('data-state')).toBe('checked')
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }))
  await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())

  expect(localStorage.getItem('tswui:login')).toContain('Alice')
  // 密码按服务器分别记忆（默认上游 = default）
  expect(localStorage.getItem('tswui:passwords')).toContain('pw')

  // 退出需二次确认，再重新打开登录框，应已回填
  await clickAccountItem('退出')
  const confirm = await screen.findByRole('dialog')
  fireEvent.click(within(confirm).getByRole('button', { name: '退出' }))
  await waitFor(() => expect(screen.queryByText('Alice')).toBeNull())
  await clickAccountItem('登录')
  dialog = screen.getByRole('dialog')
  expect((within(dialog).getByPlaceholderText('输入玩家名') as HTMLInputElement).value).toBe('Alice')
})

it('退出需二次确认，取消后仍保持登录', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await clickAccountItem('登录')
  const login = screen.getByRole('dialog')
  fireEvent.change(within(login).getByPlaceholderText('输入玩家名'), { target: { value: 'Alice' } })
  fireEvent.change(within(login).getByPlaceholderText('密码'), { target: { value: 'pw' } })
  fireEvent.click(within(login).getByRole('button', { name: '登录' }))
  await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())

  // 点退出先弹确认框；取消则继续保留会话
  await clickAccountItem('退出')
  const confirm = await screen.findByRole('dialog')
  expect(within(confirm).getByText('退出登录')).toBeTruthy()
  fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByText('退出登录')).toBeNull())
  expect(screen.getByText('Alice')).toBeTruthy()
})

it('侧栏页头有主题 / 语言快捷按钮，可切换', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // 默认深色（深色类挂在 <html>，portal 弹框才能继承）。
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /主题：深色/ }))
  // 下一个状态是「自动」；jsdom 无系统深色 → 变浅色。
  await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  expect(screen.getByRole('button', { name: /主题：自动/ })).toBeTruthy()

  const langBtn = screen.getByRole('button', { name: /语言：中文/ })
  expect(langBtn.textContent).toBe('中')
  fireEvent.click(langBtn)
  await waitFor(() => expect(langBtn.textContent).toBe('EN'))
  expect(langBtn.getAttribute('aria-label')).toContain('Language')
})

it('设置入口固定在侧栏导航末尾（模块在其上方）', async () => {
  mockFetch()
  localStorage.setItem('tswui:modules', JSON.stringify({ byServer: { default: ['world'] } }))
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  const sidebar = screen.getByTestId('sidebar')
  const labels = Array.from(sidebar.querySelectorAll('[data-slot="sidebar-menu"] button')).map((b) =>
    b.textContent?.trim(),
  )
  expect(labels).toContain('世界管理')
  expect(labels[labels.length - 1]).toBe('设置')
})

it('紧凑视图默认开启，可在设置中关闭', async () => {
  mockFetch()
  const { container } = render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')
  await loginAsAlice()

  // 默认紧凑
  expect(container.querySelector('[data-compact="true"]')).toBeTruthy()

  // 设置里关闭紧凑视图（设置现在是正文页，不是弹框）
  fireEvent.click(screen.getAllByRole('button', { name: '设置' })[0])
  fireEvent.click(await screen.findByRole('switch', { name: '紧凑视图' }))
  await waitFor(() => expect(container.querySelector('[data-compact="true"]')).toBeNull())
})

it('密码可用眼睛图标切换显示/隐藏', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await clickAccountItem('登录')
  const dialog = screen.getByRole('dialog')
  const pw = within(dialog).getByPlaceholderText('密码') as HTMLInputElement
  expect(pw.type).toBe('password')

  fireEvent.click(within(dialog).getByRole('button', { name: '显示密码' }))
  expect((within(dialog).getByPlaceholderText('密码') as HTMLInputElement).type).toBe('text')

  fireEvent.click(within(dialog).getByRole('button', { name: '隐藏密码' }))
  expect((within(dialog).getByPlaceholderText('密码') as HTMLInputElement).type).toBe('password')
})

it('可用访问令牌登录，且令牌不落 localStorage', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await clickAccountItem('登录')
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: '令牌登录' }))
  fireEvent.change(within(dialog).getByPlaceholderText('ApplicationRestToken'), {
    target: { value: 'mock-token-xyz' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }))

  await waitFor(() => expect(screen.getByText('token-user')).toBeTruthy())
  expect(localStorage.getItem('tswui:auth')).toBeNull()
  expect(Object.keys(localStorage).some((k) => k.toLowerCase().includes('token'))).toBe(false)
  expect(JSON.stringify(localStorage)).not.toContain('mock-token-xyz')
})

it('侧栏可收成图标栏并可重新展开', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  const sidebar = () => screen.getByTestId('sidebar')
  expect(sidebar().dataset.collapsed).toBe('false')

  fireEvent.click(screen.getByRole('button', { name: '隐藏侧栏' }))
  expect(sidebar().dataset.collapsed).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: '显示侧栏' }))
  expect(sidebar().dataset.collapsed).toBe('false')
})

it('可新增自定义 TShock 上游（新增不自动切换）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  await clickAccountItem('切换服务器')
  fireEvent.click(await screen.findByRole('button', { name: /添加服务器/ }))
  fireEvent.change(await screen.findByLabelText('IP / 域名'), { target: { value: '1.2.3.4' } })
  fireEvent.change(screen.getByLabelText('端口'), { target: { value: '9999' } })
  fireEvent.click(screen.getByRole('button', { name: '添加' }))

  await waitFor(() => expect(localStorage.getItem('tswui:servers')).toContain('1.2.3.4'))
  expect(localStorage.getItem('tswui:servers')).toContain('9999')
  // 新增只入库、不切换：当前上游仍为内置默认。
  expect(localStorage.getItem('tswui:server') ?? 'default').not.toContain('1.2.3.4')
})

it('收藏是独立 tab（侧栏「指令」页 → 「收藏」）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')
  await loginAsAlice()

  fireEvent.click(screen.getAllByRole('button', { name: '指令' })[0])
  // 工具是弹框：先点输入框左下角的「收藏」按钮。
  fireEvent.click(await screen.findByRole('button', { name: '收藏' }))
  expect(await screen.findByPlaceholderText(/搜索收藏/)).toBeTruthy()
})

it('历史并入指令编辑器（侧栏「历史」页）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')
  await loginAsAlice()

  // 默认打开首页，先切到指令页
  fireEvent.click(screen.getAllByRole('button', { name: '指令' })[0])
  // 工具是弹框：先点输入框左下角的「历史」按钮。
  fireEvent.click(await screen.findByRole('button', { name: '历史' }))
  expect(await screen.findByText('暂无历史')).toBeTruthy()
})

it('执行指令时 token 失效 → 弹出登录框，登录成功后自动重试', async () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  let commandCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/data/')) {
        const rel = url.replace(/^.*\/data\//, '')
        try {
          const body = readFileSync(`${dataDir}${rel}`)
          return new Response(body, {
            status: 200,
            headers: { 'content-type': rel.endsWith('.png') ? 'image/png' : 'application/json' },
          })
        } catch {
          return new Response('not found', { status: 404 })
        }
      }
      switch (url) {
        case '/api/session':
          return json({ authenticated: true, username: 'Alice' })
        case '/api/status':
          return json({ reachable: true })
        case '/api/players':
          return json({ players: [] })
        case '/api/login':
          return json({ username: 'Alice' })
        case '/api/command':
          commandCalls += 1
          return commandCalls === 1
            ? json({ status: 'token_invalid', output: [], message: '登录已失效' })
            : json({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' })
        default:
          return new Response('not found', { status: 404 })
      }
    }),
  )

  localStorage.setItem('tswui:draft', JSON.stringify('/time'))
  // 固定到编辑器页：避免首页的 /who /time 等卡片消耗 /api/command 调用
  localStorage.setItem('tswui:ui', JSON.stringify({ activeTab: 'editor', sidebarCollapsed: false }))
  render(<App transport={new HttpTransport()} />)
  await screen.findByText('WebUI')

  fireEvent.click(screen.getByRole('button', { name: '执行' }))

  // token 失效 → 自动弹出登录框（被动重登）
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('登录 TShock')).toBeTruthy()

  fireEvent.change(within(dialog).getByPlaceholderText('密码'), { target: { value: 'pw' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }))

  // 登录成功后自动重试一次，并展示真实结果
  await waitFor(() => expect(commandCalls).toBe(2))
  expect(await screen.findByText('已把时间设置为 12:00')).toBeTruthy()
})

it('登录失败时提示服主赋权命令（addperm tshock.rest.useapi）', async () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/data/')) {
        const rel = url.replace(/^.*\/data\//, '')
        try {
          const body = readFileSync(`${dataDir}${rel}`)
          return new Response(body, {
            status: 200,
            headers: { 'content-type': rel.endsWith('.png') ? 'image/png' : 'application/json' },
          })
        } catch {
          return new Response('not found', { status: 404 })
        }
      }
      switch (url) {
        case '/api/session':
          return json({ authenticated: false, username: null })
        case '/api/status':
          return json({ reachable: false })
        case '/api/login':
          return json({ error: { code: 'bad_credentials', message: '账号或密码错误' } }, 401)
        default:
          return new Response('not found', { status: 404 })
      }
    }),
  )

  render(<App transport={new HttpTransport()} />)
  await screen.findByText('WebUI')

  await clickAccountItem('登录')
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByPlaceholderText('输入玩家名'), { target: { value: 'player' } })
  fireEvent.change(within(dialog).getByPlaceholderText('密码'), { target: { value: 'pw' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }))

  // 展示可复制的服主赋权命令
  expect(
    await within(dialog).findByText('/group addperm default tshock.rest.useapi tshock.rest.command'),
  ).toBeTruthy()
})

it('「终端」打开浮动终端，执行结果与指令页共享', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')
  await loginAsAlice()

  // 顶栏右侧的终端入口（首页不放、未登录不渲染）：先进「物品图鉴」。
  fireEvent.click(screen.getAllByRole('button', { name: '物品 ID' })[0])
  fireEvent.click(await screen.findByTestId('terminal-topbar'))
  const win = await screen.findByTestId('terminal-window')
  const input = within(win).getByPlaceholderText(/输入指令/)
  fireEvent.change(input, { target: { value: '/time day' } })
  // 先收起补全下拉，再回车执行（与指令页的编辑器行为一致）。
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(await within(win).findByText(/世界时间/)).toBeTruthy()

  // 切到指令页：终端自动收起（该页不需要它），终端跑过的结果已经在结果列表里（共用 tswui:commandResults）。
  fireEvent.click(screen.getAllByRole('button', { name: '指令' })[0])
  await waitFor(() => expect(screen.queryByTestId('terminal-window')).toBeNull())
  expect(await within(screen.getByRole('main')).findByText(/世界时间/)).toBeTruthy()
})

it('顶栏「指令」入口：未登录 / 首页不显示，登录后除首页、指令、设置外都显示', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // 未登录：不显示入口。
  expect(screen.queryByTestId('terminal-topbar')).toBeNull()

  await loginAsAlice()
  // 首页：右侧顶栏只留刷新 / 管理卡片，不放终端图标。
  expect(await screen.findByText('服务器状态')).toBeTruthy()
  expect(screen.queryByTestId('terminal-topbar')).toBeNull()

  // 指令页：隐藏。
  fireEvent.click(screen.getAllByRole('button', { name: '指令' })[0])
  expect(await screen.findByPlaceholderText(/输入指令/)).toBeTruthy()
  await waitFor(() => expect(screen.queryByTestId('terminal-topbar')).toBeNull())

  // 物品 ID：显示。
  fireEvent.click(screen.getAllByRole('button', { name: '物品 ID' })[0])
  expect(await screen.findByTestId('terminal-topbar')).toBeTruthy()

  // 设置页：隐藏。
  fireEvent.click(screen.getAllByRole('button', { name: '设置' })[0])
  // 页面标题现在只在顶栏出现（内容区不再重复「设置」）。
  expect(await screen.findByText('设置', { selector: '[data-slot="breadcrumb-page"]' })).toBeTruthy()
  await waitFor(() => expect(screen.queryByTestId('terminal-topbar')).toBeNull())
})

it('「玩家存档」是独立侧边栏菜单：未登录也能用，不依赖玩家管理模块', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // 侧栏「玩家存档」入口（公开工具；玩家管理模块此时未启用）。
  fireEvent.click(screen.getAllByRole('button', { name: '玩家存档' })[0])

  expect(await screen.findByTestId('players-save-drop')).toBeTruthy()
  expect(window.location.hash).toBe('#/plr')
  // 不需要登录，也不显示登录提示。
  expect(screen.queryByText('请先登录！')).toBeNull()
  expect(screen.getByRole('button', { name: /导入 \.plr/ })).toBeTruthy()
})

it('侧边栏「指令小抄」：排在「数据 ID」下一行，分组列出 Boss，点终端填进浮窗', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')
  await loginAsAlice()

  fireEvent.click(screen.getAllByRole('button', { name: '指令小抄' })[0])
  // 没有顶部 tab 了：左边搜索框，右边分组栏。
  expect(await screen.findByPlaceholderText('搜索指令或名称')).toBeTruthy()
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(window.location.hash).toBe('#/commands')
  expect(
    within(screen.getByRole('complementary')).getByRole('button', { name: /召唤 Boss/ }),
  ).toBeTruthy()
  // 侧栏顺序：指令小抄紧跟「数据 ID」。
  const sidebar = screen.getByTestId('sidebar')
  const labels = Array.from(sidebar.querySelectorAll('[data-slot="sidebar-menu"] button')).map((b) =>
    b.textContent?.trim(),
  )
  expect(labels.indexOf('指令小抄')).toBe(labels.indexOf('数据 ID') + 1)

  // 行本身不再响应单击：点「操作」列的终端按钮才填进浮窗。
  fireEvent.click(
    await screen.findByRole('button', { name: '填入指令浮窗：/spawnboss "king slime"' }),
  )
  const win = await screen.findByTestId('terminal-window')
  const input = within(win).getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
  expect(input.value).toBe('/spawnboss "king slime"')

  // 传送 NPC 用英文名（真实数据里的 `en` 字段）；点新记录会覆盖输入框。
  fireEvent.click(screen.getByRole('button', { name: '填入指令浮窗：/tpnpc Angler' }))
  expect(input.value).toBe('/tpnpc Angler')
})
it('「聊天」是独立页面：侧栏紧跟「指令」，地址 #/chat', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')
  await loginAsAlice()

  const sidebar = screen.getByTestId('sidebar')
  const labels = Array.from(sidebar.querySelectorAll('[data-slot="sidebar-menu"] button')).map((b) =>
    b.textContent?.trim(),
  )
  expect(labels.indexOf('聊天')).toBe(labels.indexOf('指令') + 1)

  fireEvent.click(within(sidebar).getByRole('button', { name: '聊天' }))
  expect(await screen.findByTestId('chat-workspace')).toBeTruthy()
  expect(screen.getByPlaceholderText('发消息给游戏内的玩家（会显示你是谁）')).toBeTruthy()
  expect(window.location.hash).toBe('#/chat')
})

it('旧的「召唤NPC」地址回落到「指令小抄」', async () => {
  mockFetch()
  window.history.replaceState(null, '', '#/spawn')
  render(<App transport={new MockTransport()} />)
  expect(await screen.findByPlaceholderText('搜索指令或名称')).toBeTruthy()
  await waitFor(() => expect(window.location.hash).toBe('#/commands'))
})

it('「世界存档」是独立侧边栏菜单：未登录也能用，排在「世界管理」之前', async () => {
  mockFetch()
  localStorage.setItem('tswui:modules', JSON.stringify({ byServer: { default: ['world'] } }))
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // 侧栏顺序：世界存档（公开工具）在世界管理（WorldModify 模块）之前。
  const sidebar = screen.getByTestId('sidebar')
  const labels = Array.from(sidebar.querySelectorAll('[data-slot="sidebar-menu"] button')).map((b) =>
    b.textContent?.trim(),
  )
  expect(labels.indexOf('世界存档')).toBeGreaterThan(-1)
  expect(labels.indexOf('世界存档')).toBeLessThan(labels.indexOf('世界管理'))

  // 点进去：不需要登录，直接是本地导入界面。
  fireEvent.click(screen.getAllByRole('button', { name: '世界存档' })[0])
  expect(await screen.findByTestId('world-drop')).toBeTruthy()
  expect(window.location.hash).toBe('#/wld')
  expect(screen.queryByText('请先登录！')).toBeNull()
})

it('「精灵图」是独立侧边栏菜单：未登录也能用，地址 #/slice', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  fireEvent.click(screen.getAllByRole('button', { name: '精灵图' })[0])
  expect(await screen.findByTestId('slice-drop')).toBeTruthy()
  expect(window.location.hash).toBe('#/slice')
  expect(screen.getByText('还没有选择精灵图')).toBeTruthy()
  expect(screen.queryByText('请先登录！')).toBeNull()
})
