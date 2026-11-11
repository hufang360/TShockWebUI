import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { resetDataIdState } from '@/lib/dataIdState'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import type { Dataset } from '@/types'
import { DataIdPage } from './DataIdPage'

function renderPage(
  dataset: Dataset = makeDataset(),
  lang: 'zh' | 'en' = 'zh',
  /** 已登录玩家名；不传 = 未登录。页面**不探测权限**，只按用户名决定能不能拼 `/gbuff`。 */
  username: string | null = null,
) {
  return render(
    <I18nProvider lang={lang}>
      <DatasetProvider value={dataset}>
        <DataIdPage username={username} />
      </DatasetProvider>
    </I18nProvider>,
  )
}

/** 夹具里再补一只小动物，便于验证分类筛选。 */
function withBunny(): Dataset {
  const base = makeDataset()
  const bunny = { id: 46, key: 'Bunny', name: '兔子' }
  return {
    ...base,
    npcs: [...base.npcs, bunny],
    npcsById: new Map([...base.npcsById, [46, bunny]]),
  }
}

describe('DataIdPage', () => {
  function openSettings() {
    if (!screen.queryByTestId('dataid-settings-popover')) {
      fireEvent.click(screen.getByRole('button', { name: /页面设置|Page settings/ }))
    }
    return screen.getByTestId('dataid-settings-popover')
  }

  function enableTable() {
    const popover = openSettings()
    fireEvent.click(within(popover).getByRole('checkbox', { name: '表格视图' }))
  }

  function selectNpcCategory(name: string) {
    fireEvent.mouseDown(within(screen.getByTestId('npc-category-tabs')).getByRole('tab', { name }))
  }

  /**
   * 第 n 张表的表头文字。列名统一是 `ID`（不带 NPCID / TileID / WallID / BuffID 前缀），
   * 且列名个数必须等于行里的单元格个数（表头与列一一对应，见 `colgroup`）。
   */
  function headers(index = 0): string[] {
    const table = screen.getAllByRole('table')[index]!
    return within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim() ?? '')
  }

  /** `colgroup` 的 `<col>` 个数（`table-fixed` 下决定列宽；与表头数量必须一致）。 */
  function columnCount(index = 0): number {
    const table = screen.getAllByRole('table')[index]!
    return table.querySelectorAll('colgroup > col').length
  }

  beforeEach(() => {
    window.localStorage.clear()
    resetDataIdState()
    // 「两列表格」只在 xl（≥1280px）可用：默认按大屏跑，小屏用例再单独改小。
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  })

  it('默认展示 NPC 网格（名称 + ID），进入即聚焦搜索框', () => {
    renderPage()
    expect(screen.getByTitle('蓝史莱姆 #1')).toBeTruthy()
    expect(screen.getByTitle('克苏鲁之眼 #4')).toBeTruthy()
    expect(screen.getByText(/\d+ 条结果/)).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('数据 ID'))
    // 数据源是 shadcn Tabs（role=tablist），下划线样式，且位于工具条最顶部
    const tablist = screen.getByRole('tablist', { name: 'NPC / 图格 / 墙 / Buff' })
    expect(tablist).toBeTruthy()
    // 主 Tab 与工具行都不套卡片：搜索、结果数、NPC 分类和右侧页面操作直接铺在页面上。
    expect(document.querySelector('[data-slot="card"]')).toBeNull()
    expect(tablist.closest('[data-slot="card"]')).toBeNull()
    // Tab 是第一行，搜索框位于其后。
    expect(
      tablist.compareDocumentPosition(screen.getByLabelText('数据 ID')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const categoryTabs = screen.getByTestId('npc-category-tabs')
    expect(categoryTabs).toBeTruthy()
    expect(categoryTabs.className).toContain('bg-accent')
    // 页面设置 / 全屏在顶栏右侧（见 AppShell 的 TopBarActions），不再占工具行。
    expect(screen.getByRole('button', { name: '页面设置' })).toBeTruthy()
    // 默认图标视图（表格视图未勾选），视图选项收进页面设置；不再有底部翻页器。
    const popover = openSettings()
    expect(within(popover).getByRole('checkbox', { name: '表格视图' }).getAttribute('data-state')).toBe(
      'unchecked',
    )
    expect(within(popover).getByText('参考数据')).toBeTruthy()
    expect(within(popover).getByRole('button', { name: '导出表格' })).toBeTruthy()
    expect(screen.queryByTestId('dataid-pager')).toBeNull()
  })

  it('页面设置可隐藏图标格里的 ID 与名称', () => {
    renderPage()
    const cell = screen.getByTitle('蓝史莱姆 #1')
    expect(within(cell).getByText('蓝史莱姆')).toBeTruthy()
    // 图标下方仍是原来的两行：ID 一行（不带 `#`）、名称一行。
    expect(within(cell).getByText('1')).toBeTruthy()

    openSettings()
    const cb = screen.getByLabelText('隐藏 ID 和名称')
    fireEvent.click(cb)
    expect(cb.getAttribute('data-state')).toBe('checked')
    const hidden = screen.getByTitle('蓝史莱姆 #1')
    expect(within(hidden).queryByText('蓝史莱姆')).toBeNull()
    expect(within(hidden).queryByText('1')).toBeNull()
    // 只留图标：格子宽度仍是 72（`w-18`）。
    expect(hidden.className).toContain('w-18')
  })

  it('全屏时隐藏搜索和 Tabs，只保留页面设置 / 退出按钮，图标铺满水平宽度', () => {
    renderPage()
    const page = screen.getByTestId('dataid-page')
    fireEvent.click(screen.getByRole('button', { name: '全屏查看结果' }))
    expect(page.className).toContain('fixed')
    expect(page.className).toContain('inset-0')
    expect(screen.queryByLabelText('数据 ID')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'NPC / 图格 / 墙 / Buff' })).toBeNull()
    expect(screen.getByRole('button', { name: '页面设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeTruthy()
    const grid = screen.getByTestId('dataid-list').querySelector<HTMLElement>('.grid')
    expect(grid?.className).toContain('repeat(auto-fill')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(page.dataset.fullscreen).toBeUndefined()
    expect(screen.getByRole('tablist', { name: 'NPC / 图格 / 墙 / Buff' })).toBeTruthy()
  })

  it('页面设置中的 Wiki 链接按数据源与语言切换', () => {
    renderPage()
    const wiki = within(openSettings()).getByTestId('dataid-wiki')
    expect(within(wiki).getByRole('link', { name: 'NPC ID' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/zh/wiki/NPC_ID',
    )
    const dataLink = within(wiki).getByRole('link', { name: '数据 ID' })
    expect(dataLink.getAttribute('href')).toBe(
      'https://terraria.wiki.gg/zh/wiki/%E6%95%B0%E6%8D%AE_ID',
    )
    const npcLink = within(wiki).getByRole('link', { name: 'NPC ID' })
    expect(dataLink.compareDocumentPosition(npcLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('dataid-wiki-separator')).toBeTruthy()
    for (const name of ['图格 ID', '墙 ID', '增益 ID']) {
      expect(within(wiki).getByRole('link', { name })).toBeTruthy()
    }
    expect(within(openSettings()).getByText('图格ID 部分有子ID数据')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    expect(within(openSettings()).getByRole('link', { name: '图格 ID' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/zh/wiki/%E5%9B%BE%E6%A0%BC_ID',
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Buff' }))
    expect(within(openSettings()).getByRole('link', { name: '增益 ID' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/zh/wiki/%E5%A2%9E%E7%9B%8A_ID',
    )
  })

  it('英文界面使用英文 Wiki 链接', () => {
    renderPage(makeDataset(), 'en')
    expect(within(openSettings()).getByRole('link', { name: 'NPC IDs' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/wiki/NPC_IDs',
    )
    expect(within(openSettings()).getByRole('link', { name: 'Data IDs' }).getAttribute('href')).toBe(
      'https://terraria.wiki.gg/wiki/Data_IDs',
    )
  })

  it('Boss 筛选只留可 /sb 的 NPC', () => {
    renderPage()
    selectNpcCategory('Boss')
    expect(screen.queryByTitle('蓝史莱姆 #1')).toBeNull()
    expect(screen.getByTitle('克苏鲁之眼 #4')).toBeTruthy()
  })

  it('Boss 筛选包含没有 /sb 的多段 Boss id', () => {
    const base = makeDataset()
    const part = { id: 396, key: 'BossPart', name: 'BossPart' }
    renderPage({
      ...base,
      npcs: [...base.npcs, part],
      npcsById: new Map([...base.npcsById, [396, part]]),
    })
    selectNpcCategory('Boss')
    expect(screen.getByTitle('BossPart #396')).toBeTruthy()
  })

  it('440 / 565 / 577 不再归入 Boss 分类', () => {
    const base = makeDataset()
    const removedIds = [440, 565, 577]
    const extras = removedIds.map((id) => ({ id, key: `Npc${id}`, name: `NPC ${id}` }))
    renderPage({
      ...base,
      npcs: [...base.npcs, ...extras],
      npcsById: new Map([...base.npcsById, ...extras.map((npc) => [npc.id, npc] as const)]),
    })
    selectNpcCategory('Boss')
    for (const id of removedIds) {
      expect(screen.queryByTitle(`NPC ${id} #${id}`)).toBeNull()
    }
  })

  it('网格里的贴图绘制区：默认 64×64，切到 Boss 翻倍到 128×128', () => {
    renderPage()
    const cell = screen.getByTitle('蓝史莱姆 #1')
    const canvas = cell.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.width).toBe('64px')
    expect(canvas.style.height).toBe('64px')

    selectNpcCategory('Boss')
    const bossCanvas = screen.getByTitle('克苏鲁之眼 #4').querySelector('canvas') as HTMLCanvasElement
    expect(bossCanvas.style.width).toBe('128px')
    expect(bossCanvas.style.height).toBe('128px')
  })

  it('分类筛选：小动物只显示小动物', () => {
    renderPage(withBunny())
    expect(screen.getByTitle('兔子 #46')).toBeTruthy()
    selectNpcCategory('小动物')
    expect(screen.getByTitle('兔子 #46')).toBeTruthy()
    expect(screen.queryByTitle('蓝史莱姆 #1')).toBeNull()
    expect(screen.queryByTitle('克苏鲁之眼 #4')).toBeNull()
  })

  it('图格 / 墙默认图标网格；勾选「表格视图」后用表格', () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    expect(screen.getByTitle('Dirt #0')).toBeTruthy()
    expect(screen.getByTitle('Trees #5')).toBeTruthy()
    expect(screen.getByTitle('生命水晶 #1')).toBeTruthy()
    // 默认图标网格：没有表格
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByTitle('生命水晶 #1').querySelector('canvas')).toBeTruthy()

    enableTable()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('图标')).toBeTruthy()
    expect(screen.getByText('内部名')).toBeTruthy()

    enableTable()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '墙' }))
    expect(screen.getByTitle('生命水晶 #1')).toBeTruthy()
    expect(screen.queryByTitle('Dirt #0')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    enableTable()
    expect(headers()).toEqual(['ID', '图标', '名称', '内部名'])
    expect(columnCount()).toBe(4)
  })

  it('切到 Buff：默认图标网格；勾选「表格视图」后可用表格', async () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Buff' }))
    expect(screen.getByTitle('黑曜石皮 #1')).toBeTruthy()
    expect(screen.getByTitle('再生 #2')).toBeTruthy()
    // 图标来自 `data/buff-atlas.png`（`BuffIcon` 画 canvas），网格图标 64×64
    const canvas = screen.getByTitle('黑曜石皮 #1').querySelector('canvas') as HTMLCanvasElement
    expect(canvas).toBeTruthy()
    expect(canvas.style.width).toBe('64px')
    expect(canvas.style.height).toBe('64px')
    expect(screen.queryByRole('table')).toBeNull()

    enableTable()
    expect(headers()).toEqual(['ID', '图标', '名称', '内部名'])
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('Buff 图标不再显示 hover 提示，点击打开右侧抽屉并放大图标', async () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Buff' }))
    const cell = screen.getByTitle('黑曜石皮 #1')
    fireEvent.mouseOver(cell.querySelector('canvas')!)
    expect(screen.queryByTestId('dataid-popover')).toBeNull()

    fireEvent.click(cell)
    const drawer = await screen.findByTestId('dataid-detail')
    expect(drawer.getAttribute('data-kind')).toBe('buff')
    const canvas = drawer.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.width).toBe('128px')
    expect(canvas.style.height).toBe('128px')
  })

  it('Buff 搜索按名称 / 内部名 / ID 过滤，历史与图格分开记', async () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Buff' }))
    fireEvent.change(screen.getByLabelText('数据 ID'), { target: { value: '再生' } })
    await waitFor(() => expect(screen.queryByTitle('黑曜石皮 #1')).toBeNull())
    expect(screen.getByTitle('再生 #2')).toBeTruthy()
    await waitFor(() =>
      expect(window.localStorage.getItem('tswui:buffs:searchHistory')).toContain('再生'),
    )
    expect(window.localStorage.getItem('tswui:tiles:searchHistory') ?? '').not.toContain('再生')
  })

  it('图格行多时大屏排成两张表（列少，缩短页面）', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i, key: `Tile${i}`, item: null }))
    const ds = makeDataset({
      tiles: {
        meta: { gameVersion: '1.4.5.8', count: 10, withItem: 0, source: 'test', generatedBy: 'test', note: '' },
        entries,
      },
    })
    renderPage(ds)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    enableTable()
    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.getByTitle('Tile0 #0')).toBeTruthy()
    expect(screen.getByTitle('Tile9 #9')).toBeTruthy()
  })

  it('搜索按名称 / 内部名 / ID 过滤当前数据源', async () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    fireEvent.change(screen.getByLabelText('数据 ID'), { target: { value: '生命' } })
    await waitFor(() => expect(screen.queryByTitle('Dirt #0')).toBeNull())
    expect(screen.getByTitle('生命水晶 #1')).toBeTruthy()
  })

  it('NPC 图标不再显示 hover 提示，点击打开右侧抽屉并放大图标', async () => {
    renderPage()
    const cell = screen.getByTitle('克苏鲁之眼 #4')
    fireEvent.mouseOver(cell.querySelector('canvas')!)
    expect(screen.queryByTestId('dataid-popover')).toBeNull()

    fireEvent.click(cell)
    const drawer = await screen.findByTestId('dataid-detail')
    expect(drawer.getAttribute('data-kind')).toBe('npc')
    const canvas = drawer.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.width).toBe('128px')
    expect(canvas.style.height).toBe('128px')
    expect(within(drawer).queryByText('Boss')).toBeNull()
    // Boss 详情里的相关指令现在含 `/sb all`（召唤所有 Boss）。
    expect(within(drawer).getByText('/sb all')).toBeTruthy()
  })

  it('NPC 表格视图：列名是 ID，整行可点打开抽屉', () => {
    renderPage()
    enableTable()
    // 最后一列是**英文名**（`/sb`、`/tpnpc` 认的名字），不是对人没用的内部名
    expect(headers()).toEqual(['ID', '图标', '名称', '英文名'])
    expect(columnCount()).toBe(4)
    expect(screen.getByRole('table')).toBeTruthy()
    // 表格视图图标不加背景框（网格视图仍保留）。
    expect(screen.getByTestId('dataid-list').querySelector('[class*="bg-muted/50"]')).toBeNull()
    // 行本身可点（指针变手型）：点行即开右侧抽屉，不再需要行尾的「眼睛」按钮。
    const row = screen.getByTitle('克苏鲁之眼 #4')
    expect(row.tagName).toBe('TR')
    expect(row.className).toContain('cursor-pointer')
    expect(within(row).queryByRole('button')).toBeNull()
    fireEvent.click(row)
    expect(screen.getByTestId('dataid-detail').getAttribute('data-kind')).toBe('npc')
  })

  it('点图格打开右侧抽屉：内部名 / 代表物品 / 尺寸', async () => {
    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    fireEvent.click(screen.getByTitle('生命水晶 #1'))
    await waitFor(() => expect(screen.getByTestId('dataid-detail')).toBeTruthy())
    const detail = screen.getByTestId('dataid-detail')
    expect(detail.getAttribute('data-kind')).toBe('tile')
    expect(within(detail).getByText('图格详情')).toBeTruthy()
    expect(within(detail).getByText('Stone')).toBeTruthy()
    expect(within(detail).getByText('生命水晶 #29')).toBeTruthy()
    expect(within(detail).getByText('3×2')).toBeTruthy()
    expect(within(detail).getByText('多格')).toBeTruthy()
  })

  it('切到别的页面再回来（组件重新挂载）：详情抽屉还开着', async () => {
    const first = renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    await screen.findByTestId('dataid-detail')
    first.unmount()

    renderPage()
    const detail = await screen.findByTestId('dataid-detail')
    expect(within(detail).getByText('克苏鲁之眼')).toBeTruthy()
  })

  it('关掉详情后切走再回来，不会再弹出来', async () => {
    const first = renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    const detail = await screen.findByTestId('dataid-detail')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('dataid-detail')).toBeNull())
    expect(detail).toBeTruthy()
    first.unmount()

    renderPage()
    expect(screen.queryByTestId('dataid-detail')).toBeNull()
  })

  it('详情遮罩只盖内容区：点遮罩关闭，点页面别处不关', async () => {
    renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    await screen.findByTestId('dataid-detail')

    // 自带的全屏遮罩不再渲染，换成只盖内容区的 `ContentScrim`（左侧边栏露着、可点）。
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    const scrim = screen.getByTestId('dataid-detail-scrim')
    expect(scrim.className).toContain('md:left-[var(--content-left,0px)]')
    expect(scrim.className).toContain('bg-black/50')

    // 点页面别处不关（点导航是切页，不是关详情）
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    expect(screen.getByTestId('dataid-detail')).toBeTruthy()

    fireEvent.click(scrim)
    await waitFor(() => expect(screen.queryByTestId('dataid-detail')).toBeNull())
  })

  it('NPC 详情：相关指令不探测权限；传送 / 改名只给城镇 NPC', async () => {
    // 未登录也照样显示（页面不调 /api/me，不把权限当展示门槛）。
    renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    const detail = await screen.findByTestId('dataid-detail')
    // 标题带条目数量。
    expect(await within(detail).findByText('相关指令（4）')).toBeTruthy()
    // Boss：完整写法 + 单字简写 + 召唤全部；两种写法共用一个属性名，不再各占一块。
    expect(within(detail).getByText('/spawnboss "eye of cthulhu"')).toBeTruthy()
    expect(within(detail).getByText('/sb eoc')).toBeTruthy()
    expect(within(detail).getByText('/sb all')).toBeTruthy()
    // `/spawnmob` 写别名 `/sm`。
    expect(within(detail).getByText('/sm 4')).toBeTruthy()
    // Boss 不是城镇 NPC：`/tpnpc`、`/renameNPC` 都不给；也不是「可解救 / 可购买」的 → 没有 `/npc`。
    expect(within(detail).queryByText('/tpnpc "Eye of Cthulhu"')).toBeNull()
    expect(within(detail).queryByText('/renameNPC 4 <newname>')).toBeNull()
    expect(within(detail).queryByText('/npc 4')).toBeNull()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('dataid-detail')).toBeNull())

    // 普通怪（蓝史莱姆）：只剩召唤那一行。
    fireEvent.click(screen.getByTitle('蓝史莱姆 #1'))
    const detail2 = await screen.findByTestId('dataid-detail')
    expect(within(detail2).queryByText('/spawnboss "eye of cthulhu"')).toBeNull()
    expect(within(detail2).getByText('/sm 1')).toBeTruthy()
    expect(within(detail2).queryByText('/tpnpc "Blue Slime"')).toBeNull()
  })

  it('NPC 详情：图标下方是「#4 名称」，英文名在内部名上一行', async () => {
    renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    const detail = await screen.findByTestId('dataid-detail')
    // 图标下方只剩一行：#4 克苏鲁之眼（不再有单独的 NPCID 行）。
    expect(within(detail).getByText('#4')).toBeTruthy()
    expect(within(detail).queryByText(/NPCID/)).toBeNull()
    expect(await within(detail).findByText('英文名')).toBeTruthy()
    expect(within(detail).getByText('Eye of Cthulhu')).toBeTruthy()
  })

  it('NPC 详情：英文界面不再重复显示英文名', async () => {
    renderPage(makeDataset(), 'en')
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    const detail = await screen.findByTestId('dataid-detail')
    expect(await within(detail).findByText('Internal name')).toBeTruthy()
    expect(within(detail).queryByText('English name')).toBeNull()
  })

  it('相关指令的 ⭐ 写进「指令」页的收藏（tswui:favorites）', async () => {
    window.localStorage.removeItem('tswui:favorites')
    renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    const detail = await screen.findByTestId('dataid-detail')
    fireEvent.click(within(detail).getAllByRole('button', { name: '收藏这条指令' })[0])
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('tswui:favorites') ?? '[]')
      expect(saved[0]?.cmd).toBe('/spawnboss "eye of cthulhu"')
    })
  })

  it('NPC 详情：城镇 NPC 才有 /tpnpc 与 /renameNPC；可解救的再多一条 /npc', async () => {
    const base = makeDataset()
    const angler = { id: 369, key: 'Angler', name: '渔夫', en: 'Angler' }
    renderPage({
      ...base,
      npcs: [...base.npcs, angler],
      npcsById: new Map([...base.npcsById, [369, angler]]),
    })
    fireEvent.click(screen.getByTitle('渔夫 #369'))
    const detail = await screen.findByTestId('dataid-detail')
    expect(await within(detail).findByText('/npc 369')).toBeTruthy()
    expect(within(detail).getByText('/tpnpc Angler')).toBeTruthy()
    // 渔夫是城镇 NPC → 也有改名（用 ID，避免 `Bunny` / `Golfer` 这类重名改错人）。
    expect(within(detail).getByText('/renameNPC 369 <newname>')).toBeTruthy()
  })

  it('相关指令：点条目本身不复制，只有复制图标才复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    const detail = await screen.findByTestId('dataid-detail')

    // 分组标题是折叠触发器（不是灰底框），条目本身没有任何角色 / 点击行为。
    const label = within(detail).getByText('相关指令（4）')
    expect(label.className).not.toContain('bg-accent')

    // Boss：召唤 2 行 + /sb all + NPC 召唤 = 4 行（各带 终端 / ⭐ / 复制）。
    const rows = within(detail).getAllByTestId('command-row')
    expect(rows).toHaveLength(4)
    fireEvent.click(rows[1])
    expect(writeText).not.toHaveBeenCalled()

    expect(within(detail).getAllByRole('button', { name: '复制' })).toHaveLength(4)
    fireEvent.click(within(rows[1]).getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/sb eoc'))
    fireEvent.click(within(rows[0]).getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/spawnboss "eye of cthulhu"'))
  })

  it('NPC 详情：点「填充指令」后关掉抽屉（浮动终端在抽屉下面）', async () => {
    renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    const detail = await screen.findByTestId('dataid-detail')
    fireEvent.click(within(detail).getAllByRole('button', { name: '填充指令' })[0])
    await waitFor(() => expect(screen.queryByTestId('dataid-detail')).toBeNull())
  })

  it('Buff 详情：知道玩家名就显示 /gbuff <玩家> <buffID>（不探测权限）', async () => {
    renderPage(makeDataset(), 'zh', 'Alice')

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Buff' }))
    fireEvent.click(await screen.findByTitle('再生 #2'))
    const detail = await screen.findByTestId('dataid-detail')
    expect(await within(detail).findByText('相关指令（1）')).toBeTruthy()
    expect(within(detail).getByText('/gbuff Alice 2')).toBeTruthy()
  })

  it('Buff 详情：未登录（不知道玩家名）时不给 /gbuff', async () => {
    renderPage()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Buff' }))
    fireEvent.click(await screen.findByTitle('再生 #2'))
    const detail = await screen.findByTestId('dataid-detail')
    expect(await within(detail).findByText('内部名')).toBeTruthy()
    expect(within(detail).queryByText('相关指令')).toBeNull()
  })

  it('表格行整行可点（指针手型），行内不再有详情按钮；键盘也能开抽屉', () => {
    renderPage()
    enableTable()
    const row = screen.getByTitle('蓝史莱姆 #1')
    expect(row.className).toContain('cursor-pointer')
    expect(within(row).queryByRole('button')).toBeNull()
    fireEvent.click(row)
    expect(screen.getByTestId('dataid-detail')).toBeTruthy()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('dataid-detail')).toBeNull()
    // Enter / 空格同样能打开（行可聚焦）。
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByTestId('dataid-detail')).toBeTruthy()
  })

  it('最近搜索：聚焦不弹，打字才弹；清空后可用历史按钮打开并点回搜', async () => {
    window.localStorage.setItem('tswui:npcs:searchHistory', JSON.stringify(['史莱姆']))
    renderPage()
    const input = screen.getByLabelText('数据 ID') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    // 进入页面即聚焦，但「最近搜索」不该自己弹出来
    expect(screen.queryByTestId('search-history-item')).toBeNull()

    // 打字时才出现建议（边输边筛）
    fireEvent.change(input, { target: { value: '史' } })
    const item = await screen.findByTestId('search-history-item')
    expect(item.textContent).toBe('史莱姆')

    // 清空收起；点输入框里的历史按钮重新打开
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(input.value).toBe('')
    expect(screen.queryByTestId('search-history-item')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '最近搜索' }))
    fireEvent.click(await screen.findByTestId('search-history-item'))
    expect(input.value).toBe('史莱姆')
  })

  it('搜索词进最近搜索（按数据源分开记）', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('数据 ID'), { target: { value: '兔子' } })
    await waitFor(() =>
      expect(window.localStorage.getItem('tswui:npcs:searchHistory')).toContain('兔子'),
    )
    // 切到图格：搜索框清空，也不会把 NPC 的词记进图格历史
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    const input = screen.getByLabelText('数据 ID') as HTMLInputElement
    expect(input.value).toBe('')
    await new Promise((r) => setTimeout(r, 250))
    expect(window.localStorage.getItem('tswui:tiles:searchHistory') ?? '').not.toContain('兔子')

    fireEvent.change(input, { target: { value: 'Stone' } })
    await waitFor(() =>
      expect(window.localStorage.getItem('tswui:tiles:searchHistory')).toContain('Stone'),
    )
    expect(window.localStorage.getItem('tswui:npcs:searchHistory')).toContain('兔子')
  })

  it('图格：多样式显示计数；详情列出子 ID，可展开为行并搜索 21-1', async () => {
    const chest = { id: 48, key: 'Chest', name: '木箱', icon: 48, frames: 1, sprite: [16, 16] as [number, number], tags: [] }
    const goldChest = { id: 306, key: 'GoldChest', name: '金箱', icon: 306, frames: 1, sprite: [16, 16] as [number, number], tags: [] }
    const container = {
      id: 21,
      key: 'Containers',
      item: 48,
      size: [2, 2] as [number, number],
      styles: [
        { subId: 0, item: 48 },
        { subId: 1, item: 306 },
      ],
    }
    const ds = makeDataset({
      items: [chest, goldChest],
      tiles: {
        meta: { gameVersion: '1.4.5.8', count: 1, withItem: 1, source: 'test', generatedBy: 'test', note: '' },
        entries: [container],
      },
      tilesById: new Map([[21, container]]),
    })
    renderPage(ds)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    expect(screen.getByText('2 种')).toBeTruthy()

    // 详情抽屉列出子 ID
    fireEvent.click(screen.getByTitle('木箱 #21'))
    const styles = screen.getByTestId('dataid-styles')
    expect(within(styles).getByText('21-0')).toBeTruthy()
    expect(within(styles).getByText('木箱')).toBeTruthy()
    expect(within(styles).getByText('21-1')).toBeTruthy()
    expect(within(styles).getByText('金箱')).toBeTruthy()

    // 关掉抽屉后展开子 ID → 每个样式一行
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(openSettings()).getByTestId('dataid-expand-styles'))
    expect(screen.getByTitle('木箱 #21-0')).toBeTruthy()
    expect(screen.getByTitle('金箱 #21-1')).toBeTruthy()

    // 搜索子 ID
    fireEvent.change(screen.getByLabelText('数据 ID'), { target: { value: '21-1' } })
    await waitFor(() => expect(screen.queryByTitle('木箱 #21-0')).toBeNull())
    expect(screen.getByTitle('金箱 #21-1')).toBeTruthy()
  })

  it('列名统一是 ID（图格多一列尺寸）；尺寸列只显示非 1×1', () => {
    const ds = makeDataset({
      tiles: {
        meta: { gameVersion: '1.4.5.8', count: 3, withItem: 2, source: 't', generatedBy: 't', note: '' },
        entries: [
          { id: 0, key: 'Dirt', item: null },
          { id: 10, key: 'DoorClosed', item: 25, size: [1, 3] },
          { id: 12, key: 'Heart', item: 29, size: [1, 1] },
        ],
      },
    })
    renderPage(ds)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    enableTable()
    expect(headers()).toEqual(['ID', '图标', '名称', '尺寸', '内部名'])
    expect(columnCount()).toBe(5)
    expect(screen.getByText('尺寸')).toBeTruthy()
    expect(screen.getByText('1×3')).toBeTruthy()
    // 1×1 不显示
    expect(screen.queryByText('1×1')).toBeNull()

    fireEvent.mouseDown(screen.getByRole('tab', { name: '墙' }))
    expect(headers()).toEqual(['ID', '图标', '名称', '内部名'])
    expect(columnCount()).toBe(4)
    // 墙没有尺寸列
    expect(screen.queryByText('尺寸')).toBeNull()
  })

  it('「两列表格」 checkbox 默认选中，取消后只剩一张表', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i, key: `Tile${i}`, item: null }))
    const ds = makeDataset({
      tiles: {
        meta: { gameVersion: '1.4.5.8', count: 10, withItem: 0, source: 't', generatedBy: 't', note: '' },
        entries,
      },
    })
    renderPage(ds)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    enableTable()
    const cb = within(openSettings()).getByTestId('dataid-two-cols')
    expect(cb.getAttribute('data-state')).toBe('checked')
    expect(screen.getAllByRole('table')).toHaveLength(2)
    fireEvent.click(cb)
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('NPC 两列表格：受同一个「两列表格」开关控制（行数够多才分两张表）', () => {
    const npcs = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      key: `Npc${i + 1}`,
      name: `NPC${i + 1}`,
      en: `Npc ${i + 1}`,
    }))
    renderPage(makeDataset({ npcs }))
    enableTable()
    expect(screen.getAllByRole('table')).toHaveLength(2)
    fireEvent.click(within(openSettings()).getByTestId('dataid-two-cols'))
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('页面设置「恢复默认」：视图开关回到默认值，打开时焦点不落在它身上', async () => {
    renderPage()
    const popover = openSettings()
    // 打开时焦点给第一个设置项，不是标题栏的「恢复默认」。
    await waitFor(() =>
      expect(document.activeElement).toBe(within(popover).getByTestId('dataid-hide-meta')),
    )

    fireEvent.click(within(popover).getByTestId('dataid-hide-meta'))
    fireEvent.click(within(popover).getByRole('checkbox', { name: '表格视图' }))
    fireEvent.click(within(popover).getByTestId('dataid-two-cols'))
    fireEvent.click(within(popover).getByTestId('dataid-expand-styles'))
    expect(localStorage.getItem('tswui:dataId:hideMeta')).toBe('true')
    expect(within(popover).getByTestId('dataid-two-cols').getAttribute('data-state')).toBe('unchecked')

    fireEvent.click(within(popover).getByRole('button', { name: '恢复默认' }))
    expect(within(popover).getByTestId('dataid-hide-meta').getAttribute('data-state')).toBe('unchecked')
    expect(
      within(popover).getByRole('checkbox', { name: '表格视图' }).getAttribute('data-state'),
    ).toBe('unchecked')
    expect(within(popover).getByTestId('dataid-two-cols').getAttribute('data-state')).toBe('checked')
    expect(
      within(popover).getByTestId('dataid-expand-styles').getAttribute('data-state'),
    ).toBe('unchecked')
    // 表格视图已关 → 回到图标网格
    expect(screen.queryByRole('table')).toBeNull()
    expect(localStorage.getItem('tswui:dataId:hideMeta')).toBe('false')
  })

  it('NPC 表格最后一列是英文名（英文界面下改显示内部名）', () => {
    renderPage()
    enableTable()
    const row = screen.getByTitle('克苏鲁之眼 #4')
    expect(within(row).getByText('Eye of Cthulhu')).toBeTruthy()
    expect(within(row).queryByText('EyeOfCthulhu')).toBeNull()
  })

  it('小屏（<1280px）隐藏「两列表格」开关，表格也只排一列', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i, key: `Tile${i}`, item: null }))
    const ds = makeDataset({
      tiles: {
        meta: { gameVersion: '1.4.5.8', count: 10, withItem: 0, source: 't', generatedBy: 't', note: '' },
        entries,
      },
    })
    renderPage(ds)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    enableTable()
    expect(within(openSettings()).queryByTestId('dataid-two-cols')).toBeNull()
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('记忆页面状态：切走再回来仍是上次的 tab（刷新才重置）', async () => {
    const first = renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '图格' }))
    enableTable()
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    first.unmount()
    // 重新挂载（模拟切页面回来，模块内存还在）
    const second = renderPage()
    expect(screen.getByRole('table')).toBeTruthy()
    second.unmount()
    // 重置后（模拟刷新页面）回到默认 NPC
    resetDataIdState()
    renderPage()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByTitle('蓝史莱姆 #1')).toBeTruthy()
  })
})
