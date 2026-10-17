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
  // 默认是「制作界面」；测试大多按「全部物品」断言，统一切到全部物品。
  if (!opts.keepMode) fireEvent.click(screen.getByTestId('dex-mode-all'))
  return utils
}

/** 格子里的图标按钮（用 aria-label = 物品名定位）。 */
const cell = (name: string) => screen.getByRole('button', { name })
const detail = () => screen.getByTestId('dex-detail')
const gridIcons = () => within(screen.getByTestId('dex-list')).getAllByRole('img')
const pageLabel = () => screen.getByText(/^第 \d+ \/ \d+ 页$/)

/** 一级模式（ToggleGroup）：testid = dex-mode-lucky/all/game 或 dex-favorites-toggle。 */
function chooseTopMode(testid: string) {
  fireEvent.click(screen.getByTestId(testid))
}

/** 集合分组（二级入口 Select）：点 [分组 ▾] → 选分组。 */
function chooseCollectionGroup(name: string) {
  fireEvent.click(screen.getByLabelText('分组'))
  fireEvent.click(screen.getByRole('option', { name }))
}

/** 第二级「物品集合」是 Radix Select。 */
function chooseCollection(name: string | RegExp) {
  fireEvent.click(screen.getByLabelText('物品集合'))
  fireEvent.click(screen.getByRole('option', { name }))
}

beforeEach(() => {
  resetDexState()
  localStorage.clear()
})

describe('ItemsPage 图鉴', () => {
  it('进入页面自动聚焦搜索框', () => {
    renderPage(makeItems(5))
    expect(document.activeElement).toBe(screen.getByLabelText('物品图鉴'))
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
  it('分页：默认每页 100，可翻页；结果区不是卡片', () => {
    renderPage(makeItems(250))
    expect(pageLabel().textContent).toBe('第 1 / 3 页')
    expect(screen.getByRole('button', { name: '上一页' })).toHaveProperty('disabled', true)
    expect(screen.getByTestId('dex-list').closest('[data-slot="card"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(pageLabel().textContent).toBe('第 2 / 3 页')

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(pageLabel().textContent).toBe('第 1 / 3 页')
  })

  it('翻页控件可设置每页个数（50 / 100 / 200 / 360 / 500），改动后回到第 1 页', () => {
    renderPage(makeItems(250))
    const sizeSelect = screen.getByLabelText('每页') as HTMLSelectElement
    expect(Array.from(sizeSelect.options).map((o) => o.value)).toEqual([
      '50',
      '100',
      '200',
      '360',
      '500',
    ])
    expect(Array.from(sizeSelect.options).map((o) => o.textContent)).toEqual([
      '50',
      '100',
      '200',
      '360',
      '500',
    ])

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.change(sizeSelect, { target: { value: '50' } })
    expect(sizeSelect.value).toBe('50')
    expect(pageLabel().textContent).toBe('第 1 / 5 页')
  })

  it('件数小字在翻页器旁边', () => {
    renderPage(makeItems(250))
    const pager = screen.getByTestId('dex-pager')
    expect(within(pager).getByText('共 250 件')).toBeTruthy()
    expect(within(pager).getByLabelText('每页')).toBeTruthy()
    expect(within(pager).getByRole('button', { name: '下一页' })).toBeTruthy()
  })

  it('每页 500 时网格虚拟化：只挂可视行，滚动后切片随之下移', () => {
    renderPage(makeItems(1000))
    fireEvent.change(screen.getByLabelText('每页'), { target: { value: '500' } })
    const list = screen.getByTestId('dex-list')
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))

    // jsdom 无布局 → 10 列 / 560px 兜底、行高 110+8=118 → 可视 + overscan 共 7 行 = 70 个（列表随机，只断言数量）
    const first = names()
    expect(first.length).toBe(70)
    expect(first.length).toBeLessThan(500)

    Object.defineProperty(list, 'scrollTop', { value: 99999, writable: true, configurable: true })
    fireEvent.scroll(list)
    const last = names()
    expect(last.length).toBe(10) // 500 / 10 列 → 最后一行满 10 个
    expect(last.some((name) => first.includes(name))).toBe(false)
  })

  it('格子：固定 64×64 图标，始终显示 ID 与名称（名称可截断）', () => {
    renderPage(makeItems(10))
    const first = cell('物品1')
    const canvas = within(first).getByRole('img', { name: '物品1' }) as HTMLCanvasElement
    expect(canvas.style.width).toBe('64px')
    expect(canvas.style.height).toBe('64px')
    // 始终显示 ID + 名称 → 高度 = 76 + 14 + 20
    expect(first.style.height).toBe('110px')
    expect(within(first).getByText('1')).toBeTruthy()
    const name = within(first).getByText('物品1')
    expect(name.className).toContain('truncate')

    // 整个卡片可点 → 手型、无白底
    expect(first.className).toContain('cursor-pointer')
    expect(first.className).not.toContain('bg-card')
  })

  it('详情：默认不显示，点格子后弹出 dialog（tips + 复制 + wiki）', () => {
    renderPage(makeItems(10))
    expect(screen.queryByTestId('dex-detail')).toBeNull()

    fireEvent.click(cell('物品1'))
    const dialog = detail()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.className).toContain('max-w-xl')
    expect(within(dialog).getByText('物品1')).toBeTruthy()
    // 合并后的复制控件：下拉（默认 ID）+ 复制按钮 + 前往 wiki
    expect(within(dialog).getByLabelText('复制内容')).toHaveProperty('value', 'id')
    expect(within(dialog).getByRole('button', { name: '复制' })).toBeTruthy()
    const wiki = within(dialog).getByRole('link', { name: /前往 Wiki/ })
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

  it('复制内容可选 ID / 名称 / 标签（默认 ID）', () => {
    renderPage(makeItems(3))
    fireEvent.click(cell('物品2'))
    const select = within(detail()).getByLabelText('复制内容') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['id', 'name', 'tag'])
    fireEvent.change(select, { target: { value: 'tag' } })
    expect(select.value).toBe('tag')
  })

  it('集合可筛选物品（水友「mix」集合 = 987/2161/1358）', () => {
    renderPage([makeItem(1), makeItem(987), makeItem(1358), makeItem(2161), makeItem(5000)])
    // 级联：未选集合分组时，右侧没有第二个下拉
    expect(screen.queryByLabelText('物品集合')).toBeNull()

    chooseCollectionGroup('水友专属')
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    // 只选了分组、未选具体集合 → 仍是全部物品
    expect(names().sort()).toEqual(['物品1', '物品1358', '物品2161', '物品5000', '物品987'])

    chooseCollection(/🫙 mix/)
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])
    // 集合模式的右侧是集合下拉，不再有「换一批」
    expect(screen.queryByRole('button', { name: /换一批/ })).toBeNull()
  })

  it('级联：换分组会清空已选集合，回到全部物品', () => {
    renderPage([makeItem(1), makeItem(987), makeItem(1358), makeItem(2161), makeItem(5000)])
    chooseCollectionGroup('水友专属')
    chooseCollection(/🫙 mix/)
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])

    // 切换到另一分组 → 集合选择被清空，列表回到全部物品
    chooseCollectionGroup('ID 范围')
    expect(names().sort()).toEqual(['物品1', '物品1358', '物品2161', '物品5000', '物品987'])
    expect(screen.getByLabelText('物品集合').getAttribute('data-placeholder')).toBe('')
  })

  it('游戏分组：选中「制作界面」后出现页签且默认选中「工具」', () => {
    // 29 = 消耗品+材料，75 = 材料，4956 = 武器（见 test/fixtures.ts 的 itemGroups）
    renderPage([makeItem(29), makeItem(75), makeItem(4956)])
    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))

    // renderPage 已切到「全部物品」：没有页签
    expect(screen.queryByRole('tablist')).toBeNull()

    chooseTopMode('dex-mode-game')
    expect(screen.getByRole('tablist')).toBeTruthy()
    // 没有「全部」页签；默认选中的是「工具」
    expect(screen.queryByRole('tab', { name: '全部' })).toBeNull()
    expect(screen.getByRole('tab', { name: '工具' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.mouseDown(screen.getByRole('tab', { name: '武器' }))
    expect(names()).toEqual(['物品4956'])

    fireEvent.mouseDown(screen.getByRole('tab', { name: '材料' }))
    expect(names().sort()).toEqual(['物品29', '物品75'])
  })

  it('切模块再回来保留界面状态（卸载不重置）；刷新回到默认', () => {
    const first = renderPage(makeItems(250))
    fireEvent.change(screen.getByLabelText('每页'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(pageLabel().textContent).toBe('第 2 / 5 页')
    first.unmount()

    // 再次挂载 = 切回本模块：状态应被还原（不再切模式，靠模块内存还原）
    const second = renderPage(makeItems(250), { keepMode: true })
    expect(pageLabel().textContent).toBe('第 2 / 5 页')
    expect((screen.getByLabelText('每页') as HTMLSelectElement).value).toBe('50')
    second.unmount()

    // resetDexState 相当于刷新：页码回 1；但「每页数量」跨刷新记忆（localStorage）
    resetDexState()
    renderPage(makeItems(250))
    expect(pageLabel().textContent).toBe('第 1 / 5 页')
    expect((screen.getByLabelText('每页') as HTMLSelectElement).value).toBe('50')
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
    fireEvent.change(screen.getByLabelText('物品图鉴'), { target: { value: 'Item75' } })
    await waitFor(() => expect(names()).toEqual(['物品75']))

    // 清空搜索 + 关掉收藏 → 回到全部物品
    fireEvent.change(screen.getByLabelText('物品图鉴'), { target: { value: '' } })
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
    fireEvent.change(screen.getByLabelText('物品图鉴'), { target: { value: 'Item999' } })
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
    // 全部物品没有页签
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('切换筛选会重置翻页', () => {
    renderPage(makeItems(500))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(pageLabel().textContent).toBe('第 2 / 5 页')
    chooseCollectionGroup('ID 范围')
    expect(pageLabel().textContent).toBe('第 1 / 5 页')
  })

  it('词缀下拉只列可滚词缀，选中后显示 [i/pXX:ID] 标签', () => {
    renderPage(
      makeDataset({
        items: makeItems(3),
        rollablePrefixesById: new Map([[1, [81]]]),
        prefixModsById: new Map([[81, { dmg: 1.15 }]]),
      }),
    )
    fireEvent.click(cell('物品1'))
    fireEvent.click(screen.getByLabelText('词缀'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['无词缀', '传奇'])
    fireEvent.click(screen.getByRole('option', { name: '传奇' }))
    expect(screen.getByText('[i/p81:1]')).toBeTruthy()
  })

  it('数据版本与统计同排（移入翻页器，不再是主操作区的 Badge）', () => {
    renderPage(makeItems(3))
    const pager = screen.getByTestId('dex-pager')
    const version = within(pager).getByText(/数据版本 1\.4\.5\.8 · 3 件/)
    expect(version.closest('button')).toBeNull()
    // 与旁边的「共 N 件」同字号
    const summary = within(pager).getByText(/共 3 件/)
    expect(version.className).not.toContain('font-pixel')
    expect(summary.className).not.toContain('font-pixel')
  })
})
