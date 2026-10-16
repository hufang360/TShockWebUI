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

function renderPage(items: Item[]) {
  const dataset = makeDataset({ items })
  return render(
    <I18nProvider lang="zh">
      <ItemsPage dataset={dataset} />
    </I18nProvider>,
  )
}

/** 格子里的图标按钮（用 aria-label = 物品名定位）。 */
const cell = (name: string) => screen.getByRole('button', { name })
const detail = () => screen.getByTestId('dex-detail')
const gridIcons = () => within(screen.getByTestId('dex-list')).getAllByRole('img')
const pageLabel = () => screen.getByText(/^第 \d+ \/ \d+ 页$/)

beforeEach(() => {
  resetDexState()
})

describe('ItemsPage 图鉴', () => {
  it('进入页面自动聚焦搜索框', () => {
    renderPage(makeItems(5))
    expect(document.activeElement).toBe(screen.getByLabelText('物品图鉴'))
  })

  it('详情里可收藏物品（写入 tswui:itemFavorites）', () => {
    localStorage.clear()
    renderPage(makeItems(5))
    fireEvent.click(cell('物品1'))
    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
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
  it('分页：默认每页 50，可翻页；结果区不是卡片', () => {
    renderPage(makeItems(250))
    expect(pageLabel().textContent).toBe('第 1 / 5 页')
    expect(screen.getByRole('button', { name: '上一页' })).toHaveProperty('disabled', true)
    expect(screen.getByTestId('dex-list').closest('[data-slot="card"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(pageLabel().textContent).toBe('第 2 / 5 页')

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(pageLabel().textContent).toBe('第 1 / 5 页')
  })

  it('翻页控件可设置每页个数（50 / 100 / 200 / 500），改动后回到第 1 页', () => {
    renderPage(makeItems(250))
    const sizeSelect = screen.getByLabelText('每页') as HTMLSelectElement
    expect(Array.from(sizeSelect.options).map((o) => o.value)).toEqual(['50', '100', '200', '500'])
    expect(Array.from(sizeSelect.options).map((o) => o.textContent)).toEqual([
      '50',
      '100',
      '200',
      '500',
    ])

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.change(sizeSelect, { target: { value: '100' } })
    expect(sizeSelect.value).toBe('100')
    expect(pageLabel().textContent).toBe('第 1 / 3 页')
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

  it('集合可筛选物品（水友「mix」集合 = 987/2161/1358），且集合内也能「换一批」', () => {
    renderPage([makeItem(1), makeItem(987), makeItem(1358), makeItem(2161), makeItem(5000)])
    fireEvent.change(screen.getByLabelText('水友专属'), {
      target: { value: 'friend:🫙 mix 🏹' },
    })

    const names = () => gridIcons().map((el) => el.getAttribute('aria-label'))
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])

    const shuffle = screen.getByRole('button', { name: /换一批/ })
    for (let i = 0; i < 5; i += 1) fireEvent.click(shuffle)
    expect(names().sort()).toEqual(['物品1358', '物品2161', '物品987'])
  })

  it('搜索时不给「换一批」（结果按相关度排序）', async () => {
    renderPage(makeItems(10))
    expect(screen.getByRole('button', { name: /换一批/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('物品图鉴'), { target: { value: 'Item1' } })
    // 搜索词有 180ms 防抖
    await waitFor(() => expect(screen.queryByRole('button', { name: /换一批/ })).toBeNull())
  })

  it('切模块再回来保留界面状态（卸载不重置）；刷新才重新随机', () => {
    const first = renderPage(makeItems(250))
    fireEvent.change(screen.getByLabelText('每页'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(pageLabel().textContent).toBe('第 2 / 3 页')
    first.unmount()

    // 再次挂载 = 切回本模块：状态应被还原
    const second = renderPage(makeItems(250))
    expect(pageLabel().textContent).toBe('第 2 / 3 页')
    expect((screen.getByLabelText('每页') as HTMLSelectElement).value).toBe('100')
    second.unmount()

    // resetDexState 相当于刷新（模块内存被清空）→ 回到默认状态
    resetDexState()
    renderPage(makeItems(250))
    expect(pageLabel().textContent).toBe('第 1 / 5 页')
    expect((screen.getByLabelText('每页') as HTMLSelectElement).value).toBe('50')
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
