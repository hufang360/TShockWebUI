import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { resetCodexState } from '@/lib/codexState'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import type { Dataset } from '@/types'
import { CodexPage } from './CodexPage'

function renderPage(dataset: Dataset = makeDataset()) {
  return render(
    <I18nProvider lang="zh">
      <DatasetProvider value={dataset}>
        <CodexPage />
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

describe('CodexPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetCodexState()
  })

  it('默认展示 NPC 网格（名称 + ID），进入即聚焦搜索框', () => {
    renderPage()
    expect(screen.getByTitle('蓝史莱姆 #1')).toBeTruthy()
    expect(screen.getByTitle('克苏鲁之眼 #4')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('数据图鉴'))
    // 底部翻页器与物品图鉴同一套：件数 ｜ 数据版本
    const pager = screen.getByTestId('codex-pager')
    expect(within(pager).getByText('共 2 个')).toBeTruthy()
    expect(within(pager).getByText('2 个 · 数据版本 1.4.5.8')).toBeTruthy()
  })

  it('Boss 筛选只留可 /sb 的 NPC', () => {
    renderPage()
    fireEvent.click(screen.getByRole('radio', { name: 'Boss' }))
    expect(screen.queryByTitle('蓝史莱姆 #1')).toBeNull()
    expect(screen.getByTitle('克苏鲁之眼 #4')).toBeTruthy()
  })

  it('贴图绘制区默认 64×64，切到 Boss 后 128×128', () => {
    renderPage()
    const cell = screen.getByTitle('蓝史莱姆 #1')
    const canvas = cell.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.width).toBe('64px')
    expect(canvas.style.height).toBe('64px')

    fireEvent.click(screen.getByRole('radio', { name: 'Boss' }))
    const bossCanvas = screen.getByTitle('克苏鲁之眼 #4').querySelector('canvas') as HTMLCanvasElement
    expect(bossCanvas.style.width).toBe('128px')
    expect(bossCanvas.style.height).toBe('128px')
  })

  it('分类筛选：小动物只显示小动物', () => {
    renderPage(withBunny())
    expect(screen.getByTitle('兔子 #46')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '小动物' }))
    expect(screen.getByTitle('兔子 #46')).toBeTruthy()
    expect(screen.queryByTitle('蓝史莱姆 #1')).toBeNull()
    expect(screen.queryByTitle('克苏鲁之眼 #4')).toBeNull()
  })

  it('切到图格 / 墙：用表格展示（ID / 名称 / 内部名）', () => {
    renderPage()
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    expect(screen.getByTitle('Dirt #0')).toBeTruthy()
    expect(screen.getByTitle('Trees #5')).toBeTruthy()
    expect(screen.getByTitle('生命水晶 #1')).toBeTruthy()
    // 表头四列（图标在名称左边）
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('图标')).toBeTruthy()
    expect(screen.getByText('内部名')).toBeTruthy()
    // 有代表物品的行画了图标（canvas）
    expect(screen.getByTitle('生命水晶 #1').querySelector('canvas')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '墙' }))
    expect(screen.getByTitle('生命水晶 #1')).toBeTruthy()
    expect(screen.queryByTitle('Dirt #0')).toBeNull()
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
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.getByTitle('Tile0 #0')).toBeTruthy()
    expect(screen.getByTitle('Tile9 #9')).toBeTruthy()
  })

  it('搜索按名称 / 内部名 / ID 过滤当前数据源', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    fireEvent.change(screen.getByLabelText('数据图鉴'), { target: { value: '生命' } })
    await waitFor(() => expect(screen.queryByTitle('Dirt #0')).toBeNull())
    expect(screen.getByTitle('生命水晶 #1')).toBeTruthy()
  })

  it('点 NPC 打开右侧抽屉：名称 / ID / 内部名 / Boss 标记，且不含召唤指令', async () => {
    renderPage()
    fireEvent.click(screen.getByTitle('克苏鲁之眼 #4'))
    await waitFor(() => expect(screen.getByTestId('codex-detail')).toBeTruthy())
    const detail = screen.getByTestId('codex-detail')
    expect(detail.getAttribute('data-kind')).toBe('npc')
    expect(within(detail).getByText('NPC 详情')).toBeTruthy()
    expect(within(detail).getByText('克苏鲁之眼')).toBeTruthy()
    expect(within(detail).getByText('#4')).toBeTruthy()
    expect(within(detail).getByText('EyeOfCthulhu')).toBeTruthy()
    expect(within(detail).getByText('Boss')).toBeTruthy()
    expect(within(detail).queryByText('/sb eye of cthulhu')).toBeNull()
  })

  it('点图格打开右侧抽屉：内部名 / 代表物品 / 尺寸', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    fireEvent.click(screen.getByTitle('生命水晶 #1'))
    await waitFor(() => expect(screen.getByTestId('codex-detail')).toBeTruthy())
    const detail = screen.getByTestId('codex-detail')
    expect(detail.getAttribute('data-kind')).toBe('tile')
    expect(within(detail).getByText('图格详情')).toBeTruthy()
    expect(within(detail).getByText('Stone')).toBeTruthy()
    expect(within(detail).getByText('生命水晶 #29')).toBeTruthy()
    expect(within(detail).getByText('3×2')).toBeTruthy()
    expect(within(detail).getByText('多格')).toBeTruthy()
  })

  it('抽屉可用右上角关闭按钮关闭', async () => {
    renderPage()
    fireEvent.click(screen.getByTitle('蓝史莱姆 #1'))
    await waitFor(() => expect(screen.getByTestId('codex-detail')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('codex-detail')).toBeNull())
  })

  it('最近搜索：聚焦不弹，打字才弹；清空后可用历史按钮打开并点回搜', async () => {
    window.localStorage.setItem('tswui:npcs:searchHistory', JSON.stringify(['史莱姆']))
    renderPage()
    const input = screen.getByLabelText('数据图鉴') as HTMLInputElement
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
    fireEvent.change(screen.getByLabelText('数据图鉴'), { target: { value: '兔子' } })
    await waitFor(() =>
      expect(window.localStorage.getItem('tswui:npcs:searchHistory')).toContain('兔子'),
    )
    // 切到图格：搜索框清空，也不会把 NPC 的词记进图格历史
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    const input = screen.getByLabelText('数据图鉴') as HTMLInputElement
    expect(input.value).toBe('')
    await new Promise((r) => setTimeout(r, 250))
    expect(window.localStorage.getItem('tswui:tiles:searchHistory') ?? '').not.toContain('兔子')

    fireEvent.change(input, { target: { value: 'Stone' } })
    await waitFor(() =>
      expect(window.localStorage.getItem('tswui:tiles:searchHistory')).toContain('Stone'),
    )
    expect(window.localStorage.getItem('tswui:npcs:searchHistory')).toContain('兔子')
  })

  it('图格表头是 TileID，墙是 WallID；尺寸列只显示非 1×1', () => {
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
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    expect(screen.getByText('TileID')).toBeTruthy()
    expect(screen.getByText('尺寸')).toBeTruthy()
    expect(screen.getByText('1×3')).toBeTruthy()
    // 1×1 不显示
    expect(screen.queryByText('1×1')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: '墙' }))
    expect(screen.getByText('WallID')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    const cb = screen.getByTestId('codex-two-cols')
    expect(cb.getAttribute('data-state')).toBe('checked')
    expect(screen.getAllByRole('table')).toHaveLength(2)
    fireEvent.click(cb)
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('每页数量包含 1000', () => {
    renderPage()
    const select = document.getElementById('codex-page-size') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toContain('1000')
  })

  it('记忆页面状态：切走再回来仍是上次的 tab（刷新才重置）', async () => {
    const first = renderPage()
    fireEvent.click(screen.getByRole('radio', { name: '图格' }))
    await waitFor(() => expect(screen.getByText('TileID')).toBeTruthy())
    first.unmount()
    // 重新挂载（模拟切页面回来，模块内存还在）
    const second = renderPage()
    expect(screen.getByText('TileID')).toBeTruthy()
    second.unmount()
    // 重置后（模拟刷新页面）回到默认 NPC
    resetCodexState()
    renderPage()
    expect(screen.queryByText('TileID')).toBeNull()
    expect(screen.getByTitle('蓝史莱姆 #1')).toBeTruthy()
  })
})
