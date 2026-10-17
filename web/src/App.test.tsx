import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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

it('未登录时首页 / 指令 / 设置只显示登录提示与登录按钮', async () => {
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

  // 设置页：隐藏设置内容，同样只显示登录提示。
  fireEvent.click(screen.getAllByRole('button', { name: '设置' })[0])
  expect(await screen.findByText('请先登录！')).toBeTruthy()
  expect(screen.queryByRole('switch', { name: '紧凑视图' })).toBeNull()

  // 提示里的登录按钮能打开登录框（侧栏还有一条登录按钮，这里限定正文）。
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '登录' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(document.body, { key: 'Escape' })
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
  const { container } = render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')

  // 默认深色。
  expect(container.querySelector('.dark')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /主题：深色/ }))
  // 下一个状态是「自动」；jsdom 无系统深色 → 变浅色。
  await waitFor(() => expect(container.querySelector('.dark')).toBeNull())
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

  const menu = screen.getByTestId('sidebar').querySelector('[data-slot="sidebar-menu"]')
  expect(menu).toBeTruthy()
  const labels = Array.from(menu!.querySelectorAll('button')).map((b) => b.textContent?.trim())
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

it('侧栏可隐藏并可重新显示', async () => {
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
  fireEvent.mouseDown(await screen.findByRole('tab', { name: '收藏' }))
  expect(await screen.findByPlaceholderText(/搜索收藏/)).toBeTruthy()
})

it('历史并入指令编辑器（侧栏「历史」页）', async () => {
  mockFetch()
  render(<App transport={new MockTransport()} />)
  await screen.findByText('WebUI')
  await loginAsAlice()

  // 默认打开首页，先切到指令页
  fireEvent.click(screen.getAllByRole('button', { name: '指令' })[0])
  fireEvent.mouseDown(await screen.findByRole('tab', { name: '历史' }))
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
