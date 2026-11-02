import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { consumeEditorFocus, requestEditorFocus } from '@/lib/editorFocus'
import type { BackendTransport } from '@/lib/tshock'
import { makeDataset, testCommands } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { CommandResult, Dataset, Settings } from '@/types'
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
  dataset: Dataset = makeDataset(),
) {
  return render(
    <I18nProvider lang="zh">
      {/* 整页滚动：滚动宿主就是 AppShell 的 `<main>`（结果区自己不再溢出滚动）。 */}
      <main data-testid="page-scroll-host">
        <CommandPage
          dataset={dataset}
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

/** 输入框左下角只有两个入口：指令库（内含指令库 / 收藏 / 历史）与物品（内含物品 / 合成表）。 */
function openTools(name: '指令库' | '物品') {
  fireEvent.click(within(composerEl()).getByRole('button', { name }))
}

/** 打开入口后，切到弹框**底部**的 tab（Radix 的 tab 靠 mousedown 激活；tab 现在是图标 + aria-label）。 */
function switchTab(name: '指令库' | '物品' | '收藏' | '历史' | '合成表') {
  fireEvent.mouseDown(screen.getByRole('tab', { name }))
}

/** tab 的可访问名（图标 tab 的 textContent 是空的）。 */
const tabNames = (root: HTMLElement = document.body) =>
  within(root)
    .getAllByRole('tab')
    .map((el) => el.getAttribute('aria-label'))

/**
 * 打开「指令库 / 收藏 / 历史」里的某一页。
 *
 * 弹框会**记忆上次的 tab**（`tswui:toolsMemory`），所以这里一律显式切一次，
 * 不依赖「默认停在第一个 tab」——那样同一个文件里前面的用例会影响到后面的。
 */
function openCommandTab(name: '指令库' | '收藏' | '历史') {
  openTools('指令库')
  switchTab(name)
}

beforeEach(() => {
  // 工具弹框会**记忆**上次的 tab / 搜索词 / 滚动位置（`tswui:toolsMemory`）：
  // 不清掉的话，前面的用例搜过的词会带到后面的用例里（列表被过滤空，看着像「条目不见了」）。
  localStorage.removeItem('tswui:toolsMemory')
})

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
  it('空态不描边、引导块居中；物品弹框底部有「物品 / 合成表」tab', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    // 两个入口各自带一组 tab，tab 在弹框底部；tab 用图标，名字走 aria-label。
    expect(tabNames()).toEqual(['物品', '合成表'])

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

  it('幽灵文字与已输入内容之间留一个空格（`/accountinfo h` 不粘成 `h<username>`）', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const editor = () => screen.getByPlaceholderText(/输入指令/) as HTMLTextAreaElement
    const ghost = () => document.querySelector('[data-slot="command-ghost"]') as HTMLElement | null

    // 数量参数已经敲了半截（本地没有候选）→ 提示「下一个参数长什么样」。
    fireEvent.change(editor(), { target: { value: '/give 29 Alice 1' } })
    await waitFor(() => expect(ghost()?.textContent).toContain('[item amount]'))
    // 完整串是「已输入 + 空格 + 占位符」，不是 `1[item amount]`。
    expect(ghost()?.textContent).toBe('/give 29 Alice 1 [item amount] ')
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
  it('左下角只有「指令库 / 物品」两个入口，发送键旁边没有别的按钮', () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    expect(
      within(toolsGroup())
        .getAllByRole('button')
        .map((el) => el.getAttribute('aria-label')),
    ).toEqual(['指令库', '物品'])

    const card = composerEl()
    const send = within(card).getByRole('button', { name: '执行' })
    // 收藏 / 历史 / 合成表都搬进弹框的 tab 了：发送键旁边只剩它自己。
    expect(within(send.parentElement as HTMLElement).getAllByRole('button')).toHaveLength(1)
  })

  it('工具是弹框：tab 在底部，打开后焦点落在当前面板的搜索框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')

    const dialog = await screen.findByRole('dialog')
    expect(tabNames(dialog)).toEqual(['指令库', '收藏', '历史'])
    // tab 栏排在内容之后（在弹框底部）。
    const search = within(dialog).getByPlaceholderText('搜索指令（名称 / 别名 / 帮助）')
    expect(
      search.compareDocumentPosition(within(dialog).getByRole('tablist')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // 打开即聚焦当前面板的搜索框：不用先点一下就能打字筛选。
    expect(document.activeElement).toBe(within(dialog).getByPlaceholderText(/搜索指令/))
  })

  it('点另一个入口直接换入口，焦点跟着落到新面板的搜索框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')

    openTools('物品')
    expect(within(dialog).getByPlaceholderText('搜索物品（ID / 名称）')).toBeTruthy()
    // 换入口后焦点交回新面板的搜索框（Radix 的关闭 / 重开有一拍延迟）。
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByPlaceholderText('搜索物品（ID / 名称）'),
      ),
    )
  })

  it('指令库 tab：列出全部指令，点一条填进输入框并收起弹框', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    // 页脚「常用指令」徽标里也有一个 /help，这里点列表里的那一条。
    const list = await screen.findByRole('listbox', { name: '' }).catch(() => null)
    fireEvent.click(within(list ?? screen.getByRole('dialog')).getAllByText('/help')[0])
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
    // 缩小后的输入行；发送键走 `icon` 档（手机 40 / 桌面 36），不再手写 size-*。
    expect((card.querySelector('textarea') as HTMLElement).className).toContain('h-8')
    const send = within(card).getByRole('button', { name: '执行' }).className
    expect(send).toContain('size-10 md:size-9')
    expect(send).not.toMatch(/\bsize-[678]\b/)
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

  it('点入口按钮打开弹框；再点一次收起', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    const commands = within(composer()).getByRole('button', { name: '指令库' })

    fireEvent.click(commands)
    expect(commands.getAttribute('aria-pressed')).toBe('true')
    const dialog = await screen.findByRole('dialog')
    // 默认停在该入口的第一个 tab。
    expect(within(dialog).getByRole('tab', { name: '指令库' }).getAttribute('data-state')).toBe(
      'active',
    )

    fireEvent.click(commands)
    expect(commands.getAttribute('aria-pressed')).toBe('false')
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

    openCommandTab('收藏')
    expect(await screen.findByText('/time 12:00')).toBeTruthy()
    // 没有分类按钮：收藏面板就只有指令收藏（物品收藏在「物品」入口、合成记录在「合成表」tab）。
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

    openCommandTab('收藏')
    expect(await screen.findByText('/time 12:00')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('搜索收藏指令（指令名 / 参数）'), {
      target: { value: 'give' },
    })
    expect(screen.getByText('/give 29 Alice')).toBeTruthy()
    expect(screen.queryByText('/time 12:00')).toBeNull()
  })

  it('收藏面板没有「清空」「删除」按钮：取消收藏只在行内星标', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openCommandTab('收藏')
    expect(await screen.findByText('/time 12:00')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()

    // 行内星标取消收藏。
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:favorites') ?? '[]')).toEqual([]),
    )
    expect(await screen.findByText('还没有收藏任何指令')).toBeTruthy()
  })

  it('点击收藏指令替换输入框内容（不执行）', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    const runCommand = vi.fn()
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))

    openCommandTab('收藏')
    fireEvent.click(await screen.findByRole('button', { name: '/time 12:00' }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('/time 12:00'),
    )
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('收藏行悬停才出行内星标，没有批量删除模式', async () => {
    localStorage.setItem('tswui:favorites', JSON.stringify([{ cmd: '/time 12:00', ts: 1 }]))
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openCommandTab('收藏')
    const row = await screen.findByRole('button', { name: '/time 12:00' })
    // 每行只有「载入」与「取消收藏」两个按钮，没有多选 / 删除（1）。
    const item = row.closest('li') as HTMLElement
    expect(within(item).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      null,
      '取消收藏',
    ])
    expect(screen.queryByRole('button', { name: /删除（/ })).toBeNull()
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
  it('逐条删除：悬停行尾出 ✕；底部垃圾桶清空全部（没有批量模式）', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
        { cmd: '/time 13:00', ts: 2, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openCommandTab('历史')
    const dialog = await screen.findByRole('dialog')
    // 没有「删除」批量模式入口。
    expect(within(dialog).queryByRole('button', { name: '删除' })).toBeNull()

    // 每行一个 ✕（平时透明，悬停才出现）。
    const removeRow = within(dialog).getAllByRole('button', { name: '删除这条历史' })[0]
    fireEvent.click(removeRow)
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toHaveLength(1),
    )

    // 底部垃圾桶 = 清空全部（悬停有提示）。
    fireEvent.click(within(dialog).getByRole('button', { name: '清空历史' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }))
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

    openCommandTab('历史')
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

    openCommandTab('历史')
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('搜索历史指令'), {
      target: { value: 'give' },
    })
    // 只断言弹框里的列表：空态背后的「最近执行」芯片也会出现同样的指令文本。
    expect(within(dialog).getByText('/give 29 Alice')).toBeTruthy()
    expect(within(dialog).queryByText('/time 12:00')).toBeNull()
  })

  it('「最多 100 条」与清空按钮在 tab 栏右侧（不再单独占一行）', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([{ cmd: '/seed', ts: 1, ok: true, status: 'ok' }]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openCommandTab('历史')
    const dialog = await screen.findByRole('dialog')

    const note = within(dialog).getByText('最多 100 条')
    const clear = within(dialog).getByRole('button', { name: '清空历史' })
    // 两者在同一个容器里，靠右（`ml-auto`），并且与 tab 栏同一行。
    const cluster = note.parentElement as HTMLElement
    expect(cluster.className).toContain('ml-auto')
    expect(cluster.contains(clear)).toBe(true)
    const tabRow = within(dialog).getAllByRole('tab')[0].parentElement?.parentElement as HTMLElement
    expect(tabRow.contains(cluster)).toBe(true)
    // 说明在清空按钮左边。
    expect(note.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 点两次才真的清空（就地确认，不弹框）。
    fireEvent.click(clear)
    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:history') ?? '[]')).toEqual([]),
    )
  })

  it('历史面板没有「去重」按钮（重复记录只能逐条删）', async () => {
    localStorage.setItem(
      'tswui:history',
      JSON.stringify([
        { cmd: '/time 12:00', ts: 3, ok: true, status: 'ok' },
        { cmd: '/time 12:00', ts: 1, ok: true, status: 'ok' },
      ]),
    )
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))

    openCommandTab('历史')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findAllByText('/time 12:00')).toHaveLength(2)
    expect(within(dialog).queryByRole('button', { name: /去重/ })).toBeNull()
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

describe('CommandPage 工具弹框：记忆与常用指令', () => {
  it('tab 用图标（terminal / star / rotate-ccw-clock 语义），名字走 aria-label', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')
    expect(tabNames(dialog)).toEqual(['指令库', '收藏', '历史'])
    // 图标 tab：没有可见文字，只靠 svg + aria-label。
    for (const tab of within(dialog).getAllByRole('tab')) {
      expect(tab.querySelector('svg')).toBeTruthy()
      expect(tab.textContent?.trim()).toBe('')
      // 悬停图标出 Tooltip：触发器是**图标外的 span**（不是 tab 本身，避免两个 Radix 组件抢 `data-state`）。
      const icon = tab.querySelector('svg') as SVGElement
      const trigger = icon.parentElement as HTMLElement
      fireEvent.pointerMove(icon, { pointerType: 'mouse' })
      fireEvent.pointerEnter(icon, { pointerType: 'mouse' })
      // `instant-open` / `delayed-open` 都表示「开了」。
      await waitFor(() => expect(trigger.getAttribute('data-state')).toMatch(/open$/))
      // tab 自己的选中态没被 Tooltip 覆盖。
      expect(tab.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('底部常用指令徽标：/help /who /bossdamage，悬停出官方说明，点了填进输入框', async () => {
    // `/who` 在真实数据里是 `playing` 的别名；fixture 里补上它，说明文案才有出处。
    const dataset = makeDataset({
      commands: [
        ...testCommands,
        {
          name: 'playing',
          aliases: ['online', 'who'],
          permission: null,
          help: 'Shows the currently connected players.',
          helpZh: '显示当前在线的玩家。',
          allowServer: true,
          doLog: false,
        },
      ],
    })
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true), true, vi.fn(), dataset)
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')

    for (const token of ['/help', '/who', '/bossdamage']) {
      expect(within(dialog).getByRole('button', { name: token })).toBeTruthy()
    }
    // 说明取自 data/commands.json（`/who` 是 `playing` 的别名）。
    // jsdom 里 Radix 的 Tooltip 内容不会真正挂到 DOM（真浏览器里已实测可显示），
    // 这里断言「悬停→延迟打开」这条链路 + 说明文案来源本身。
    const who = within(dialog).getByRole('button', { name: '/who' })
    fireEvent.pointerMove(who, { pointerType: 'mouse' })
    fireEvent.pointerEnter(who, { pointerType: 'mouse' })
    await waitFor(() => expect(who.getAttribute('data-state')).toBe('delayed-open'))
    expect(who.getAttribute('aria-describedby')).toBeTruthy()
    // 文案就是官方 helpZh（不是前端另写的）：同一份数据在指令列表里也是这句。
    expect(within(dialog).getAllByText('显示当前在线的玩家。').length).toBeGreaterThan(0)

    fireEvent.click(within(dialog).getByRole('button', { name: '/help' }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('/help'),
    )
  })

  it('记住上次停的 tab：关掉再打开还是那一页', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    switchTab('历史')
    await screen.findByPlaceholderText('搜索历史指令')
    // 收起弹框。
    fireEvent.click(within(composerEl()).getByRole('button', { name: '指令库' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    openTools('指令库')
    expect(await screen.findByPlaceholderText('搜索历史指令')).toBeTruthy()
  })

  it('记住每页的搜索词与滚动位置（关掉再打开还在）', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    const search = await screen.findByPlaceholderText('搜索物品（ID / 名称）')
    fireEvent.change(search, { target: { value: '铁' } })

    fireEvent.click(within(composerEl()).getByRole('button', { name: '物品' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    openTools('物品')
    expect((await screen.findByPlaceholderText('搜索物品（ID / 名称）') as HTMLInputElement).value).toBe(
      '铁',
    )
  })
})

describe('CommandPage 物品弹框：「标签模式」开关', () => {
  it('只在物品入口的「物品」tab 右侧出现，切到合成表就没有', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    const dialog = await screen.findByRole('dialog')
    // 按钮文字直接写「点下去做什么」：默认（关）是「插入ID」。
    const toggle = within(dialog).getByRole('button', { name: '插入ID' })
    // 与 tab 栏同一行，且在右侧（`ml-auto`）。
    expect(toggle.closest('.ml-auto')).toBeTruthy()

    switchTab('合成表')
    expect(within(dialog).queryByRole('button', { name: '插入ID' })).toBeNull()
  })

  it('关掉时：点物品进详情（插裸 ID）；开启后：点一条直接插 [i:ID]', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    const dialog = await screen.findByRole('dialog')

    // 搜到「生命水晶」（id 29）。
    fireEvent.change(within(dialog).getByPlaceholderText('搜索物品（ID / 名称）'), {
      target: { value: '生命水晶' },
    })
    const row = await within(dialog).findByRole('button', { name: /生命水晶/ })

    // 默认（关）：只是选中，出现详情区，输入框不变。
    fireEvent.click(row)
    expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('')
    expect(within(dialog).getByRole('button', { name: '插入' })).toBeTruthy()

    // 打开「插入标签」再点：直接追加 [i:29]（按钮文字随之变成「插入标签」）。
    fireEvent.click(within(dialog).getByRole('button', { name: '插入ID' }))
    const on = within(dialog).getByRole('button', { name: '插入标签' })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(await within(dialog).findByRole('button', { name: /生命水晶/ }))
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('[i:29]'),
    )
    // 标签模式下不再弹「插入方式」详情区。
    expect(within(dialog).queryByRole('button', { name: '插入' })).toBeNull()
  })

  it('开关状态记在本机（下次打开还是开的）', async () => {
    localStorage.setItem('tswui:itemTagMode', 'true')
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('物品')
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('button', { name: '插入标签' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })
})

describe('CommandPage 常用指令徽标', () => {
  it('四个常用指令都在，样式是 ghost（安静的入口，不抢列表）', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')

    for (const token of ['/help', '/who', '/bossdamage', '/alldeath']) {
      const badge = within(dialog)
        .getAllByRole('button')
        .find((b) => b.textContent?.trim() === token) as HTMLElement
      expect(badge, token).toBeTruthy()
      // ghost：没有 secondary 的底色。
      expect(badge.className).not.toContain('bg-secondary')
    }
  })

  it('点徽标把指令填进输入框，不自动执行', async () => {
    const runCommand = vi.fn()
    renderEditor(fakeTransport(runCommand), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')

    const badge = within(dialog)
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === '/help') as HTMLElement
    fireEvent.click(badge)
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tswui:draft') ?? '""')).toBe('/help'),
    )
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('切到收藏 / 历史时右侧不显示常用指令', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')
    const badge = () =>
      within(dialog)
        .queryAllByRole('button')
        .find((b) => b.textContent?.trim() === '/alldeath')
    // 默认在「指令库」页：徽标在。
    expect(badge()).toBeTruthy()

    switchTab('收藏')
    expect(badge()).toBeUndefined()
    switchTab('历史')
    expect(badge()).toBeUndefined()
    // 切回指令库又回来。
    switchTab('指令库')
    expect(badge()).toBeTruthy()
  })

  it('不再有「常用指令设置」按钮', async () => {
    renderEditor(fakeTransport(vi.fn()), vi.fn().mockResolvedValue(true))
    openTools('指令库')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /常用指令设置/ })).toBeNull()
  })
})

