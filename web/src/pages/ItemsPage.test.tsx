import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import type { Item } from '@/types'
import { resetDexState } from '@/lib/dexState'
import { ItemsPage } from './ItemsPage'

function makeItem(id: number): Item {
  return {
    id,
    key: `Item${id}`,
    name: `物品${id}`,
    icon: id,
    frames: 1,
    sprite: [16, 16],
    tags: [],
  }
}

const makeItems = (count: number): Item[] =>
  Array.from({ length: count }, (_, i) => makeItem(i + 1))

function renderPage(items: Item[] | ReturnType<typeof makeDataset>, opts: { keepMode?: boolean } = {}) {
  const dataset = Array.isArray(items) ? makeDataset({ items }) : items
  const utils = render(
    <I18nProvider lang="zh">
      <ItemsPage dataset={dataset} />
    </I18nProvider>,
  )
  // 默认就是「全部物品」；显式点一次，顺便清掉上一次测试可能留下的筛选。
  if (!opts.keepMode) fireEvent.click(screen.getByTestId('dex-mode-all'))
  return utils
}

/** 格子里的图标按钮（用 aria-label = 物品名定位）。 */
const cell = (name: string) => screen.getByRole('button', { name })
const detail = () => screen.getByTestId('dex-detail')
const gridIcons = () => within(screen.getByTestId('dex-list')).getAllByRole('img')

/**
 * 通过**小图标的提示**打开某物品的详情（小图标本身不可点）：悬停图标 → 点提示底部的「合成表」。
 * `scope` 用来限定在某一层抽屉里找那一行配方。
 */
async function openFromRecipeRowTip(name: string, scope: HTMLElement) {
  const row = within(scope).getAllByTestId('recipe-row')[0]
  const icon = within(row).getByRole('img', { name })
  fireEvent.mouseOver(icon)
  const tip = await screen.findByRole('tooltip')
  fireEvent.click(within(tip).getByRole('button', { name: '合成表' }))
}

/** 点「分组」按钮打开侧抽屉。 */
function openGroupDrawer() {
  fireEvent.click(screen.getByLabelText('分组'))
}

/** 直接点分组抽屉里的具体集合（自动展开所属分区，并切到该分组）。 */
function chooseCollection(name: string | RegExp, group: string) {
  openGroupDrawer()
  if (screen.queryAllByRole('button', { name }).length === 0) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${group}`) }))
  }
  fireEvent.click(screen.getAllByRole('button', { name })[0])
}

beforeEach(() => {
  resetDexState()
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

describe('ItemsPage 图鉴', () => {
  it('进入页面自动聚焦搜索框', () => {
    renderPage(makeItems(5))
    expect(document.activeElement).toBe(screen.getByLabelText('物品ID'))
  })

  it('手机进入页面不自动聚焦搜索框', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    renderPage(makeItems(5))
    expect(document.activeElement).not.toBe(screen.getByLabelText('物品ID'))
  })

  it('手机默认显示 ID 和名称，开启隐藏设置后只显示图标', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    renderPage(makeItems(5))
    const first = cell('物品1')
    expect(first.style.width).toBe('88px')
    expect(first.style.height).toBe('88px')
    expect((within(first).getByRole('img', { name: '物品1' }) as HTMLCanvasElement).style.width).toBe(
      '56px',
    )
    expect(within(first).getByText('1')).toBeTruthy()
    expect(within(first).getByText('物品1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    fireEvent.click(screen.getByLabelText('隐藏 ID 和名称'))
    expect(cell('物品1').style.width).toBe('68px')
    expect(cell('物品1').style.height).toBe('68px')
    expect(within(cell('物品1')).queryByText('1')).toBeNull()
  })

  it('详情里的提示 ⭐ 可收藏物品（写入 tswui:itemFavorites）', () => {
    localStorage.clear()
    renderPage(makeItems(5))
    fireEvent.click(cell('物品1'))
    fireEvent.click(within(detail()).getByRole('button', { name: '收藏物品' }))
    const saved = JSON.parse(localStorage.getItem('tswui:itemFavorites') ?? '[]')
    expect(saved.map((f: { id: number }) => f.id)).toEqual([1])
  })
  it('focusItemId：进入后选中并弹出详情，消费后回调 onFocusConsumed', async () => {
    const dataset = makeDataset({ items: makeItems(10) })
    const onFocusConsumed = vi.fn()
    render(
      <I18nProvider lang="zh">
        <ItemsPage dataset={dataset} focusItemId={3} onFocusConsumed={onFocusConsumed} />
      </I18nProvider>,
    )
    const dialog = await screen.findByTestId('dex-detail')
    expect(within(dialog).getByText('物品3')).toBeTruthy()
    await waitFor(() => expect(onFocusConsumed).toHaveBeenCalled())
  })
  it('搜索框收窄为 InputGroup：放大镜 + 短占位符', () => {
    renderPage(makeItems(3))
    const input = screen.getByPlaceholderText('物品名称 / ID')
    const group = input.closest('[data-slot="input-group"]')
    expect(group).toBeTruthy()
    expect(group?.querySelector('.lucide-search')).toBeTruthy()
    expect(group?.parentElement?.parentElement?.className).toContain('max-w-sm')
    // 手机工具条分两行：搜索行在上，筛选 / 分组 / 设置行在下。
    const body = document.querySelector('[data-slot="card-body"]')
    expect(body?.className).toContain('flex-col')
    expect(body?.className).toContain('sm:flex-row')
    const count = screen.getByText('3 个结果')
    expect(count.className).not.toContain('ml-auto')
  })

  it('最近搜索只在点按钮时展开，回车收起', () => {
    localStorage.setItem('tswui:dex:searchHistory', JSON.stringify(['物品1']))
    renderPage(makeItems(3))
    const input = screen.getByLabelText('物品ID')
    fireEvent.change(input, { target: { value: '物品1' } })
    // 打字不自动弹出
    expect(screen.queryByTestId('search-history-list')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '最近搜索' }))
    expect(screen.getByTestId('search-history-list')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByTestId('search-history-list')).toBeNull()
  })

  it('鼠标滑过格子图标显示物品提示', async () => {
    renderPage(makeItems(3))
    const canvas = within(cell('物品1')).getByRole('img', { name: '物品1' })
    fireEvent.mouseOver(canvas)
    const tip = await screen.findByRole('tooltip', {}, { timeout: 1200 })
    expect(tip.textContent).toContain('物品1')
    // 图标点一下就能开详情，提示里不再重复「合成表」入口
    expect(within(tip).queryByRole('button', { name: '合成表' })).toBeNull()

    // 点提示文字不能穿透到下方格子打开详情。
    fireEvent.click(within(tip).getByText('物品1'))
    expect(screen.queryByTestId('dex-detail')).toBeNull()

    // 点图标会立即关闭提示并打开详情。
    fireEvent.click(canvas)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByTestId('dex-detail')).toBeTruthy()
  })

  it('取消翻页：全部结果交给虚拟滚动，只显示结果个数', () => {
    renderPage(makeItems(250))
    expect(screen.getByText('250 个结果')).toBeTruthy()
    expect(screen.queryByTestId('dex-pagination')).toBeNull()
    expect(screen.queryByRole('button', { name: '上一页' })).toBeNull()
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull()
    expect(gridIcons()[0].getAttribute('aria-label')).toBe('物品1')
  })

  it('全屏按钮让结果页占满视口，Esc 可退出', () => {
    renderPage(makeItems(10))
    const page = screen.getByTestId('dex-page')
    fireEvent.click(screen.getByRole('button', { name: '全屏查看结果' }))
    expect(page.className).toContain('fixed')
    expect(page.className).toContain('inset-0')
    expect(page.style.height).toBe('100dvh')
    expect(screen.queryByLabelText('物品ID')).toBeNull()
    expect(screen.getByRole('button', { name: '页面设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(page.dataset.fullscreen).toBeUndefined()
    expect(page.style.height).not.toBe('100dvh')
  })

  it('结果个数随筛选更新', () => {
    renderPage(makeItems(1200))
    expect(screen.getByText('1200 个结果')).toBeTruthy()
    chooseCollection(/^1~1000/, 'ID 范围')
    expect(screen.getByText('1000 个结果')).toBeTruthy()
  })

  it('网格虚拟化：只挂可视行，滚动后切片随之下移', async () => {
    renderPage(makeItems(1000))
    const list = screen.getByTestId('dex-list')
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    const grid = list.querySelector<HTMLElement>('.grid')
    expect(grid?.style.gap).toBe('4px')

    // jsdom 无布局 → 10 列 / 560px 兜底、显示文字时行高 110+4=114 → 可视 + overscan 共 6 行
    const first = names()
    expect(first.length).toBe(60)
    expect(first.length).toBeLessThan(1000)

    Object.defineProperty(list, 'scrollTop', { value: 99999, writable: true, configurable: true })
    fireEvent.scroll(list)
    // 滚动更新经 rAF 合并（同一帧只处理一次）
    await waitFor(() => expect(names().length).toBe(10))
    const last = names()
    expect(last.length).toBe(10) // 1000 / 10 列 → 最后一行满 10 个
    expect(last.some((name) => first.includes(name))).toBe(false)
  })

  it('格子默认显示 ID 和名称；开启隐藏后仅显示图标，hover 整格上浮', () => {
    renderPage(makeItems(10))
    let first = cell('物品1')
    const canvas = within(first).getByRole('img', { name: '物品1' }) as HTMLCanvasElement
    expect(canvas.style.width).toBe('64px')
    expect(canvas.style.height).toBe('64px')
    expect(first.style.width).toBe('110px')
    expect(first.style.height).toBe('110px')
    expect(within(first).getByText('1')).toBeTruthy()
    const name = within(first).getByText('物品1')
    expect(name.className).toContain('truncate')

    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    fireEvent.click(screen.getByLabelText('隐藏 ID 和名称'))
    first = cell('物品1')
    expect(first.style.width).toBe('76px')
    expect(first.style.height).toBe('76px')
    expect(within(first).queryByText('1')).toBeNull()

    const surface = within(first).getByTestId('dex-icon-surface')
    expect(first.className).toContain('cursor-pointer')
    expect(first.className).toContain('hover:bg-primary/10')
    expect(first.className).toContain('hover:-translate-y-0.5')
    expect(surface.className).not.toContain('bg-muted/50')
    expect(surface.className).not.toContain('ring-border/50')
  })

  it('详情：默认不显示，点格子后弹出 dialog（tips + 复制 + wiki）', () => {
    renderPage(makeItems(10))
    expect(screen.queryByTestId('dex-detail')).toBeNull()

    fireEvent.click(cell('物品1'))
    const dialog = detail()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.className).toContain('max-w-xl')
    expect(within(dialog).getByText('物品1')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '复制ID' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '复制名称' })).toBeTruthy()
    const side = within(dialog).getByTestId('dex-detail-side')
    const wiki = within(side).getByRole('link', { name: /前往 Wiki/ })
    expect(wiki.getAttribute('href')).toBe(
      'https://terraria.wiki.gg/zh/wiki/' + encodeURIComponent('物品1'),
    )
    // tips：与悬停同一套样式（半透明黑、同宽上限），左下角 ID · key
    const tip = within(dialog).getByTestId('item-tooltip')
    expect(tip.className).toContain('bg-black/85')
    expect(tip.className).toContain('max-w-96')
    expect(within(tip).getByText('1 · Item1')).toBeTruthy()
    // 说明文案已按需求移除
    expect(within(dialog).queryByText(/标签仅用于聊天显示/)).toBeNull()
  })

  it('可堆叠抽屉：在详情里从材料提示的「合成表」再叠一层，返回 / 关闭可逐层退回', async () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        recipes: {
          meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
          groups: {},
          recipes: [
            {
              result: { id: 1, stack: 1 },
              ingredients: [{ id: 2, stack: 1 }],
              station: -1,
              stationItems: [],
              env: [],
              flags: [],
            },
          ],
          byResult: { '1': [0] },
          byIngredient: { '2': [0] },
        },
      }),
    )
    // 根抽屉：物品1
    fireEvent.click(cell('物品1'))
    expect(screen.getAllByTestId('dex-detail')).toHaveLength(1)
    expect(within(detail()).getByTestId('item-tooltip').textContent).toContain('物品1')

    // 材料「物品2」的提示里点「合成表」→ 叠一层新抽屉（父抽屉留在后面）
    await openFromRecipeRowTip('物品2', detail())
    const layers = screen.getAllByTestId('dex-detail')
    expect(layers).toHaveLength(2)
    expect(within(layers[1]).getByTestId('item-tooltip').textContent).toContain('物品2')
    // 只有子层有「返回」，根层没有
    expect(screen.getByTestId('dex-detail-back')).toBeTruthy()
    expect(within(layers[0]).queryByTestId('dex-detail-back')).toBeNull()

    // 返回 → 关掉子层，回到物品1
    fireEvent.click(screen.getByTestId('dex-detail-back'))
    const afterBack = screen.getAllByTestId('dex-detail')
    expect(afterBack).toHaveLength(1)
    expect(within(afterBack[0]).getByTestId('item-tooltip').textContent).toContain('物品1')

    // 右上角 × 关闭根抽屉 → 全部关闭（栈清空）
    fireEvent.click(within(afterBack[0]).getByTestId('dex-detail-close'))
    expect(screen.queryByTestId('dex-detail')).toBeNull()
  })

  it('可堆叠抽屉：右上角 × 直接关掉整个抽屉（不回到上一层）', async () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        recipes: {
          meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
          groups: {},
          recipes: [
            {
              result: { id: 1, stack: 1 },
              ingredients: [{ id: 2, stack: 1 }],
              station: -1,
              stationItems: [],
              env: [],
              flags: [],
            },
          ],
          byResult: { '1': [0] },
          byIngredient: { '2': [0] },
        },
      }),
    )
    fireEvent.click(cell('物品1'))
    await openFromRecipeRowTip('物品2', detail())
    const layers = screen.getAllByTestId('dex-detail')
    expect(layers).toHaveLength(2)

    // 点最上层的 × → 所有层一起关（不是只关当前层）
    fireEvent.click(within(layers[1]).getByTestId('dex-detail-close'))
    expect(screen.queryByTestId('dex-detail')).toBeNull()
  })

  it('可堆叠抽屉：点当前物品自己（配方产物）不会重复叠层', async () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        recipes: {
          meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
          groups: {},
          recipes: [
            {
              result: { id: 1, stack: 1 },
              ingredients: [{ id: 2, stack: 1 }],
              station: -1,
              stationItems: [],
              env: [],
              flags: [],
            },
          ],
          byResult: { '1': [0] },
          byIngredient: { '2': [0] },
        },
      }),
    )
    fireEvent.click(cell('物品1'))
    // 配方行末尾的产物就是当前物品：从它的提示点「合成表」不会重复叠层
    await openFromRecipeRowTip('物品1', detail())
    expect(screen.getAllByTestId('dex-detail')).toHaveLength(1)
  })

  it('大格子点击打开抽屉；配方行里的小图标点击不弹（只有提示里的「合成表」能开）', async () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        recipes: {
          meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
          groups: {},
          recipes: [
            {
              result: { id: 1, stack: 1 },
              ingredients: [{ id: 2, stack: 1 }],
              station: -1,
              stationItems: [],
              env: [],
              flags: [],
            },
          ],
          byResult: { '1': [0] },
          byIngredient: { '2': [0] },
        },
      }),
    )
    // 大图标（查一查结果格子）点击 → 打开抽屉
    fireEvent.click(cell('物品1'))
    expect(screen.getAllByTestId('dex-detail')).toHaveLength(1)

    // 小图标没被包成按钮：点它不会打开/叠加抽屉
    const row = within(detail()).getAllByTestId('recipe-row')[0]
    const chip = within(row).getByRole('img', { name: '物品2' })
    expect(chip.closest('button')).toBeNull()
    fireEvent.click(chip)
    expect(screen.getAllByTestId('dex-detail')).toHaveLength(1)

    // 只有提示底部的「合成表」能再叠一层
    await openFromRecipeRowTip('物品2', detail())
    expect(screen.getAllByTestId('dex-detail')).toHaveLength(2)
  })

  it('抽屉里的 tips 不显示「合成表」入口（指向自己没意义）', () => {
    renderPage(makeItems(3))
    fireEvent.click(cell('物品1'))
    const dialog = detail()
    const tip = within(dialog).getByTestId('item-tooltip')
    expect(within(tip).queryByRole('button', { name: '合成表' })).toBeNull()
    // ID · key 仍在
    expect(within(tip).getByText('1 · Item1')).toBeTruthy()
  })

  it('复制 ID / 名称位于 Wiki 上方，底部不再提供关闭按钮', () => {
    renderPage(makeItems(3))
    fireEvent.click(cell('物品2'))
    const dialog = detail()
    const side = within(dialog).getByTestId('dex-detail-side')
    const copyId = within(side).getByRole('button', { name: '复制ID' })
    const copyName = within(side).getByRole('button', { name: '复制名称' })
    const wiki = within(side).getByRole('link', { name: '前往 Wiki' })
    expect(copyId.className).toContain('bg-primary')
    expect(copyName.className).toContain('border-border')
    expect(copyId.compareDocumentPosition(wiki) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(copyName.compareDocumentPosition(wiki) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(dialog).queryByLabelText('复制内容')).toBeNull()
    expect(within(dialog).getAllByRole('button', { name: '关闭' })).toHaveLength(1)
  })

  it('表格视图支持两列表格与导出按钮', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    renderPage(makeItems(10))
    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    const popover = screen.getByTestId('dex-settings-popover')
    expect(within(popover).getByRole('button', { name: '导出表格' })).toBeTruthy()
    fireEvent.click(within(popover).getByRole('checkbox', { name: '表格视图' }))
    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.getAllByTestId('item-table-icon')[0]!.className).not.toContain('bg-muted/50')

    fireEvent.click(within(popover).getByRole('checkbox', { name: '两列表格' }))
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('分组 Popover：手风琴单开，默认制作界面；有选中时打开选中分区', () => {
    renderPage([makeItem(1), makeItem(987), makeItem(1358), makeItem(2161), makeItem(5000)])
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    expect(names().sort()).toEqual(['物品1', '物品1358', '物品2161', '物品5000', '物品987'])

    openGroupDrawer()
    const close = screen.getAllByRole('button', { name: '关闭' }).find((button) =>
      button.className.includes('w-full'),
    )
    expect(close?.className).toContain('border-border')
    // 五个分区标题都在；默认只展开第一个「制作界面」
    for (const group of ['制作界面', '集合', '职业', '水友专属', 'ID 范围']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${group}`) })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: /^工具/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /🫙 mix/ })).toBeNull()

    // 点「水友专属」标题 → 只展开该区，其他区收起
    fireEvent.click(screen.getByRole('button', { name: /^水友专属/ }))
    expect(screen.queryByRole('button', { name: /^工具/ })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /🫙 mix/ })[0])
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])
    // 选择后 Popover 关闭，按钮显示当前归属
    expect(screen.queryByRole('button', { name: /🫙 mix/ })).toBeNull()
    expect(screen.getByLabelText('分组').textContent).toContain('水友专属')

    // 再次打开：自动展开当前选中的「水友专属」，而不是默认的制作界面
    openGroupDrawer()
    expect(screen.getAllByRole('button', { name: /🫙 mix/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^工具/ })).toBeNull()
  })

  it('分组支持搜索，并在选择后记录最近使用', () => {
    renderPage(makeItems(5))
    openGroupDrawer()
    const search = screen.getByPlaceholderText('搜索页签 / 集合')
    fireEvent.change(search, { target: { value: '工具' } })
    fireEvent.click(
      within(screen.getByTestId('dex-group-search-results')).getAllByRole('button', {
        name: /工具/,
      })[0],
    )
    expect(screen.getByLabelText('分组').textContent).toContain('工具')

    openGroupDrawer()
    expect(screen.getByText('最近使用')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /工具/ }).length).toBeGreaterThan(0)
  })

  it('网格支持方向键导航', () => {
    renderPage(makeItems(30))
    const first = cell('物品1')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cell('物品2'))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell('物品12'))
  })

  it('换选另一分组的集合会替换筛选，并回到顶部', () => {
    renderPage([makeItem(1), makeItem(987), makeItem(1358), makeItem(2161), makeItem(5000)])
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    chooseCollection(/🫙 mix/, '水友专属')
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])

    chooseCollection(/^1~1000/, 'ID 范围')
    expect(names().sort()).toEqual(['物品1', '物品987'])
    expect(screen.getByLabelText('分组').textContent).toContain('ID 范围')
  })

  it('分组：再点已选项取消，× 可清除', () => {
    renderPage([makeItem(1), makeItem(987), makeItem(1358), makeItem(2161), makeItem(5000)])
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    chooseCollection(/🫙 mix/, '水友专属')
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])

    // 再点一次同一个集合 → 取消，回到全部物品
    openGroupDrawer()
    const activeGroup = screen.getByTestId('dex-group-drawer').querySelector<HTMLButtonElement>(
      'button[data-group-active="true"]',
    )
    expect(activeGroup).toBeTruthy()
    fireEvent.click(activeGroup!)
    expect(names().sort()).toEqual(['物品1', '物品1358', '物品2161', '物品5000', '物品987'])
    expect(screen.getByLabelText('分组').textContent).toBe('分组')

    // 选中后按钮旁的 × 直接清除
    chooseCollection(/🫙 mix/, '水友专属')
    fireEvent.click(screen.getByRole('button', { name: '清除分组' }))
    expect(names().sort()).toEqual(['物品1', '物品1358', '物品2161', '物品5000', '物品987'])
    expect(screen.getByLabelText('分组').textContent).toBe('分组')
  })

  it('全部物品再点一次：清空搜索并回到顶部', () => {
    renderPage(makeItems(3))
    const input = screen.getByLabelText('物品ID') as HTMLInputElement
    fireEvent.change(input, { target: { value: '物品1' } })
    expect(input.value).toBe('物品1')
    fireEvent.click(screen.getByTestId('dex-mode-all'))
    expect(input.value).toBe('')
  })

  it('收藏按钮显示收藏数量', () => {
    localStorage.setItem(
      'tswui:itemFavorites',
      JSON.stringify([{ id: 1, ts: 1 }]),
    )
    renderPage(makeItems(3))
    expect(within(screen.getByTestId('dex-favorites-toggle')).getByText('1')).toBeTruthy()
  })

  it('制作界面收进分组抽屉：分区在最前', () => {
    // 29 = 消耗品+材料，75 = 材料，4956 = 武器（见 test/fixtures.ts 的 itemGroups）
    renderPage([makeItem(29), makeItem(75), makeItem(4956)])
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))

    openGroupDrawer()
    // 制作界面是第一个手风琴分区，页签默认展开
    expect(screen.getByRole('button', { name: /^制作界面/ })).toBeTruthy()
    // 没有「全部」页签；尚未进入游戏分组时没有页签处于选中态
    expect(screen.queryByRole('button', { name: '全部' })).toBeNull()
    expect(screen.getByRole('button', { name: /^工具/ }).getAttribute('aria-pressed')).toBe('false')
    // 页签也显示物品数量：武器 1、材料 2
    expect(screen.getByRole('button', { name: /^武器/ }).textContent).toContain('1')
    expect(screen.getByRole('button', { name: /^材料/ }).textContent).toContain('2')

    fireEvent.click(screen.getByRole('button', { name: /^武器/ }))
    expect(names()).toEqual(['物品4956'])
    expect(screen.getByLabelText('分组').textContent).toContain('制作界面')

    // 选页签后 Popover 关闭；重新打开选「材料」
    openGroupDrawer()
    fireEvent.click(screen.getByRole('button', { name: /^材料/ }))
    expect(names().sort()).toEqual(['物品29', '物品75'])
  })

  it('切模块再回来保留界面状态（卸载不重置）；刷新回到默认', () => {
    const items = [makeItem(1), makeItem(987), makeItem(1358), makeItem(2161), makeItem(5000)]
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    const first = renderPage(items)
    chooseCollection(/🫙 mix/, '水友专属')
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])
    first.unmount()

    // 再次挂载 = 切回本模块：集合筛选应被还原（靠模块内存）
    const second = renderPage(items, { keepMode: true })
    expect(screen.getByLabelText('分组').textContent).toContain('水友专属')
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])
    second.unmount()

    // resetDexState 相当于刷新：回到全部物品
    resetDexState()
    renderPage(items, { keepMode: true })
    expect(screen.getByLabelText('分组').textContent).toBe('分组')
    expect(names().sort()).toEqual(['物品1', '物品1358', '物品2161', '物品5000', '物品987'])
  })

  it('⭐ 收藏开关：只显示收藏、受搜索过滤，开启时回到全部物品', async () => {
    localStorage.setItem(
      'tswui:itemFavorites',
      JSON.stringify([
        { id: 75, ts: 2 },
        { id: 29, ts: 1 },
      ]),
    )
    renderPage([makeItem(1), makeItem(29), makeItem(75), makeItem(4956)])
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))

    expect(names().sort()).toEqual(['物品1', '物品29', '物品4956', '物品75'])

    fireEvent.click(screen.getByTestId('dex-favorites-toggle'))
    expect(names().sort()).toEqual(['物品29', '物品75'])
    // 收藏内也支持搜索，但搜索只在收藏范围内
    fireEvent.change(screen.getByLabelText('物品ID'), { target: { value: 'Item75' } })
    await waitFor(() => expect(names()).toEqual(['物品75']))

    // 清空搜索 + 关掉收藏 → 回到全部物品
    fireEvent.change(screen.getByLabelText('物品ID'), { target: { value: '' } })
    await waitFor(() => expect(names().sort()).toEqual(['物品29', '物品75']))
    fireEvent.click(screen.getByTestId('dex-favorites-toggle'))
    expect(names().sort()).toEqual(['物品1', '物品29', '物品4956', '物品75'])
  })

  it('收藏夹为空时提示「收藏夹是空的」（不是「没有匹配的物品」）', () => {
    renderPage(makeItems(5))
    fireEvent.click(screen.getByTestId('dex-favorites-toggle'))
    expect(screen.getByText('收藏夹是空的')).toBeTruthy()
    expect(screen.queryByText('没有匹配的物品')).toBeNull()
  })

  it('收藏有记录但搜索没匹配：提示「没有匹配的物品」', async () => {
    localStorage.setItem('tswui:itemFavorites', JSON.stringify([{ id: 1, ts: 1 }]))
    renderPage(makeItems(5))
    fireEvent.click(screen.getByTestId('dex-favorites-toggle'))
    fireEvent.change(screen.getByLabelText('物品ID'), { target: { value: 'Item999' } })
    await waitFor(() => expect(screen.getByText('没有匹配的物品')).toBeTruthy())
  })

  it('默认进入「全部物品」', () => {
    render(
      <I18nProvider lang="zh">
        <ItemsPage
          dataset={makeDataset({ items: [makeItem(29), makeItem(75), makeItem(4956)] })}
        />
      </I18nProvider>,
    )
    expect(screen.getByTestId('dex-mode-all').getAttribute('data-state')).toBe('on')
    // 制作界面不再占据工具条，只在分组 Popover 里出现
    expect(screen.queryByRole('button', { name: /^制作界面/ })).toBeNull()
  })

  it('搜索与切换筛选都会把网格滚动复位到顶部', () => {
    renderPage(makeItems(500))
    const list = screen.getByTestId('dex-list')
    Object.defineProperty(list, 'scrollTop', { value: 800, writable: true, configurable: true })

    fireEvent.scroll(list)
    expect(list.scrollTop).toBe(800)
    fireEvent.change(screen.getByLabelText('物品ID'), { target: { value: '物品1' } })
    expect(list.scrollTop).toBe(0)

    list.scrollTop = 800
    fireEvent.scroll(list)
    chooseCollection(/^1~1000/, 'ID 范围')
    expect(list.scrollTop).toBe(0)
  })

  it('词缀下拉按评分排序、展示并套用最佳词缀，选中后显示 [i/pXX:ID] 标签', () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        rollablePrefixesById: new Map([[1, [81]]]),
        prefixModsById: new Map([[81, { dmg: 1.15, val: 1.760248 }]]),
      }),
    )
    fireEvent.click(cell('物品1'))
    fireEvent.click(screen.getByLabelText('词缀'))
    // 下拉里带评分；并列最佳标 ⭐
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '无词缀',
      '传奇1.760',
    ])
    fireEvent.click(screen.getByRole('option', { name: /传奇/ }))
    expect(screen.getByText('[i/p81:1]')).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制词缀标签' })).toBeTruthy()
    // 「最佳词缀：传奇」可点击直接套用
    expect(screen.getByText(/最佳词缀：传奇/)).toBeTruthy()
  })

  it('合成表「两列视图」：默认不勾选，勾选后固定两列', () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        recipes: {
          meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
          groups: {},
          recipes: [
            {
              result: { id: 1, stack: 1 },
              ingredients: [{ id: 2, stack: 1 }],
              station: -1,
              stationItems: [],
              env: [],
              flags: [],
            },
          ],
          byResult: { '1': [0] },
          byIngredient: { '2': [0] },
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    const cb = screen.getByLabelText('两列视图')
    expect(cb.getAttribute('data-state')).toBe('unchecked')
    fireEvent.click(cb)
    expect(cb.getAttribute('data-state')).toBe('checked')
    fireEvent.click(cell('物品1'))
    expect(within(detail()).getByText('合成表（1）')).toBeTruthy()
    expect(detail().querySelector('.grid.grid-cols-2')).toBeTruthy()
  })

  it('页面设置 Popover 集中显示三项设置与 info 提示，详情抽屉不再重复', async () => {
    renderPage(makeItems(3))
    fireEvent.click(screen.getByRole('button', { name: '页面设置' }))
    const popover = screen.getByTestId('dex-settings-popover')
    expect(within(popover).getByLabelText('隐藏 ID 和名称').getAttribute('data-state')).toBe('unchecked')
    expect(within(popover).getByText('合成记录')).toBeTruthy()
    expect(within(popover).getByLabelText('显示物品名称')).toBeTruthy()
    expect(within(popover).getByLabelText('两列视图')).toBeTruthy()

    fireEvent.focus(within(popover).getByRole('button', { name: /隐藏 ID 和名称：/ }))
    const info = await screen.findByRole('tooltip')
    expect(info.textContent).toContain('开启后只显示图标')

    fireEvent.click(cell('物品1'))
    const dialog = detail()
    expect(within(dialog).queryByLabelText('显示物品名称')).toBeNull()
    expect(within(dialog).queryByLabelText('两列视图')).toBeNull()
  })

  it('饰品不显示「最佳词缀」行（下拉里已带 ⭐ 与效果）', () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        rollablePrefixesById: new Map([[1, [81]]]),
        prefixModsById: new Map([[81, { dmg: 1.15, val: 1.760248 }]]),
        itemStats: {
          meta: { gameVersion: '1.4.5.8', itemCount: 3, itemsWithTip: 0, source: 'test', generatedBy: 'test', note: '' },
          items: { '1': { stats: { accessory: true, damage: 100, useAnimation: 20, knockBack: 5 } } },
        },
      }),
    )
    fireEvent.click(cell('物品1'))
    expect(screen.queryByText(/最佳词缀/)).toBeNull()
  })

  it('最近搜索：搜过的词进历史，可点回搜', async () => {
    renderPage([{ ...makeItem(1), name: '木匣' }, makeItem(2)])
    const input = screen.getByLabelText('物品ID')
    fireEvent.change(input, { target: { value: '木匣' } })
    // 现在不会自动弹出：点「最近搜索」按钮再展开
    fireEvent.click(await screen.findByRole('button', { name: '最近搜索' }))
    const chip = await screen.findByTestId('search-history-item')
    expect(chip.textContent).toBe('木匣')
    // 清空后点历史 → 又搜「木匣」
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByTestId('search-history-item'))
    expect((input as HTMLInputElement).value).toBe('木匣')
  })
})
