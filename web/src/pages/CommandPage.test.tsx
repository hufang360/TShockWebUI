import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { consumeEditorFocus, requestEditorFocus } from '@/lib/editorFocus'
import type { BackendTransport } from '@/lib/tshock'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { CommandResult, Settings } from '@/types'
import { CommandPage } from './CommandPage'

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

function fakeTransport(runCommand: (cmd: string) => Promise<CommandResult>): BackendTransport {
  return {
    mock: false,
    label: 'test',
    session: async () => ({ authenticated: true, username: 'Alice' }),
    login: async () => ({ username: 'Alice' }),    loginWithToken: async () => ({ username: 'Alice' }),
    logout: async () => {},
    serverStatus: async () => ({ reachable: true }),
    servers: async () => ({
      allowCustom: true,
      default: { scheme: 'http', host: '127.0.0.1', port: 7878 },
    }),
    playersList: async () => [],
    runCommand,
    ...playerStubs,
  }
}

function renderEditor(
  transport: BackendTransport,
  onTokenInvalid: () => Promise<boolean>,
  authenticated = true,
  onLogin: () => void = vi.fn(),
) {
  return render(
    <I18nProvider lang="zh">
      {/* 整页滚动：滚动宿主就是 AppShell 的 `<main>`（结果区自己不再溢出滚动）。 */}
      <main data-testid="page-scroll-host">
        <CommandPage
          dataset={makeDataset()}
          transport={transport}
          authenticated={authenticated}
          settings={settings}
          serverId="default"
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={onTokenInvalid}
          onLogin={onLogin}
        />
      </main>
    </I18nProvider>,
  )
}

/** 输入框左下角的工具按钮组（弹框由这四个按钮打开）。 */
const toolsGroup = () => screen.getByRole('group', { name: '工具面板' })

/** 输入区外壳（模块级版本：`openTools` 在 describe 外面，用不到里面那个 `composer()`）。 */
function composerEl() {
  return (screen.getByPlaceholderText(/输入指令/) as HTMLElement).closest(
    '[data-slot=composer]',
  ) as HTMLElement
}

/** 点对应的工具按钮：打开弹框并切到该面板（指令库 / 物品在左下角，收藏 / 历史在发送键旁）。 */
function openTools(name: '指令库' | '物品' | '收藏' | '历史') {
  fireEvent.click(within(composerEl()).getByRole('button', { name }))
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CommandPage 未登录', () => {
  it('隐藏编辑器，显示登录提示与登录按钮', () => {
    const onLogin = vi.fn()
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true), false, onLogin)

    expect(screen.getByText('请先登录！')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })

  it('登录后重新量高，左卡片撑满（回归：登录后高度变窄）', () => {
    const transport = fakeTransport(vi.fn())
    const page = (authenticated: boolean) => (
      <I18nProvider lang="zh">
        <main>
          <CommandPage
            dataset={makeDataset()}
            transport={transport}
            authenticated={authenticated}
            settings={settings}
            serverId="default"
            players={[]}
            ingameAllowed={false}
            onTokenInvalid={vi.fn().mockResolvedValue(true)}
            onLogin={vi.fn()}
          />
        </main>
      </I18nProvider>
    )

    const { rerender } = render(page(false))
    // 未登录：顶部 tab 仍在（可以看「小抄」），指令 tab 里是登录提示。
    expect(screen.getByTestId('command-workspace')).toBeTruthy()
    expect(screen.getByText('请先登录！')).toBeTruthy()

    rerender(page(true))
    // 登录后重新量高：整页滚动，一屏高只当 **最小高度**（内容多了照样往下长）。
    expect(screen.getByTestId('command-workspace').style.minHeight).not.toBe('')
  })
})

describe('CommandPage 输入模式', () => {
  it('空态不描边、引导块居中；工具弹框里不再有 tab 栏', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    // tab 栏已去掉：面板由输入框左下角的四个按钮切换。
    expect(screen.queryAllByRole('tab')).toHaveLength(0)

    // 空态不再是一整块虚线占位：工作区就是画布，引导块居中，输入框在底部。
    const empty = screen.getByText('开始一条指令').closest('[data-slot="empty"]')
    expect(empty?.className).not.toContain('border-dashed')
    expect(empty?.parentElement?.className).toContain('justify-center')
  })

})

describe('CommandPage 补全里的指令用法', () => {
  it('用法是输入框里的半透明幽灵文字，候选行只说说明（不重复）', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const editor = () => screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    const ghost = () => document.querySelector('[data-slot="command-ghost"]') as HTMLElement | null

    fireEvent.change(editor(), { target: { value: '/time' } })
    const option = await screen.findByRole('option', { name: /\/time/ })
    expect(option.textContent).toContain('设置世界时间。')
    expect(option.textContent).not.toContain('<day|night')
    // 幽灵文字只补「当前词」：`/time` 已经完整，补的是它自带的那一个空格。
    expect(ghost()?.textContent).toBe('/time ')
    // 完整用法在下拉框顶部那条提示里（与幽灵文字互补，不是同一句）。
    expect(screen.getByRole('note').textContent).toContain('/time <day|night|noon|midnight|hh:mm>')

    // 进参数区（当前参数还空着）：幽灵补出这一位该填什么（后面还带着这一位的备注），顶部仍是完整用法。
    fireEvent.change(editor(), { target: { value: '/time ' } })
    expect(ghost()?.textContent).toContain('/time <day|night|noon|midnight|hh:mm>')
    expect(screen.getByRole('note').textContent).toContain('/time <day|night|noon|midnight|hh:mm>')
  })

  it('没有候选时按下 ↓ 不会清空草稿（用法以幽灵文字补在输入框里）', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([{ cmd: '/time day', ts: 1, ok: true, status: 'ok' }]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const editor = () => screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement

    // `/give 29 Alice ` 的下一位是数量（number），本地没有候选 → 不弹浮层，改成上方单行提示。
    fireEvent.change(editor(), { target: { value: '/give 29 Alice ' } })
    await waitFor(() =>
      expect(document.querySelector('[data-slot="command-ghost"]')?.textContent).toContain(
        '[item amount]',
      ),
    )
    expect(screen.queryByRole('listbox')).toBeNull()

    // ↓ 不把草稿清掉（回翻到「未在选择」时还原草稿）。
    fireEvent.keyDown(editor(), { key: 'ArrowDown' })
    expect(editor().value).toBe('/give 29 Alice ')
  })
})

describe('CommandPage 工具弹框', () => {
  it('左下角是「指令库 / 物品」，收藏 / 历史在发送键旁边', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    expect(
      within(toolsGroup())
        .getAllByRole('button')
        .map((el) => el.getAttribute('aria-label')),
    ).toEqual(['指令库', '物品'])

    const card = composerEl()
    const send = within(card).getByRole('button', { name: '执行' })
    const trailing = send.parentElement as HTMLElement
    expect(
      within(trailing)
        .getAllByRole('button')
        .map((el) => el.getAttribute('aria-label')),
    ).toEqual(['收藏', '历史', '执行'])
  })

  it('工具是弹框：没有 tab 栏，打开后焦点落在当前面板的搜索框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryAllByRole('tab')).toHaveLength(0)
    // 打开即聚焦当前面板的搜索框：不用先点一下就能打字筛选。
    expect(document.activeElement).toBe(within(dialog).getByPlaceholderText(/搜索指令/))
  })

  it('点另一个工具按钮直接换面板，焦点跟着落到新面板的搜索框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')

    openTools('物品')
    expect(
      within(dialog).getByPlaceholderText('搜索物品（ID / 名称）'),
    ).toBeTruthy()
    expect(document.activeElement).toBe(
      within(dialog).getByPlaceholderText('搜索物品（ID / 名称）'),
    )
  })

  it('指令库 tab：列出全部指令，点一条填进输入框并收起弹框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    fireEvent.click(await screen.findByText('/help'))
    expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe('/help ')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Esc 关闭弹框后焦点回到指令输入框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/输入指令/))
  })

  it('空态只有图标 + 标题 + 一行说明：不再摆「打开指令库」按钮与「最近执行」小标签', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([{ cmd: '/time', ts: 1, ok: true, status: 'ok' }]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    // 标题 + 说明留着（说明里提到左下角的入口）。
    expect(screen.getByText('开始一条指令')).toBeTruthy()
    expect(screen.getByText(/左下角的按钮里有指令库/)).toBeTruthy()
    // 引导用的按钮 / 历史标签都不在了。
    expect(screen.queryByRole('button', { name: /打开指令库/ })).toBeNull()
    expect(screen.queryByText('最近执行')).toBeNull()
  })
})

describe('CommandPage 输入框（聊天式外壳）', () => {
  /** 输入框所在的那张卡片（rounded-container 外壳）。 */
  const composer = () =>
    (screen.getByPlaceholderText(/输入指令/) as HTMLElement).closest('[data-slot=composer]') as HTMLElement

  it('工具按钮在左下角、发送键在右下角', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const card = composer()
    const tools = within(card).getByRole('group', { name: '工具面板' })
    const send = within(card).getByRole('button', { name: '执行' })
    const group = tools.parentElement as HTMLElement

    // 顺序：工具按钮组在前，右侧（发送）在后且靠右。
    expect(group.firstElementChild).toBe(tools)
    expect(group.lastElementChild?.className).toContain('ml-auto')
    expect(within(group.lastElementChild as HTMLElement).getByRole('button', { name: '执行' })).toBe(
      send,
    )
    // 左下角只有「指令库 / 物品」；收藏 / 历史跟着发送键在右侧。
    expect(
      within(tools)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['指令库', '物品'])
  })

  it('从首页「最近执行」进来：草稿已填好，输入框直接拿到焦点、光标在末尾', () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/judge unfreeze axing'))
    requestEditorFocus()
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    const ta = screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    expect(ta.value).toBe('/judge unfreeze axing')
    expect(document.activeElement).toBe(ta)
    expect(ta.selectionStart).toBe(ta.value.length)
    // 信号是一次性的：消费完就清掉，下次普通导航不再抢焦点。
    expect(consumeEditorFocus()).toBe(false)
  })

  it('聚焦是外发光（不是硬描边），外壳更紧凑', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const card = composer()
    // 发光画在边框外面（ring），不再用 `outline` 硬描边。
    expect(card.className).toContain('focus-within:ring-[3px]')
    expect(card.className).not.toContain('outline-2')
    // 缩小后的输入行 / 发送键尺寸。
    expect((card.querySelector('textarea') as HTMLElement).className).toContain('h-8')
    expect(within(card).getByRole('button', { name: '执行' }).className).toContain('size-8')
  })

  it('工具按钮悬停 / 聚焦出 Tooltip；面板是贴在按钮上的 popover（无遮罩）', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const commands = within(composer()).getByRole('button', { name: '指令库' })
    // jsdom 不做布局：给按钮一个固定的位置，验证面板的锚点确实跟着按钮走。
    commands.getBoundingClientRect = () =>
      ({ left: 120, top: 700, width: 28, height: 28 }) as DOMRect

    fireEvent.focus(commands)
    const tip = await screen.findByRole('tooltip', {}, { timeout: 2000 })
    expect(tip.textContent).toContain('指令库')

    fireEvent.click(commands)
    const dialog = await screen.findByRole('dialog')
    // popover 而不是居中弹框：没有遮罩层，页面照常可访问。
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
    expect(dialog.getAttribute('data-slot')).toBe('popover-content')
    expect(dialog.getAttribute('aria-modal')).not.toBe('true')
    // 锚点就是刚点的那个按钮（面板贴着它向上展开）。
    const anchor = document.querySelector('[data-slot="tools-anchor"]') as HTMLElement
    expect(anchor.style.left).toBe('120px')
    expect(anchor.style.top).toBe('700px')
  })

  it('点工具按钮打开对应 tab 的弹框；再点一次收起', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    // 收藏按钮在发送键旁边（不在左下角那个组里）。
    const favorites = within(composer()).getByRole('button', { name: '收藏' })

    fireEvent.click(favorites)
    expect(favorites.getAttribute('aria-pressed')).toBe('true')
    await screen.findByRole('dialog')
    // 弹框里就是「收藏」面板（没有 tab 栏）。

    fireEvent.click(favorites)
    expect(favorites.getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

})

describe('CommandPage 结果区跟随最新一条', () => {
  it('新结果返回后自动滚到最底（滚动宿主是页面的 `<main>`）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time day'))
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['已设置为白天'] })
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(await screen.findByText('已设置为白天')).toBeTruthy()

    // jsdom 不做布局：手动给滚动宿主一个可滚高度，再发一条看是否贴底。
    const scroller = screen.getByTestId('page-scroll-host')
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true })

    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1))

    // 执行后会清空输入，再敲一条。
    fireEvent.change(screen.getByPlaceholderText(/输入指令/), { target: { value: '/time day' } })
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(scroller.scrollTop).toBe(1000))
  })
})

describe('CommandPage 结果操作', () => {
  it('清空结果在顶栏最右侧：垃圾桶图标，点两次才真的清空', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' })
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    // 没有结果时这个按钮不出现。
    expect(screen.queryByRole('button', { name: '清空结果' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(await screen.findByText('已把时间设置为 12:00')).toBeTruthy()

    const clear = screen.getByRole('button', { name: '清空结果' })
    expect(clear.querySelector('.lucide-trash-2')).toBeTruthy()
    // 与「展开全部 / 折叠全部」同排（页面级动作都在顶栏右侧），且排在它们后面。
    const row = clear.parentElement as HTMLElement
    const collapse = row.querySelector('[aria-label="折叠全部"]') as HTMLElement
    expect(collapse).toBeTruthy()
    expect(
      collapse.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // 不再跟着发送键（输入框工具行里没有它）。
    const send = screen.getByRole('button', { name: '执行' })
    expect(send.parentElement?.contains(clear)).toBe(false)

    fireEvent.click(clear)
    // 首次点击只展开二次确认，不直接清空。
    expect(screen.getByText('已把时间设置为 12:00')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }))
    await waitFor(() => expect(screen.queryByText('已把时间设置为 12:00')).toBeNull())
  })

  it('结果卡片右上角「填充指令」把指令填回输入框（不执行）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: ['上午 8:30'], message: '' })
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(await screen.findByText('上午 8:30')).toBeTruthy()

    // 执行后输入框已清空；点「填充指令」原样填回，且不再执行一次。
    fireEvent.click(screen.getByRole('button', { name: '填充指令' }))
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe('/time'),
    )
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('结果卡片可折叠，状态随结果存本机（重新挂载后仍是折叠的）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: ['上午 8:30'], message: '' })
    const first = renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(await screen.findByText('上午 8:30')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '折叠' }))
    await waitFor(() => expect(screen.queryByText('上午 8:30')).toBeNull())
    expect(screen.getByRole('button', { name: '展开' })).toBeTruthy()

    const stored = JSON.parse(localStorage.getItem('tswui:commandResults') ?? '{}') as Record<
      string,
      { collapsed?: boolean }[]
    >
    expect(stored.default?.[0]?.collapsed).toBe(true)
    first.unmount()

    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    expect(await screen.findByRole('button', { name: '展开' })).toBeTruthy()
    expect(screen.queryByText('上午 8:30')).toBeNull()
  })

  it('顶栏「展开全部 / 折叠全部」一次收起或展开所有结果', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: ['上午 8:30'], message: '' })
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))

    // 没有结果时这两个入口整个不渲染。
    expect(screen.queryByRole('button', { name: '展开全部' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    expect(await screen.findByText('上午 8:30')).toBeTruthy()

    // 都展开着：「展开全部」不可点。
    const expandAll = screen.getByRole('button', { name: '展开全部' })
    const collapseAll = screen.getByRole('button', { name: '折叠全部' })
    expect(expandAll).toHaveProperty('disabled', true)
    expect(collapseAll).toHaveProperty('disabled', false)

    fireEvent.click(collapseAll)
    await waitFor(() => expect(screen.queryByText('上午 8:30')).toBeNull())
    expect(screen.getByRole('button', { name: '折叠全部' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    expect(await screen.findByText('上午 8:30')).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开全部' })).toHaveProperty('disabled', true)
  })
})

describe('CommandPage token 失效处理', () => {
  it('token_invalid 时请求重新登录，登录成功后自动重试一次', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ status: 'token_invalid', output: [], message: '登录已失效' })
      .mockResolvedValueOnce({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' })
    const onTokenInvalid = vi.fn().mockResolvedValue(true)

    renderEditor(fakeTransport(runCommand), onTokenInvalid)
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2))
    expect(onTokenInvalid).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('已把时间设置为 12:00')).toBeTruthy()
  })

  it('取消登录则只执行一次、不重试', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'token_invalid', output: [], message: '登录已失效' })
    const onTokenInvalid = vi.fn().mockResolvedValue(false)

    renderEditor(fakeTransport(runCommand), onTokenInvalid)
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(onTokenInvalid).toHaveBeenCalledTimes(1))
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('allowServer=false 的指令前端直接拒绝，不发请求', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/i 29'))
    const runCommand = vi.fn()
    const onTokenInvalid = vi.fn().mockResolvedValue(true)

    renderEditor(fakeTransport(runCommand), onTokenInvalid)
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(screen.getAllByText(/只能在游戏内执行/).length).toBeGreaterThan(0))
    expect(runCommand).not.toHaveBeenCalled()
  })
})

describe('CommandPage 物品面板', () => {
  it('选中物品后「前往物品 ID」回传物品 id', async () => {
    const onOpenInDex = vi.fn()
    render(
      <I18nProvider lang="zh">
        <CommandPage
          dataset={makeDataset()}
          transport={fakeTransport(vi.fn())}
          authenticated
          settings={settings}
          serverId="default"
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
          onLogin={vi.fn()}
          onOpenInDex={onOpenInDex}
        />
      </I18nProvider>,
    )
    openTools('物品')
    const input = await screen.findByPlaceholderText('搜索物品（ID / 名称）')
    fireEvent.change(input, { target: { value: '生命' } })
    fireEvent.click(await screen.findByRole('button', { name: /生命水晶/ }))
    fireEvent.click(screen.getByRole('button', { name: /前往 物品 ID/ }))
    expect(onOpenInDex).toHaveBeenCalledWith(29)
  })

  it('键盘上下键移动时高亮结果行', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    const input = await screen.findByPlaceholderText('搜索物品（ID / 名称）')
    fireEvent.change(input, { target: { value: '生命' } })
    const row = await screen.findByRole('button', { name: /生命水晶/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row)
    expect(row.className).toContain('bg-accent')
  })
})

describe('CommandPage 物品收藏', () => {
  it('结果富文本里的物品图标：悬停提示右上角带 ⭐，点击可收藏 / 取消收藏', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/give'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: ['[i:29] 已给出'], message: '' })
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))

    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    const icon = await screen.findByRole('img', { name: '生命水晶' })
    fireEvent.mouseOver(icon)
    const tip = await screen.findByRole('tooltip')

    fireEvent.click(within(tip).getByRole('button', { name: '收藏物品' }))
    expect(
      JSON.parse(localStorage.getItem('tswui:itemFavorites') ?? '[]').map(
        (f: { id: number }) => f.id,
      ),
    ).toEqual([29])

    // 提示不关：同一个 ⭐ 变成「取消收藏」，再点一次就移出收藏。
    fireEvent.click(within(tip).getByRole('button', { name: '取消收藏' }))
    expect(JSON.parse(localStorage.getItem('tswui:itemFavorites') ?? '[]')).toEqual([])
  })

  it('物品 tab 默认展示收藏物品，点击只追加 ID（收藏保留）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/give'))
    localStorage.setItem('tswui:itemFavorites', JSON.stringify([{ id: 29, ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    // 物品 tab：搜索为空时展示收藏物品。
    openTools('物品')
    fireEvent.click(await screen.findByRole('button', { name: /生命水晶/ }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('/give 29 '),
    )
    // 收藏记录不动：同一件东西常常要发好几次。
    expect(JSON.parse(localStorage.getItem('tswui:itemFavorites') ?? '[]')).toEqual([
      { id: 29, ts: 1 },
    ])
  })

  it('收藏 tab 只显示指令收藏（物品收藏在「物品」tab、合成记录收藏在物品图鉴 / 聊天）', async () => {
    localStorage.setItem('tswui:itemFavorites', JSON.stringify([{ id: 29, ts: 1 }]))
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('收藏')
    expect(await screen.findByText('/time 12:00')).toBeTruthy()
    expect(screen.getByText('指令（1）')).toBeTruthy()
    // 没有分类按钮：收藏面板就只有指令收藏。
    expect(screen.queryByTestId('favorites-kind-items')).toBeNull()
    expect(screen.queryByTestId('favorites-kind-recipes')).toBeNull()
    expect(screen.queryByText('生命水晶')).toBeNull()
  })

  it('收藏 tab 搜索过滤指令收藏', async () => {
    localStorage.setItem(
      'tswui:favorites',
      JSON.stringify([{ cmd: '/time 12:00', ts: 1 }, { cmd: '/give 29 Alice', ts: 2 }]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('收藏')
    expect(await screen.findByText('/time 12:00')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('搜索收藏指令（指令名 / 参数）'), {
      target: { value: 'give' },
    })
    expect(screen.getByText('/give 29 Alice')).toBeTruthy()
    expect(screen.queryByText('/time 12:00')).toBeNull()
  })

  it('清空收藏清空指令收藏', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('收藏')
    // 清空需要二次确认：先点「清空」，再点「确认清空」。
    fireEvent.click(await screen.findByRole('button', { name: '清空' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:favorites') ?? '[]')).toEqual([]),
    )
    expect(await screen.findByText('还没有收藏任何指令')).toBeTruthy()
  })

  it('点击收藏指令替换输入框内容（不执行）', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    const runCommand = vi.fn()
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))

    openTools('收藏')
    fireEvent.click(await screen.findByRole('button', { name: '/time 12:00' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('/time 12:00'),
    )
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('批量删除指令收藏', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('收藏')
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '/time 12:00' }))
    fireEvent.click(screen.getByRole('button', { name: '删除（1）' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:favorites') ?? '[]')).toEqual([]),
    )
  })
})

describe('CommandPage 执行后清空输入框', () => {
  it('发送成功后输入框清空（结果仍在结果区）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const runCommand = vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' })

    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await screen.findByText('已把时间设置为 12:00')
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe(''),
    )
  })

  it('前端拦下的指令不清空（保留原文便于修改重发）', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/i 29'))
    const runCommand = vi.fn()

    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))

    await waitFor(() => expect(screen.getAllByText(/只能在游戏内执行/).length).toBeGreaterThan(0))
    expect((screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement).value).toBe('/i 29')
  })
})

describe('CommandPage 历史', () => {
  it('批量删除：进入删除状态后可多选删除', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
        { cmd: '/time 13:00', ts: 2, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('历史')
    // 工具弹框不是模态的（背景不变暗、照常可访问），断言都限定在弹框里。
    const dialog = await screen.findByRole('dialog')
    // 默认逐行不显示删除图标，只有一个「删除」入口。
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /\/time 12:00/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: /\/time 13:00/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除（2）' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toEqual([]),
    )
    expect(await screen.findByText('暂无历史')).toBeTruthy()
  })

  it('清空历史需要二次确认', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([{ cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' }]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('历史')
    fireEvent.click(await screen.findByRole('button', { name: '清空历史' }))
    // 首次点击只展开确认，不直接清空。
    expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toHaveLength(1)

    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toEqual([]),
    )
    expect(await screen.findByText('暂无历史')).toBeTruthy()
  })

  it('历史搜索按指令文本过滤', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
        { cmd: '/give 29 Alice', ts: 2, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('历史')
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('搜索历史指令'), {
      target: { value: 'give' },
    })
    // 只断言弹框里的列表：空态背后的「最近执行」芯片也会出现同样的指令文本。
    expect(within(dialog).getByText('/give 29 Alice')).toBeTruthy()
    expect(within(dialog).queryByText('/time 12:00')).toBeNull()
  })

  it('去重保留最新、删除较旧的重复记录', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 3, ok: true, status: 'ok' },
        { cmd: '/give 29 Alice', ts: 2, ok: true, status: 'ok' },
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openTools('历史')
    fireEvent.click(await screen.findByRole('button', { name: '去重' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认去重' }))

    await waitFor(() => {
      const after = JSON.parse(localStorage.getItem('tswui:history') ?? '[]') as Array<{
        cmd: string
      }>
      expect(after).toHaveLength(2)
      expect(after.map((h) => h.cmd)).toEqual(['/time 12:00', '/give 29 Alice'])
    })
  })
})

describe('CommandPage 结果持久化', () => {
  it('执行结果存本机（按服务器），重新挂载后仍在', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const transport = fakeTransport(
      vi.fn().mockResolvedValue({ status: 'ok', output: ['已把时间设置为 12:00'], message: '' }),
    )
    const page = () => (
      <I18nProvider lang="zh">
        <CommandPage
          dataset={makeDataset()}
          transport={transport}
          authenticated
          settings={settings}
          serverId="default"
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
          onLogin={vi.fn()}
        />
      </I18nProvider>
    )

    const first = render(page())
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await screen.findByText('已把时间设置为 12:00')
    const stored = JSON.parse(localStorage.getItem('tswui:commandResults') ?? '{}') as Record<
      string,
      unknown[]
    >
    expect(stored.default).toHaveLength(1)
    first.unmount()

    render(page())
    expect(await screen.findByText('已把时间设置为 12:00')).toBeTruthy()
  })

  it('结果按服务器分开：切换服务器看不到另一台的结果', async () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    const transport = fakeTransport(
      vi.fn().mockResolvedValue({ status: 'ok', output: ['服务器 A 的输出'], message: '' }),
    )
    const page = (serverId: string) => (
      <I18nProvider lang="zh">
        <CommandPage
          dataset={makeDataset()}
          transport={transport}
          authenticated
          settings={settings}
          serverId={serverId}
          players={[]}
          ingameAllowed={false}
          onTokenInvalid={vi.fn().mockResolvedValue(true)}
          onLogin={vi.fn()}
        />
      </I18nProvider>
    )

    const first = render(page('server-a'))
    fireEvent.click(screen.getByRole('button', { name: '执行' }))
    await screen.findByText('服务器 A 的输出')
    first.unmount()

    // 换到另一台服务器：不应看到 A 的结果。
    const second = render(page('server-b'))
    expect(screen.queryByText('服务器 A 的输出')).toBeNull()
    second.unmount()

    // 切回 A：结果仍在。
    render(page('server-a'))
    expect(await screen.findByText('服务器 A 的输出')).toBeTruthy()
  })
})


describe('CommandPage `/` 快捷键', () => {
  const editor = () => screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement

  it('不在输入框时敲 `/` 聚焦输入框；空草稿顺手补一个 `/` 并弹出补全', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    ;(document.activeElement as HTMLElement | null)?.blur()

    fireEvent.keyDown(document.body, { key: '/' })

    expect(document.activeElement).toBe(editor())
    expect(editor().value).toBe('/')
    // 补一个 `/` 的意义：补全下拉直接列出全部指令，接着敲就是筛选。
    expect(await screen.findByRole('listbox')).toBeTruthy()
  })

  it('草稿非空时只聚焦、不覆盖内容', () => {
    localStorage.setItem('tswui:draft', JSON.stringify('/time'))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    ;(document.activeElement as HTMLElement | null)?.blur()

    fireEvent.keyDown(document.body, { key: '/' })

    expect(document.activeElement).toBe(editor())
    expect(editor().value).toBe('/time')
  })

  it('弹框开着时不抢焦点（`/` 留给弹框里的搜索框）', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    const dialog = await screen.findByRole('dialog')
    expect(document.activeElement).toBe(
      within(dialog).getByPlaceholderText('搜索物品（ID / 名称）'),
    )

    fireEvent.keyDown(dialog, { key: '/' })

    expect(document.activeElement).not.toBe(editor())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(editor().value).toBe('')
  })
})
