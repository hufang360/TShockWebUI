import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { TopBarProvider, TopBarSlot } from '@/components/TopBar'
import { CommandResultsProvider } from '@/lib/commandResults'
import { ExecutionQueueProvider } from '@/lib/executionQueue'
import { DatasetProvider } from '@/lib/datasetContext'
import { resetRefreshGate } from '@/lib/refreshGate'
import { makeDataset } from '@/test/fixtures'
import { playerStubs } from '@/test/playerStubs'
import type { BackendTransport, FishGood, FishShop } from '@/lib/tshock'
import { TshockRequestError } from '@/lib/tshock'
import { FishShopPage } from './FishShopPage'

const GOOD: FishGood = {
  serial: 1,
  id: 29,
  name: '生命水晶',
  icon: '[i:29]',
  buyMax: 999,
  needArgs: false,
  map: ['物品'],
  desc: '[i:29] 生命水晶',
  cost: '[i/s2:73] 2 金币',
  unlock: '',
  comment: '备注 [i:29]',
}

// 非原生物品的典型：icon 只是借来的识别图（水桶 / 生命水晶），desc 里没有 `[i:..]`。
const POND_GOOD: FishGood = {
  serial: 180,
  name: '鱼池',
  icon: '[i:29]',
  buyMax: 1,
  needArgs: false,
  map: [],
  desc: '以你脚下为中心向下挖一个16×26的玻璃水鱼池',
  cost: '[i/s5:73] 5 金币',
  unlock: '',
  comment: '',
  // 注解图**按指令**匹配（不看名字）：/igen pond water → 鱼池图
  cmds: ['/igen pond water'],
}

// 刷怪场：`/clip paste spawnerfarm` → 刷怪场注解图（与前三条不同的识别方式：关键字）
const SPAWNER_GOOD: FishGood = {
  serial: 181,
  name: '岛牌刷怪厂',
  icon: '[i:29]',
  buyMax: 1,
  needArgs: false,
  map: [],
  desc: '粘贴保存好的刷怪场',
  cost: '[i/s1:73] 1 铂金',
  unlock: '',
  comment: '',
  cmds: ['/wm backup', '/clip paste spawnerfarm foot'],
}

const ARG_GOOD: FishGood = {
  serial: 160,
  name: '地图上找',
  icon: '[i:29]',
  buyMax: 1,
  needArgs: true,
  map: ['find'],
  desc: '全图查找',
  cost: '[i/s1:73] 1 金币',
  unlock: '',
  comment: '',
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

function renderPage(transport: BackendTransport) {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={makeDataset()}>
        <ExecutionQueueProvider interval={0}>
          <CommandResultsProvider serverId="default">
            <FishShopPage
              serverId="default"
              transport={transport}
              authenticated
              refreshInterval={120000}
              onTokenInvalid={vi.fn()}
              onLogin={vi.fn()}
            />
          </CommandResultsProvider>
        </ExecutionQueueProvider>
      </DatasetProvider>
    </I18nProvider>,
  )
}

const shopOf = (goods: FishGood[]): FishShop => ({ name: 'Mock 鱼店', total: goods.length, goods })

beforeEach(() => {
  resetRefreshGate()
})

afterEach(() => {
  localStorage.clear()
  // 窄屏用例会改视口宽：断点判断读的是 `window.innerWidth`，别漏给后面的用例。
  window.innerWidth = 1024
  vi.restoreAllMocks()
})

describe('FishShopPage', () => {
  it('货架网格：列出商品，格子尺寸 / 排版 / 提示都对', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    expect((await screen.findAllByText('生命水晶')).length).toBeGreaterThan(0)
    expect(screen.getByText('#1')).toBeTruthy()

    // 格子高度跟随内容：尺寸变体自带 `md:h-9`（媒体查询变体在后，会盖掉无断点的 `h-auto`），
    // 只写 `h-auto` 时 ≥768px 的格子被锁成 36px，图标 / 名称溢出压到下一行，整片商品重叠。
    const cell = await screen.findByRole('button', { name: '生命水晶' })
    expect(cell.className).toContain('h-auto')
    expect(cell.className).toContain('md:h-auto')

    // 与「物品 ID」同尺寸同排版。默认「大」：格子宽 72、不随窗口拉伸；整格 hover 不铺底色。
    expect(cell.dataset.size).toBe('lg')
    expect(cell.style.width).toBe('72px')
    expect(cell.className).toContain('hover:bg-transparent')
    // 子节点顺序：图标区 → #编号 → 名称（编号在名称**上面**一行）。
    const parts = [...cell.children].map((el) => el.textContent?.trim() ?? '')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('')
    expect(parts[1]).toBe('#1')
    expect(parts[2]).toBe('生命水晶')
    // 底色只挂在 72×72 的图标区上。
    const surface = cell.querySelector('[data-testid="good-icon-surface"]') as HTMLElement
    expect(surface.style.width).toBe('72px')
    expect(surface.style.height).toBe('72px')
    expect(surface.className).toContain('group-hover/cell:bg-primary/10')
    // 网格：列宽固定 72；大尺寸列距 16px、行距 24px（行距放宽给货架板和名称留空间）。
    const grid = cell.parentElement as HTMLElement
    expect(grid.className).toContain('grid-cols-[repeat(auto-fill,4.5rem)]')
    expect(grid.className).toContain('gap-x-4')
    expect(grid.className).toContain('gap-y-6')

    // 原生（真物品）的图标仍走物品提示，不再多一层「编号 + 商品名」。
    expect(screen.queryByTestId('good-tooltip')).toBeNull()
  })

  it('建筑预览：可折叠、可放大、四档倍率', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([POND_GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '鱼池' }))
    const dialog = await screen.findByRole('dialog')
    const img = dialog.querySelector('img[src$="diagram-pond.png"]') as HTMLImageElement
    expect(img).toBeTruthy()
    // 图片本身就是标注（站哪、往上/往下几格），alt 给读屏
    expect(img.getAttribute('alt')).toBe('「鱼池」的建造范围示意图')
    // 标题行就是折叠开关
    expect(within(dialog).getByText('建筑预览')).toBeTruthy()
    // 居左：图按钮只包住图（`w-fit`），不居中（不再 `mx-auto`）
    const imageButton = within(dialog).getByRole('button', { name: '放大建筑预览' })
    expect(imageButton.className).toContain('w-fit')
    expect(imageButton.className).not.toContain('mx-auto')
    // 详情头部那个大图标不重复弹「编号 + 名称」（名字就在图下面）
    expect(within(dialog).queryByTestId('good-tooltip')).toBeNull()

    // 折叠：收起后图不显示，再点回来。
    const trigger = within(dialog).getByRole('button', { name: '建筑预览' })
    fireEvent.click(trigger)
    await waitFor(() => expect(dialog.querySelector('img[src$="diagram-pond.png"]')).toBeNull())
    fireEvent.click(trigger)
    await waitFor(() => expect(dialog.querySelector('img[src$="diagram-pond.png"]')).toBeTruthy())

    // 放大：叠一层弹框，详情仍在（radix 把非顶层标 aria-hidden，所以查 hidden）。
    // jsdom 不加载图片（naturalWidth = 0），这里只断言放大弹框里那张图存在；
    // 倍率宽度由浏览器 onLoad 拿到真实像素宽度后生效。
    fireEvent.click(within(dialog).getByRole('button', { name: '放大建筑预览' }))
    await waitFor(() => expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2))
    expect(screen.getByText('商品详情')).toBeTruthy()
    const zoomed = screen
      .getAllByRole('dialog', { hidden: true })
      .map((el) => el.querySelector('img[src$="diagram-pond.png"]'))
      .filter(Boolean)
    expect(zoomed.length).toBeGreaterThan(1)

    // 四档倍率：默认 1:1（图片原生像素），切档高亮跟着变。
    const group = await screen.findByRole('radiogroup', { name: '缩放倍率' })
    for (const label of ['1/2', '1:1', '2×', '3×']) {
      expect(within(group).getByRole('radio', { name: label })).toBeTruthy()
    }
    expect(within(group).getByRole('radio', { name: '1:1' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(group).getByRole('radio', { name: '3×' }))
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: '3×' }).getAttribute('aria-checked')).toBe('true'),
    )
  })

  it('建筑预览按指令 / 关键字匹配：刷怪场有自己的图，普通商品没有', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([SPAWNER_GOOD, GOOD]) }))

    fireEvent.click(await screen.findByRole('button', { name: '岛牌刷怪厂' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('img[src$="diagram-spawnerfarm.png"]')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '生命水晶' }))
    dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('img[src*="fishshop/diagram-"]')).toBeNull()
  })

  it('右侧默认只有「钓鱼信息」卡片：鱼罐 / 消费榜 / 鱼篓榜默认不显示', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    await screen.findAllByText('生命水晶')
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '游戏内指令' })).toBeNull()
    // 三张新增卡片默认**不显示**（要玩家在「管理卡片」里打开）。
    expect(screen.queryByText('鱼罐')).toBeNull()
    expect(screen.queryByText('消费榜')).toBeNull()
    expect(screen.queryByText('鱼篓榜')).toBeNull()
    expect(screen.queryByText('重载配置')).toBeNull()
  })

  it('右侧内容全隐藏时收掉右列，左侧货架铺满', async () => {
    // 卡片与记事本都隐藏（记事本的隐藏记在同一个 key 里，id = notepad）。
    localStorage.setItem(
      'tswui:fishCards:hidden',
      JSON.stringify({ info: true, jar: true, rank: true, basket: true, notepad: true }),
    )
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    await screen.findAllByText('生命水晶')

    const side = screen.getByTestId('fish-side')
    expect(side.className).toContain('hidden')
    // 顶栏的「管理卡片」还在（否则没法把卡片重新打开）。
    expect(screen.getByRole('button', { name: '管理卡片' })).toBeTruthy()
  })

  it('鱼罐 / 消费榜 / 鱼篓榜默认不显示、不自动执行，在「管理卡片」里打开才出现', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), runCommand }))
    await screen.findByText('钓鱼信息')
    expect(screen.queryByText('鱼罐')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '管理卡片' }))
    const sheet = await screen.findByRole('dialog')
    const jarRow = within(sheet).getByRole('listitem', { name: '鱼罐' })
    // 默认隐藏：行内是闭眼徽标；自动执行徽标是「不自动执行」。
    expect(within(jarRow).getByLabelText('已隐藏')).toBeTruthy()
    expect(within(jarRow).getByLabelText('不自动执行')).toBeTruthy()
    fireEvent.click(within(jarRow).getByLabelText('已隐藏'))

    // 点过眼睛徽标后：变「显示中」。
    const shownRow = within(sheet).getByRole('listitem', { name: '鱼罐' })
    expect(within(shownRow).getByLabelText('显示中')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // 卡片出现了，但仍是「手动执行」：刷新全部只跑钓鱼信息。
    expect(await screen.findByText('鱼罐')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新全部' }))
    await waitFor(() =>
      expect(runCommand.mock.calls.some(([cmd]) => cmd === '/fish info')).toBe(true),
    )
    expect(runCommand.mock.calls.some(([cmd]) => cmd === '/fish jar')).toBe(false)
  })

  it('「管理卡片」的「恢复默认」把鱼罐等改回默认隐藏，并清掉自定义卡片', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    await screen.findByText('钓鱼信息')

    fireEvent.click(screen.getByRole('button', { name: '管理卡片' }))
    const sheet = await screen.findByRole('dialog')
    // 加一张自定义卡片 + 把鱼罐改成显示。
    fireEvent.click(within(sheet).getByRole('button', { name: '添加卡片' }))
    fireEvent.change(within(sheet).getByLabelText('卡片名称'), { target: { value: '常用购买' } })
    fireEvent.change(within(sheet).getByLabelText('指令'), { target: { value: '/fish buy 1' } })
    fireEvent.click(within(sheet).getByRole('button', { name: /^添加$/ }))
    fireEvent.click(within(within(sheet).getByRole('listitem', { name: '鱼罐' })).getByLabelText('已隐藏'))
    expect(within(within(sheet).getByRole('listitem', { name: '鱼罐' })).getByLabelText('显示中')).toBeTruthy()

    // 恢复默认：图标按钮 → 就地二次确认。
    fireEvent.click(within(sheet).getByRole('button', { name: '恢复默认' }))
    fireEvent.click(await within(sheet).findByRole('button', { name: '确认恢复' }))

    await waitFor(() => expect(within(sheet).queryByRole('listitem', { name: '常用购买' })).toBeNull())
    expect(within(within(sheet).getByRole('listitem', { name: '鱼罐' })).getByLabelText('已隐藏')).toBeTruthy()
  })

  it('把鱼罐勾成「自动执行」后，刷新全部会执行它', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), runCommand }))
    await screen.findByText('钓鱼信息')

    fireEvent.click(screen.getByRole('button', { name: '管理卡片' }))
    const sheet = await screen.findByRole('dialog')
    const jarRow = within(sheet).getByRole('listitem', { name: '鱼罐' })
    fireEvent.click(within(jarRow).getByLabelText('已隐藏'))
    fireEvent.click(
      within(within(sheet).getByRole('listitem', { name: '鱼罐' })).getByLabelText('不自动执行'),
    )
    fireEvent.click(within(sheet).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '刷新全部' }))
    await waitFor(() =>
      expect(runCommand.mock.calls.some(([cmd]) => cmd === '/fish jar')).toBe(true),
    )
  })

  it('记事本贴在「钓鱼信息」卡片下面一行，输入自动存本机（按服务器分开）', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    const info = await screen.findByText('钓鱼信息')
    const note = screen.getByTestId('fish-notepad')
    // DOM 顺序：钓鱼信息卡片在前，记事本紧跟其后。
    expect(info.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const box = within(note).getByLabelText('记事本') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '今天鱼价 3 金' } })
    expect(box.value).toBe('今天鱼价 3 金')
    // 边打边存：按 serverId 存在本机。
    expect(JSON.parse(localStorage.getItem('tswui:fishNote') ?? '{}').default).toBe('今天鱼价 3 金')
  })

  it('非原生物品（指令类，desc 无 [i:..]）悬停只给「编号 + 名称」，不报物品属性', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]) }))

    const cell = await screen.findByRole('button', { name: '地图上找' })
    const icon = within(cell).getByRole('img')
    fireEvent.pointerMove(icon, { pointerType: 'mouse' })
    fireEvent.pointerEnter(icon, { pointerType: 'mouse' })
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('#160')
    expect(tip.textContent).toContain('地图上找')
    // 借来的识别图是「生命水晶」：提示里不能出现它的物品名（会让人以为买的就是那件物品）
    expect(tip.textContent).not.toContain('生命水晶')
    // 借来的识别图按正常透明度显示（与真物品一致）。
    expect(icon.parentElement?.className ?? '').not.toContain('opacity-80')
  })

  it('件数在输入框右侧（失焦且空时让位给 / 提示），整页滚动、工具条吸顶', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    // 先等搜索框出现（货架是异步拉的）。
    const input = await screen.findByRole('textbox', { name: '搜索商品：编号 / 名称 / 说明' })
    const group = input.closest('[data-slot="input-group"]') as HTMLElement
    // 失焦且没内容：右侧让位给 `/` 快捷键提示（点一下或按 / 才聚焦输入框）。
    expect(within(group).getByText('/')).toBeTruthy()

    // 聚焦后：件数就在输入框右侧（不再是输入框下面的一行），输入框宽度有上限。
    fireEvent.focus(input)
    const count = await screen.findByText('1 件商品')
    expect(group.contains(count)).toBe(true)
    // 输入框宽度有上限（包在 `max-w-sm` 的容器里，避免长占位符撑满整行）。
    expect(group.closest('.max-w-sm')).toBeTruthy()
    // 头部白卡已移除：输入框直接铺在页面背景上。
    expect(group.closest('[data-slot="card"]')).toBeNull()

    // 整页滚动：工具条吸在顶栏（48px）下面，货架跟着页面走、不再有内层滚动区。
    const toolbar = group.closest('.sticky') as HTMLElement | null
    expect(toolbar?.className).toContain('top-12')
    expect(toolbar?.contains(screen.getByText('#1'))).toBe(false)
    // 货架不再套内层滚动区：整页滚（滚动条在浏览器右侧）。
    const grid = screen.getByText('#1').closest('button')?.parentElement as HTMLElement
    expect(grid.className).toContain('grid')
    expect(grid.closest('[class*="overflow-y-auto"]')).toBeNull()

    // 刷新不再放在输入框里（顶栏那个「刷新全部」会连货架一起刷）。
    expect(within(group).queryByRole('button', { name: '刷新' })).toBeNull()

    // 右列（指令卡片）钉在顶栏下面：滚左侧货架时不跟着一起滚。
    const rightColumn = document.querySelector('[class*="xl:sticky"]') as HTMLElement | null
    expect(rightColumn?.className).toContain('xl:top-12')
    expect(within(rightColumn!).getByText('钓鱼信息')).toBeTruthy()
  })

  it('词缀：格子在商品名前显示词缀名（warning 色），悬停图标提示也带词缀', async () => {
    const PREFIXED: FishGood = {
      ...GOOD,
      serial: 2,
      icon: '[i/p81:29]',
      desc: '[i/p81:29] 生命水晶',
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([PREFIXED]) }))

    const cell = await screen.findByRole('button', { name: '生命水晶' })
    const prefix = within(cell).getByText('传奇')
    expect(prefix.className).toContain('text-warning')

    fireEvent.mouseOver(within(cell).getByRole('img', { name: '生命水晶' }))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByText('传奇')).toBeTruthy()
    expect(within(tip).getByText('生命水晶')).toBeTruthy()
  })

  it('详情内容与布局：标题 / 价格图标 / 数量框 / 不显示空行 / 遮罩只盖内容区', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')

    // 标题是「序号 + 名称」
    expect(within(dialog).getByText('#1 生命水晶')).toBeTruthy()
    expect(within(dialog).getByText('2 金币')).toBeTruthy()
    // 图标行 + 价格图标 + 商品图标 + 备注图标
    expect(within(dialog).getAllByRole('img').length).toBeGreaterThanOrEqual(3)
    expect(within(dialog).getByRole('button', { name: '购买' })).toBeTruthy()
    // 询价按钮已移除（数据在 list 里已有）
    expect(within(dialog).queryByRole('button', { name: '询价' })).toBeNull()
    // —— 可购买多件时才显示数量框 ——
    {
      fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('spinbutton')).toBeTruthy()
      expect(within(dialog).getByText('最多 999 件')).toBeTruthy()
    }
    // —— 没有限购 / 时机 / 检查的商品不显示这些行 ——
    {
      fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).queryByText('限制')).toBeNull()
      expect(within(dialog).queryByText('购买时机')).toBeNull()
      expect(within(dialog).queryByText('购买前检查')).toBeNull()
    }
    // —— 桌面端详情：遮罩只盖内容区（从左边界开始），侧栏不被盖住 ——
    {
      fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
      const panel = await screen.findByRole('dialog')

      // 外观仍是抽屉：贴右侧的整高面板，且不再用 Sheet 自带的 `inset-0` 遮罩。
      expect(panel.className).toContain('right-0')
      expect(panel.className).toContain('inset-y-0')
      expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
      expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()

      // 自绘遮罩：从内容区左边界（`--content-left`，即侧栏右边）开始，半透明黑 + 模糊。
      // 这里断言它的定位起点，等于断言「不会盖住左侧边栏」。
      const scrim = screen.getByTestId('fish-detail-scrim')
      expect(scrim.className).toContain('left-[var(--content-left,0px)]')
      expect(scrim.className).toContain('bg-black/50')
      expect(scrim.className).not.toContain('backdrop-blur')
      // 整页压暗（含顶栏）；侧栏收起时的「展开侧栏」按钮另行浮在这层上面（AppShell 里 `z-[46]`）。
      expect(scrim.className).toContain('inset-y-0')

      // 页面没被锁住（模态会锁 body 滚动 / 禁用点击）：所以点侧栏能直接切页面。
      expect(document.body.style.overflow).not.toBe('hidden')
    }
  })

  it('未安装插件时提示并隐藏货架', async () => {
    renderPage(
      fakeTransport({
        fishCapabilities: async () => ({ plugin: false, rest: false, permission: false }),
      }),
    )
    expect(await screen.findByText('需安装 鱼店 插件，无法获取货架数据。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '生命水晶' })).toBeNull()
  })

  it('提示区有「重新检测」：装上插件后不用切页面（REST 延迟注册的兜底）', async () => {
    // 第一次探到「没装」，第二次（点重新检测）探到可用。
    const fishCapabilities = vi
      .fn()
      .mockResolvedValueOnce({ plugin: false, rest: false, permission: false })
      .mockResolvedValue({ plugin: true, rest: true, permission: true })
    const fishList = vi.fn(async () => shopOf([GOOD]))
    renderPage(fakeTransport({ fishCapabilities, fishList }))

    expect(await screen.findByText('需安装 鱼店 插件，无法获取货架数据。')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /重新检测/ })[0])

    await waitFor(() => expect(fishCapabilities).toHaveBeenCalledTimes(2))
    // 检测通过后自动拉货架
    expect(await screen.findByRole('button', { name: '生命水晶' })).toBeTruthy()
  })

  it('插件可用但无权限时提示权限，钓鱼信息卡片仍可用', async () => {
    renderPage(
      fakeTransport({
        fishCapabilities: async () => ({ plugin: true, rest: true, permission: false }),
      }),
    )
    expect(await screen.findByText('老版本鱼店插件需要 fishshop.rest.use 权限，你的用户组没有。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '生命水晶' })).toBeNull()
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
  })

  it('老版本插件（没有 REST 接口）时提示版本过旧，钓鱼信息卡片仍可用', async () => {
    const fishList = vi.fn(async () => shopOf([]))
    renderPage(
      fakeTransport({
        fishCapabilities: async () => ({ plugin: true, rest: false, permission: false }),
        fishList,
      }),
    )
    expect(await screen.findByText('鱼店插件版本过旧')).toBeTruthy()
    // 没有 REST 就不该再拉货架。
    expect(fishList).not.toHaveBeenCalled()
    // 右侧指令卡片只走 rawcmd，照常渲染（只剩「钓鱼信息」）。
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
    expect(screen.queryByText('货架')).toBeNull()
  })

  it('货架接口业务失败（商店打烊）时展示上游原文，不说「没有匹配的商品」', async () => {
    renderPage(
      fakeTransport({
        fishList: async () => {
          throw new TshockRequestError('validation', '商店打烊', 400)
        },
      }),
    )
    // 上游文案原样展示：错误是商店状态，不是插件没有 / 搜不到东西。
    expect(await screen.findByText('商店打烊')).toBeTruthy()
    expect(screen.queryByText('没有匹配的商品')).toBeNull()
    expect(screen.queryByText('需安装 鱼店 插件，无法获取货架数据。')).toBeNull()
  })

  it('离开后再进入页面会重新拉货架（不受刷新间隔闸门影响）', async () => {
    const fishList = vi.fn(async () => shopOf([GOOD]))
    const first = renderPage(fakeTransport({ fishList }))
    await screen.findAllByText('生命水晶')
    first.unmount()
    renderPage(fakeTransport({ fishList }))
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(2))
  })

  it('服务类商品用 icon 字段配置的图标（desc 无 [i:..] 也能显示）', async () => {
    const service: FishGood = {
      serial: 110,
      name: '野生狗奶',
      icon: '[i:29]',
      buyMax: 1,
      needArgs: false,
          map: ['freezetime'],
      desc: '野生狗奶',
      cost: '[i/s15:73]',
      unlock: '',
      comment: '',
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([service]) }))

    const cell = await screen.findByRole('button', { name: '野生狗奶' })
    expect(within(cell).getByRole('img')).toBeTruthy()
  })


  it('buyMax=1 的商品不显示数量框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '地图上找' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('spinbutton')).toBeNull()
  })

  it('购买：填数量后确认，调用 fishBuy 并显示成功', async () => {
    const fishBuy = vi.fn(async () => ({ serial: 1, name: '生命水晶', amount: 3, cost: '[i/s6:73] 6 金币' }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    await waitFor(() => expect(fishBuy).toHaveBeenCalledWith(1, 3, ''))
    // 购买成功不关闭弹框，在界面显示结果
    expect(await within(dialog).findByText(/已购买：生命水晶 × 3/)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })



  it('限购条件显示在详情里（限制一行）', async () => {
    const limited: FishGood = {
      ...GOOD,
      serial: 228,
      name: 'GM',
      allowGroup: ['GM'],
      allowPlayers: ['hf', 'star'],
      denyPlayers: ['bad'],
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([limited]) }))
    fireEvent.click(await screen.findByRole('button', { name: 'GM' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('限制')).toBeTruthy()
    expect(within(dialog).getByText(/仅限用户组：GM/)).toBeTruthy()
    expect(within(dialog).getByText(/仅限玩家：hf、star/)).toBeTruthy()
    expect(within(dialog).getByText(/禁止玩家：bad/)).toBeTruthy()
  })

  it('限购次数 / 冷却 / 时机 / 购买前检查来自插件的结构化字段', async () => {
    const rich: FishGood = {
      ...GOOD,
      serial: 300,
      name: '召唤机械骷髅王',
      limit: 3,
      serverLimit: 10,
      cd: 60,
      serverCd: 30,
      needAlive: true,
      needNight: true,
      check: '需先击败骷髅王',
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([rich]) }))
    fireEvent.click(await screen.findByRole('button', { name: '召唤机械骷髅王' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/每人限购 3 次/)).toBeTruthy()
    expect(within(dialog).getByText(/全服限量 10 件/)).toBeTruthy()
    expect(within(dialog).getByText(/冷却 60 秒/)).toBeTruthy()
    expect(within(dialog).getByText(/全服冷却 30 秒/)).toBeTruthy()
    expect(within(dialog).getByText('购买时机')).toBeTruthy()
    expect(within(dialog).getByText(/死亡时不能买/)).toBeTruthy()
    expect(within(dialog).getByText(/只能夜晚买/)).toBeTruthy()
    expect(within(dialog).getByText('购买前检查')).toBeTruthy()
    expect(within(dialog).getByText(/需先击败骷髅王/)).toBeTruthy()
  })

  it('白天 / 夜晚都不让买时只说一句，不并排显示自相矛盾的两行', async () => {
    const closed: FishGood = { ...GOOD, serial: 301, name: '全天关闭', needDay: true, needNight: true }
    renderPage(fakeTransport({ fishList: async () => shopOf([closed]) }))
    fireEvent.click(await screen.findByRole('button', { name: '全天关闭' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/白天和夜晚都不能买/)).toBeTruthy()
    expect(within(dialog).queryByText(/只能白天买/)).toBeNull()
    expect(within(dialog).queryByText(/只能夜晚买/)).toBeNull()
  })


  it('多个透传参数时提示参数个数', async () => {
    const multi: FishGood = { ...ARG_GOOD, serial: 161, name: '放置建筑', argCount: 2 }
    renderPage(fakeTransport({ fishList: async () => shopOf([multi]) }))
    fireEvent.click(await screen.findByRole('button', { name: '放置建筑' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('参数（2 个，用空格分隔）')).toBeTruthy()
  })

  it('个人状态：先按 self=1 拉货架，拿不到就静默退回普通货架', async () => {
    const fishList = vi
      .fn()
      .mockRejectedValueOnce(new TshockRequestError('validation', '玩家 Alice 不在线，请先进入游戏', 400))
      .mockResolvedValue(shopOf([GOOD]))
    renderPage(fakeTransport({ fishList }))

    expect(await screen.findByRole('button', { name: '生命水晶' })).toBeTruthy()
    // 不在线不是错误：页面上不该出现那条文案
    expect(screen.queryByText(/不在线/)).toBeNull()
    // 第一次要个人状态，失败后第二次退回不带 self 的普通货架。
    expect(fishList.mock.calls[0][0]).toEqual({ self: true })
    expect(fishList.mock.calls[1]).toEqual([])
  })

  it('个人状态：显示还能买几次 / 冷却剩余', async () => {
    const good: FishGood = { ...GOOD, limit: 3, myCount: 2, myRemain: 1, myCdRemain: 30, canBuy: true }
    renderPage(fakeTransport({ fishList: async () => shopOf([good]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('我的进度')).toBeTruthy()
    expect(within(dialog).getByText(/还能买 1 次/)).toBeTruthy()
    expect(within(dialog).getByText(/冷却中，还需 30 秒/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('买完刷新货架后，弹框里的「我的进度」跟着更新', async () => {
    let remain = 1
    const fishList = vi.fn(async () =>
      shopOf([{ ...GOOD, limit: 3, myRemain: remain, myCount: 3 - remain, canBuy: true }]),
    )
    const fishBuy = vi.fn(async () => {
      remain = 0
      return { serial: 1, name: '生命水晶', amount: 1, requested: 1, refunded: false, cost: '5 金币' }
    })
    renderPage(fakeTransport({ fishList, fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/还能买 1 次/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    // 刷新后回到「还能买 0 次」（上游 canBuy 仍是 true，Mock 没改它）
    await waitFor(() => expect(within(dialog).getByText(/还能买 0 次/)).toBeTruthy())
  })

  it('个人状态：上游说买不了时显示原因并禁用购买', async () => {
    const good: FishGood = { ...GOOD, canBuy: false, blockReason: '已达个人限购', myRemain: 0 }
    renderPage(fakeTransport({ fishList: async () => shopOf([good]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('已达个人限购')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('参数按插件的引号规则数：引号里的空格不算多一个参数', async () => {
    const multi: FishGood = { ...ARG_GOOD, serial: 162, name: '保存建筑', argCount: 2 }
    renderPage(fakeTransport({ fishList: async () => shopOf([multi]) }))
    fireEvent.click(await screen.findByRole('button', { name: '保存建筑' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox', { name: '参数' })
    const buy = within(dialog).getByRole('button', { name: '购买' })

    fireEvent.change(input, { target: { value: '"我的 小屋"' } })
    expect((buy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '"我的 小屋" 10' } })
    expect((buy as HTMLButtonElement).disabled).toBe(false)
  })

  it('商品没发出去（自动退款）时不说「已购买」', async () => {
    const fishBuy = vi.fn(async () => ({
      serial: 1,
      name: '柚子仪式',
      amount: 0,
      requested: 1,
      refunded: true,
      cost: '',
    }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    expect(await within(dialog).findByText(/本次未发货，已全额退款/)).toBeTruthy()
    expect(within(dialog).queryByText(/已购买/)).toBeNull()
    // 什么都没发出去，不该让人等冷却（也不该出现「被夹小」提示）
    expect(within(dialog).queryByText(/单次上限只给了/)).toBeNull()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('降级条目（配置有误）提示并禁用购买', async () => {
    const broken: FishGood = {
      ...GOOD,
      serial: 400,
      name: '坏商品',
      comment: '该商品配置有误，已降级显示（详情见服务端控制台）',
    }
    renderPage(fakeTransport({ fishList: async () => shopOf([broken]) }))
    fireEvent.click(await screen.findByRole('button', { name: '坏商品' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('这件商品配置有误，暂时买不了。')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('需要多个参数时，参数个数不够就不能点购买', async () => {
    const multi: FishGood = { ...ARG_GOOD, serial: 161, name: '放置建筑', argCount: 2 }
    renderPage(fakeTransport({ fishList: async () => shopOf([multi]) }))
    fireEvent.click(await screen.findByRole('button', { name: '放置建筑' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox', { name: '参数' })
    const buy = within(dialog).getByRole('button', { name: '购买' })

    expect((buy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '小房间' } })
    expect((buy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '小房间 10' } })
    expect((buy as HTMLButtonElement).disabled).toBe(false)
  })

  it('实际成交件数被单次上限夹小时提示一句', async () => {
    const fishBuy = vi.fn(async () => ({
      serial: 1,
      name: '生命水晶',
      amount: 999,
      requested: 5000,
      cost: '5 金币',
    }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '999' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    expect(await within(dialog).findByText(/单次上限只给了 999 件（你想买 5000 件）/)).toBeTruthy()
  })

  it('价格为空的商品显示带背景的“免费”', async () => {
    const free: FishGood = { ...GOOD, serial: 220, name: 'Boss战报', cost: '' }
    renderPage(fakeTransport({ fishList: async () => shopOf([free]) }))
    fireEvent.click(await screen.findByRole('button', { name: 'Boss战报' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('免费')).toBeTruthy()
  })

  it('需要参数的商品：填参数后按参数购买（数量固定 1）', async () => {
    const fishBuy = vi.fn(async () => ({ serial: 160, name: '地图上找', amount: 1, cost: '[i/s1:73] 1 金币' }))
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '地图上找' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: '参数' }), { target: { value: 'egg' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))

    await waitFor(() => expect(fishBuy).toHaveBeenCalledWith(160, 1, 'egg'))
  })

  it('购买成功后按钮冷却并提示闪烁（防重复购买）', async () => {
    const fishBuy = vi.fn(async () => ({ serial: 1, name: '生命水晶', amount: 1, cost: '2 金币' }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    await waitFor(() => expect(fishBuy).toHaveBeenCalled())

    // 冷却：按钮变为倒计时且禁用，避免连点重复购买
    const cdBtn = await within(dialog).findByRole('button', { name: /请稍候/ })
    expect((cdBtn as HTMLButtonElement).disabled).toBe(true)
    // 成功提示闪烁
    const ok = within(dialog).getByText(/已购买/)
    expect(ok.closest('.tswui-flash')).toBeTruthy()
    // 额外提示：去游戏内查收
    expect(within(dialog).getByText('请打开游戏，进行查收！')).toBeTruthy()
  })

  it('关闭详情：同一行左侧按钮 / 点遮罩 / Esc 三种方式', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /关闭/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // —— 点遮罩关闭详情（等同点抽屉外） ——
    {
      fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
      await screen.findByRole('dialog')

      // 点页面别处（含侧栏导航）不关，避免「点导航切页」顺手把详情关掉。
      fireEvent.pointerDown(document.body)
      fireEvent.click(document.body)
      expect(screen.queryByRole('dialog')).toBeTruthy()

      fireEvent.click(screen.getByTestId('fish-detail-scrim'))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    // —— 桌面详情按 Esc 关闭 ——
    {
      fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
      await screen.findByRole('dialog')

      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
  })

  it('业务错误（钱不够）原样展示', async () => {
    const { TshockRequestError } = await import('@/lib/tshock')
    renderPage(
      fakeTransport({
        fishList: async () => shopOf([GOOD]),
        fishBuy: async () => {
          throw new TshockRequestError('validation', '钱不够', 400)
        },
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    expect(await within(dialog).findByText('钱不够')).toBeTruthy()
  })

  it('默认聚焦购买按钮；需要参数时聚焦参数输入框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '购买' })))
  })

  it('需要参数时默认聚焦参数输入框', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([ARG_GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '地图上找' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: '参数' })),
    )
  })



  it('关掉详情后点另一件商品，开的是那一件（不会叠两层）', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD, POND_GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText(/#1\s*生命水晶/)).toBeTruthy()

    fireEvent.click(screen.getByTestId('fish-detail-scrim'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '鱼池' }))
    const next = await screen.findByRole('dialog')
    expect(within(next).getByText(/#180\s*鱼池/)).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(next.querySelector('img[src$="diagram-pond.png"]')).toBeTruthy()
  })


  it('切到别的页面再回来（组件重新挂载）：详情还开着', async () => {
    const transport = fakeTransport({ fishList: async () => shopOf([GOOD]) })
    const first = renderPage(transport)
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    await screen.findByRole('dialog')
    first.unmount()

    renderPage(transport)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText(/#1\s*生命水晶/)).toBeTruthy()
    // 恢复出来的详情不抢焦点（回来就该能直接操作页面）。
    expect(document.activeElement).not.toBe(within(panel).getByRole('button', { name: '购买' }))
  })

  it('关掉详情后切走再回来，不会再弹出来', async () => {
    const transport = fakeTransport({ fishList: async () => shopOf([GOOD]) })
    const first = renderPage(transport)
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const panel = await screen.findByRole('dialog')
    fireEvent.click(within(panel).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    first.unmount()

    renderPage(transport)
    await screen.findByRole('button', { name: '生命水晶' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('恢复详情时货架还没回来，不会先说「已下架」', async () => {
    const transport = fakeTransport({ fishList: async () => shopOf([GOOD]) })
    const first = renderPage(transport)
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    await screen.findByRole('dialog')
    first.unmount()

    // 重新进页面时货架一直不回（加载中）：这时不该判成「已下架」。
    renderPage(fakeTransport({ fishList: () => new Promise(() => {}) }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).queryByText(/已不在当前货架/)).toBeNull()
  })

  it('窄屏仍是抽屉：点外面关闭', async () => {
    window.innerWidth = 480
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    await screen.findByRole('dialog')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeTruthy()

    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('FishShopPage 右侧指令卡片', () => {
  it('鱼店 REST API 不可用（探测报错）时仍渲染 5 张指令卡片', async () => {
    renderPage(
      fakeTransport({
        fishCapabilities: async () => {
          throw new TshockRequestError('plugin_missing', '没有 REST API')
        },
      }),
    )
    expect(await screen.findByText('钓鱼信息')).toBeTruthy()
    expect(screen.queryByText('货架')).toBeNull()
  })

  it('点击卡片刷新会执行对应指令', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: ['已钓到 3 条鱼'] })
    renderPage(fakeTransport({ fishList: async () => shopOf([]), runCommand }))

    const card = (await screen.findByText('钓鱼信息')).closest('[data-slot="card"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/fish info'))
    expect((await screen.findAllByText('已钓到 3 条鱼')).length).toBeGreaterThan(0)
  })

  it('统一执行：一次批量请求执行全部卡片', async () => {
    localStorage.setItem('tswui:homeBatch', 'true')
    const runCommand = vi.fn().mockResolvedValue({ status: 'ok', output: [] })
    const runBatch = vi
      .fn()
      .mockImplementation((cmds: string[]) =>
        Promise.resolve(cmds.map(() => ({ status: 'ok', output: [] }))),
      )
    renderPage(fakeTransport({ fishList: async () => shopOf([]), runCommand, runBatch }))

    fireEvent.click(await screen.findByRole('button', { name: '刷新全部' }))
    await waitFor(() => expect(runBatch).toHaveBeenCalled())
    expect(runBatch.mock.calls[0][0]).toEqual(['/fish info'])
    expect(runCommand).not.toHaveBeenCalled()
  })
})

/** 页面设置里的「图标大小」是 Select：点开下拉再点选项。 */
async function pickIconSize(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: '图标大小' }))
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

describe('FishShopPage 最近购买 / 页面设置', () => {
  const seedRecent = (goods: unknown[]) => {
    localStorage.setItem(
      'tswui:moduleState',
      JSON.stringify({ default: { store: { recentBuys: goods } } }),
    )
  }

  it('买成功后记进「买过」页签（不再有「最近购买」徽标）', async () => {
    const fishBuy = vi.fn(async () => ({
      serial: 1,
      name: '生命水晶',
      amount: 1,
      cost: '[i/s1:73] 2 金币',
    }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    await waitFor(() => expect(fishBuy).toHaveBeenCalled())

    // 关掉详情再查页签：弹框开着时背景是 aria-hidden，按 role 查不到里面的按钮。
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 搜索框旁边不再挂徽标（记录只在「买过」页签里）
    expect(screen.queryByTestId('fish-recent-buys')).toBeNull()
    expect(screen.getByTestId('fish-tab-bought').textContent).toContain('1')
    fireEvent.click(screen.getByTestId('fish-tab-bought'))
    expect(await screen.findByRole('button', { name: '生命水晶' })).toBeTruthy()
  })

  it('「买过」按内容指纹去重（旧版 recentBuys 也能迁移过来）', async () => {
    seedRecent([
      { ...GOOD, serial: 1 },
      // 同款、编号不同 → 只留一条
      { ...GOOD, serial: 7 },
      { ...GOOD, serial: 2, name: '二号' },
    ])
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    expect((await screen.findByTestId('fish-tab-bought')).textContent).toContain('2')
    fireEvent.click(screen.getByTestId('fish-tab-bought'))
    expect(await screen.findAllByRole('button', { name: '生命水晶' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: '二号' })).toBeTruthy()
  })

  it('页面设置：图标大小 / 隐藏编号和名称 / 表格视图', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    expect(await screen.findByText('#1')).toBeTruthy()

    // 隐藏编号和名称：格子里只剩图标。
    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    fireEvent.click(await screen.findByLabelText('隐藏编号和名称'))
    await waitFor(() => expect(screen.queryByText('#1')).toBeNull())
    // 这个开关只影响中 / 大：先关掉，后面单独测尺寸。
    fireEvent.click(screen.getByLabelText('隐藏编号和名称'))
    await screen.findByText('#1')

    // 表格视图：换成一张表（编号 / 图标 / 名称 / 价格 / 说明）。
    fireEvent.click(screen.getByLabelText('表格视图'))
    const table = await screen.findByRole('table')
    expect(within(table).getByText('编号')).toBeTruthy()
    expect(within(table).getAllByText('生命水晶').length).toBeGreaterThan(0)
    // 备注列：表头叫「备注」，内容单行截断（长备注不换行、不撑高行高）。
    expect(within(table).getByRole('columnheader', { name: '备注' })).toBeTruthy()
    const noteCell = within(table).getByTitle('备注 [i:29]')
    expect(noteCell.className).toContain('truncate')

    // 导出表格已经去掉（页面设置里不再有这个按钮）。
    expect(screen.queryByRole('button', { name: '导出表格' })).toBeNull()
  })

  it('页面设置「恢复默认」：图标大小与开关回到默认，打开时焦点不落在它身上', async () => {
    localStorage.setItem(
      'tswui:moduleState',
      JSON.stringify({
        default: { store: { iconSize: 'sm', hideMeta: true, shelf: false, awning: false } },
      }),
    )
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    const cell = await screen.findByRole('button', { name: '生命水晶' })
    // 存的「小」图标生效（40px，格子只剩图标）。
    expect(cell.style.width).toBe('40px')
    expect(screen.queryByText('#1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    const popover = screen.getByTestId('fish-settings-popover')
    // 打开时焦点给第一个设置项（图标大小），不是标题栏的「恢复默认」。
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(popover).getByRole('combobox', { name: '图标大小' }),
      ),
    )

    fireEvent.click(within(popover).getByRole('button', { name: '恢复默认' }))
    await waitFor(() => expect(cell.style.width).toBe('72px'))
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByTestId('shop-awning')).toBeTruthy()
    // 货架层板（jsdom 没排版，画不出来；看开关本身）回到勾选。
    expect(within(popover).getByLabelText('货架层板').getAttribute('data-state')).toBe('checked')
    expect(within(popover).getByLabelText('遮阳伞').getAttribute('data-state')).toBe('checked')

    // 设置键从本机存储里清掉（回落到默认值，而不是写一串 false）。
    const store = JSON.parse(localStorage.getItem('tswui:moduleState') ?? '{}').default?.store ?? {}
    for (const key of ['iconSize', 'hideMeta', 'tableView', 'shelf', 'awning']) {
      expect(key in store).toBe(false)
    }
  })

  it('图标大小：小 32 / 中 48 / 大 64，小尺寸不显示编号与名称', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    const cell = await screen.findByRole('button', { name: '生命水晶' })
    expect(cell.style.width).toBe('72px')

    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))

    // 中：图标 48、格子 56，编号与名称照常。
    await pickIconSize('中')
    await waitFor(() => expect(cell.style.width).toBe('56px'))
    const mdSurface = cell.querySelector('[data-testid="good-icon-surface"]') as HTMLElement
    expect(mdSurface.style.width).toBe('56px')
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('生命水晶')).toBeTruthy()

    // 小：图标 32、格子 40，只剩图标（标题 / 名称都不显示），「隐藏编号和名称」开关也不再出现。
    await pickIconSize('小')
    await waitFor(() => expect(cell.style.width).toBe('40px'))
    const smSurface = cell.querySelector('[data-testid="good-icon-surface"]') as HTMLElement
    expect(smSurface.style.width).toBe('40px')
    expect(screen.queryByText('#1')).toBeNull()
    expect(screen.queryByLabelText('隐藏编号和名称')).toBeNull()

    // 回到大：图标 64，编号与名称回来。
    await pickIconSize('大')
    await waitFor(() => expect(cell.style.width).toBe('72px'))
    expect(screen.getByText('#1')).toBeTruthy()
  })

  it('货架板：中 / 大尺寸才画，上沿贴图标区底部、板身盖住序号行、左右各留 4px', async () => {
    // jsdom 没有排版：按「格子 / 图标区 / 图标 / 序号行」分别给假矩形，验证几何计算。
    // 格子高 107、图标区底 72、图标底 68、序号行底 87 → 板上沿 72 + 1px（整块板下移）＝ 73、
    // 板厚 87 - 73 = 14、周期 = 107 + 行距；板宽收到最后一列（jsdom 当作 1 列，即 72），左右各留 4px。
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const bottom =
        this.tagName === 'BUTTON'
          ? 107
          : this.dataset.testid === 'good-icon-surface'
            ? 72
            : this.className.includes('font-pixel')
              ? 87
              : 68
      return {
        width: 72,
        height: bottom,
        top: 0,
        left: 0,
        right: 72,
        bottom,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    await screen.findByRole('button', { name: '生命水晶' })

    const shelf = await screen.findByTestId('fish-shelf')
    expect(shelf.className).toContain('fish-shelf')
    expect(shelf.style.getPropertyValue('--fish-shelf-pitch')).toBe('107px')
    expect(shelf.style.getPropertyValue('--fish-shelf-line')).toBe('73px')
    expect(shelf.style.getPropertyValue('--fish-shelf-thickness')).toBe('14px')
    // 板宽收到「最后一列商品的右边」再左右各留 4px：jsdom 算不出列数（当作 1 列）→ 72 - 8。
    expect(shelf.style.left).toBe('4px')
    expect(shelf.style.width).toBe('64px')

    // 小尺寸不画（图标排得密，加板只会更乱）。
    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    await pickIconSize('小')
    await waitFor(() => expect(screen.queryByTestId('fish-shelf')).toBeNull())

    // 表格视图也不画。
    await pickIconSize('大')
    fireEvent.click(screen.getByLabelText('表格视图'))
    await waitFor(() => expect(screen.queryByTestId('fish-shelf')).toBeNull())
  })

  it('页面设置：「货架层板」可以手动关掉 / 打开，开关记在本机', async () => {
    // 同上：jsdom 不排版，货架板要假矩形才画得出来。
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const bottom =
        this.tagName === 'BUTTON'
          ? 107
          : this.dataset.testid === 'good-icon-surface'
            ? 72
            : this.className.includes('font-pixel')
              ? 87
              : 68
      return {
        width: 72,
        height: bottom,
        top: 0,
        left: 0,
        right: 72,
        bottom,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    expect(await screen.findByTestId('fish-shelf')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    fireEvent.click(await screen.findByLabelText('货架层板'))
    await waitFor(() => expect(screen.queryByTestId('fish-shelf')).toBeNull())

    fireEvent.click(screen.getByLabelText('货架层板'))
    await waitFor(() => expect(screen.queryByTestId('fish-shelf')).toBeTruthy())
  })

  it('遮阳伞：默认挂在货架区顶部，表格视图下不画，「页面设置」可以关掉', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    expect(await screen.findByTestId('shop-awning')).toBeTruthy()

    // 表格视图：货架变成数据表，不再顶篷布 —— 开关也跟着藏起来（关了也看不见东西）。
    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    fireEvent.click(await screen.findByLabelText('表格视图'))
    await waitFor(() => expect(screen.queryByTestId('shop-awning')).toBeNull())
    expect(screen.queryByLabelText('遮阳伞')).toBeNull()

    // 回到网格视图：篷布回来。
    fireEvent.click(screen.getByLabelText('表格视图'))
    expect(await screen.findByTestId('shop-awning')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('遮阳伞'))
    await waitFor(() => expect(screen.queryByTestId('shop-awning')).toBeNull())

    fireEvent.click(screen.getByLabelText('遮阳伞'))
    expect(await screen.findByTestId('shop-awning')).toBeTruthy()
  })

  it('页签：收藏 ⭐ 后出现在「收藏」，再点取消就没了', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByTestId('fish-favorite'))
    // 按钮变成「取消收藏」
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '取消收藏' })).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByTestId('fish-tab-favorite'))
    expect(await screen.findByRole('button', { name: '生命水晶' })).toBeTruthy()

    // 取消收藏 → 收藏页签空掉
    fireEvent.click(screen.getByRole('button', { name: '生命水晶' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByTestId('fish-favorite'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('还没有收藏商品')).toBeTruthy()
  })

  it('货架增删商品后编号整体错位：收藏仍指向同一件（按内容认，不按 serial）', async () => {
    // 先把「生命水晶」收藏（它在 #1）。
    let goods: FishGood[] = [GOOD]
    const fishList = vi.fn(async () => shopOf(goods))
    renderPage(fakeTransport({ fishList }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByTestId('fish-favorite'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 服主在前面插了一件新商品：生命水晶 的 serial 从 1 变成 5，而 #1 现在是别的东西。
    goods = [
      { ...GOOD, serial: 1, id: 30, name: '别的东西', desc: '[i:30] 别的东西' },
      { ...GOOD, serial: 5 },
    ]
    fireEvent.click(await screen.findByRole('button', { name: '刷新全部' }))
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByTestId('fish-tab-favorite'))
    const cell = await screen.findByRole('button', { name: '生命水晶' })
    fireEvent.click(cell)
    const sheet = await screen.findByRole('dialog')
    // 打开的是 #5 的生命水晶，不是 #1 的「别的东西」
    expect(within(sheet).getByText(/生命水晶/)).toBeTruthy()
    expect(within(sheet).getByText('#5', { exact: false })).toBeTruthy()
  })

  it('收藏的商品已下架：仍能看快照，但提示已下架且不能买', async () => {
    let goods: FishGood[] = [GOOD]
    const fishList = vi.fn(async () => shopOf(goods))
    renderPage(fakeTransport({ fishList }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByTestId('fish-favorite'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // 货架上没有这件了
    goods = [{ ...GOOD, serial: 9, id: 30, name: '别的商品', desc: '[i:30] 别的商品' }]
    fireEvent.click(await screen.findByRole('button', { name: '刷新全部' }))
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByTestId('fish-tab-favorite'))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/已不在当前货架/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '购买' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('「买过」页签列出买过的商品（买完即出现）', async () => {
    const fishBuy = vi.fn(async () => ({
      serial: 1,
      name: '生命水晶',
      amount: 1,
      cost: '[i/s1:73] 2 金币',
    }))
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]), fishBuy }))

    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '购买' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认购买' }))
    await waitFor(() => expect(fishBuy).toHaveBeenCalled())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByTestId('fish-tab-bought'))
    expect(await screen.findByRole('button', { name: '生命水晶' })).toBeTruthy()
  })

  it('详情抽屉顶栏：显示「商品详情」标题 + 居中图标与编号名称，⭐ 在底栏最左', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    fireEvent.click(await screen.findByRole('button', { name: '生命水晶' }))
    const sheet = await screen.findByRole('dialog')

    // 顶栏：可见标题（不是 sr-only）
    const title = within(sheet).getByText('商品详情')
    expect(title.getAttribute('class') ?? '').not.toContain('sr-only')
    expect(within(sheet).getByText(/#1/)).toBeTruthy()
    // ⭐ 在底栏，且是底栏的第一个元素（左下角）
    const favorite = within(sheet).getByTestId('fish-favorite')
    const bottomBar = favorite.closest('.border-t') as HTMLElement
    expect((bottomBar.firstElementChild as HTMLElement).contains(favorite)).toBe(true)
  })

  it('顶栏顺序：刷新全部 / 管理卡片 → 页面设置 / 全屏 → 浮动终端', async () => {
    render(
      <I18nProvider lang="zh">
        <TopBarProvider>
          <TopBarSlot extra={<span data-testid="terminal" />} />
          <DatasetProvider value={makeDataset()}>
            <ExecutionQueueProvider interval={0}>
              <CommandResultsProvider serverId="default">
                <FishShopPage
                  serverId="default"
                  transport={fakeTransport({ fishList: async () => shopOf([GOOD]) })}
                  authenticated
                  refreshInterval={120000}
                  onTokenInvalid={vi.fn()}
                  onLogin={vi.fn()}
                />
              </CommandResultsProvider>
            </ExecutionQueueProvider>
          </DatasetProvider>
        </TopBarProvider>
      </I18nProvider>,
    )
    await screen.findByRole('button', { name: '生命水晶' })

    // 顶栏右侧插槽的 DOM 顺序 = 视觉顺序
    const row = (await screen.findByTestId('terminal')).parentElement as HTMLElement
    const order = [...row.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'))
    expect(order).toEqual(['刷新全部', '管理卡片', '页面设置', '全屏查看货架'])
    // 终端图标在最后
    expect(row.lastElementChild).toBe(screen.getByTestId('terminal'))
  })

  it('页签收在工具条里，页面设置 / 全屏在顶栏', async () => {
    renderPage(fakeTransport({ fishList: async () => shopOf([GOOD]) }))
    await screen.findByRole('button', { name: '生命水晶' })

    expect(screen.getByTestId('fish-tab-all')).toBeTruthy()
    expect(screen.getByTestId('fish-tab-bought')).toBeTruthy()
    expect(screen.getByTestId('fish-tab-favorite')).toBeTruthy()
    // 搜索框旁边不再有「最近购买」徽标（记录在「买过」页签里）
    expect(screen.queryByTestId('fish-recent-buys')).toBeNull()

    // 全屏：点开铺满（右列收起），Esc 退出
    fireEvent.click(screen.getByRole('button', { name: '全屏查看货架' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '退出全屏' })).toBeTruthy())
    expect(screen.getByTestId('fish-side').className).toContain('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: '全屏查看货架' })).toBeTruthy())
  })

  it('执行「重载配置」卡片后自动重拉一次货架', async () => {
    localStorage.setItem('tswui:fishCards:hidden', JSON.stringify({ reload: false }))
    const fishList = vi.fn(async () => shopOf([GOOD]))
    const runCommand = vi.fn(async () => ({ status: 'ok' as const, output: ['[fishshop]鱼店配置已重载'] }))
    renderPage(fakeTransport({ fishList, runCommand }))
    await screen.findByRole('button', { name: '生命水晶' })
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(1))

    // 卡片自己那个按钮（手动执行的卡片不会被「刷新全部」带上，按钮是 ▶「执行」）
    const title = await screen.findByText('重载配置')
    let card = title.parentElement
    while (card && !within(card).queryByRole('button', { name: '执行' })) card = card.parentElement
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '执行' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/fish reload'))
    // 重载完货架已经变了：自动再拉一次，不用手点刷新
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(2))
  })

  it('顶栏「刷新全部」同时刷新货架（输入框里不再有刷新按钮）', async () => {
    const fishList = vi.fn(async () => shopOf([GOOD]))
    renderPage(fakeTransport({ fishList }))
    await screen.findByRole('button', { name: '生命水晶' })
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: '刷新全部' }))
    await waitFor(() => expect(fishList).toHaveBeenCalledTimes(2))
  })
})

describe('FishShopPage 表格视图与广告', () => {
  // 词缀 81 = 传奇（测试数据集里唯一的词缀）
  const PREFIXED: FishGood = {
    ...GOOD,
    serial: 78,
    id: 1569,
    name: '吸血鬼刀',
    icon: '[i/p81:1569]',
    desc: '[i/p81:1569] 吸血鬼刀',
  }

  it('表格视图：名称列带词缀（琥珀色 + 商品名）', async () => {
    // 货架视图偏好存在 `moduleState` 里（key = serverId → moduleId → 状态）
    localStorage.setItem(
      'tswui:moduleState',
      JSON.stringify({ default: { store: { tableView: true } } }),
    )
    renderPage(fakeTransport({ fishList: async () => shopOf([PREFIXED]) }))
    const row = (await screen.findByText('吸血鬼刀')).closest('tr')!
    // 词缀写在商品名前面、warning 色（与网格格子同一套）
    expect(within(row).getByText('传奇').className).toContain('text-warning')
  })

  it('详情左下角「广告到游戏内」：发 `#序号 [tag] = [价格]`', async () => {
    const sendChat = vi.fn().mockResolvedValue({ name: 'Alice', text: 'x', line: '[WebUI] Alice: x' })
    renderPage(fakeTransport({ fishList: async () => shopOf([PREFIXED]), sendChat }))
    fireEvent.click(await screen.findByRole('button', { name: '吸血鬼刀' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: '广告到游戏内' }))
    await waitFor(() =>
      expect(sendChat).toHaveBeenCalledWith('#78 [i/p81:1569] = [i/s2:73] 2 金币'),
    )
  })
})
