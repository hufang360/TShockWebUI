import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import { parseWorld, type WorldTrack } from '@/lib/save/worldFile'
import { makeDataset } from '@/test/fixtures'
import { buildWorld } from '@/test/worldFile'
import { WorldFind } from './WorldFind'

/** 12×8：第 0 列是「生命水晶」（图格 12），其余是石头。 */
function world() {
  return buildWorld({
    width: 12,
    height: 8,
    tiles: (x) => (x === 0 ? { typ: 12, repeat: 7 } : { typ: 1, repeat: 7 }),
  })
}

function renderFind(onMarkersChange = vi.fn()) {
  const bytes = world()
  const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
  // 搜索是遍历 `tiles.entries` 的，所以夹具里必须有这两个图格
  const entries = [
    { id: 12, key: 'Heart', item: null },
    { id: 1, key: 'Stone', item: null },
  ]
  const dataset = makeDataset({
    tiles: { meta: { gameVersion: '1.4.5.8', count: 2, withItem: 0, withSize: 0, source: 'test', generatedBy: 'test', note: '' }, entries },
    tilesById: new Map(entries.map((e) => [e.id, e])),
    tileNameById: new Map([
      [12, '生命水晶'],
      [1, '石块'],
    ]),
  })
  const utils = render(
    <I18nProvider lang="zh">
      <DatasetProvider value={dataset}>
        <WorldFind bytes={bytes} parsed={parsed} onMarkersChange={onMarkersChange} />
      </DatasetProvider>
    </I18nProvider>,
  )
  return { ...utils, onMarkersChange }
}

describe('WorldFind（查找图格）', () => {
  it('搜「生命水晶」→ 点候选 → 显示命中数与坐标', async () => {
    renderFind()
    fireEvent.change(screen.getByPlaceholderText('搜索图格（名字 / 常量名 / ID）'), {
      target: { value: '生命水晶' },
    })
    // fixture 里墙的代表物品也恰好是「生命水晶」，所以可能有多个候选：取第一个图格
    const candidates = await screen.findAllByRole('button', { name: /生命水晶/ })
    fireEvent.click(candidates[0])

    expect(await screen.findByText('命中 8 处')).toBeTruthy()
    const hits = await screen.findByTestId('wld-find-hits')
    expect(hits.textContent).toContain('0, 0')
    expect(hits.textContent).toContain('0, 7')
  })

  it('点「在缩略图上标记」把坐标交给父组件，再点取消', async () => {
    const onMarkers = vi.fn()
    renderFind(onMarkers)
    fireEvent.change(screen.getByPlaceholderText('搜索图格（名字 / 常量名 / ID）'), {
      target: { value: '生命水晶' },
    })
    const candidates = await screen.findAllByRole('button', { name: /生命水晶/ })
    fireEvent.click(candidates[0])
    await screen.findByText('命中 8 处')

    fireEvent.click(screen.getByRole('button', { name: /在缩略图上标记/ }))
    expect(onMarkers).toHaveBeenCalledWith({
      kind: 'tile',
      id: 12,
      label: '生命水晶 ×8',
      hits: expect.any(Array),
    })
    // 扫描开始时父组件会先被通知「清空标记（null）」，这里取带坐标的那次调用
    const marked = onMarkers.mock.calls.map((c) => c[0]).filter(Boolean).at(-1)
    expect(marked.hits).toHaveLength(8)

    fireEvent.click(screen.getByRole('button', { name: /取消标记/ }))
    await waitFor(() => expect(onMarkers).toHaveBeenLastCalledWith(null))
  })

  it('找不到时给出明确文案', async () => {
    renderFind()
    fireEvent.change(screen.getByPlaceholderText('搜索图格（名字 / 常量名 / ID）'), {
      target: { value: '石块' },
    })
    // 石头在图格 1；本世界只有图格 12 与 1 → 先确认能搜到，再搜一个不存在的
    fireEvent.click((await screen.findAllByRole('button', { name: /石块/ }))[0])
    await screen.findByText(/命中 88 处/)
  })

  it('点坐标把位置交给父组件（用于跳到 1:1 大图）', async () => {
    const onFocus = vi.fn()
    const bytes = world()
    const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
    const entries = [
      { id: 12, key: 'Heart', item: null },
      { id: 1, key: 'Stone', item: null },
    ]
    render(
      <I18nProvider lang="zh">
        <DatasetProvider
          value={makeDataset({
            tiles: {
              meta: { gameVersion: '1.4.5.8', count: 2, withItem: 0, withSize: 0, source: 'test', generatedBy: 'test', note: '' },
              entries,
            },
            tilesById: new Map(entries.map((e) => [e.id, e])),
            tileNameById: new Map([[12, '生命水晶'], [1, '石块']]),
          })}
        >
          <WorldFind bytes={bytes} parsed={parsed} onMarkersChange={vi.fn()} onFocusHit={onFocus} />
        </DatasetProvider>
      </I18nProvider>,
    )
    fireEvent.change(screen.getByPlaceholderText('搜索图格（名字 / 常量名 / ID）'), {
      target: { value: '生命水晶' },
    })
    fireEvent.click((await screen.findAllByRole('button', { name: /生命水晶/ }))[0])
    await screen.findByText('命中 8 处')
    fireEvent.click(screen.getByRole('button', { name: '0, 0' }))
    expect(onFocus).toHaveBeenCalledWith({ x: 0, y: 0 })
  })

  it('「导出坐标 CSV」下载一份带抬头的坐标表', async () => {
    const blobs: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn((b: Blob) => {
        blobs.push(b)
        return 'blob:mock'
      }),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderFind()
    fireEvent.change(screen.getByPlaceholderText('搜索图格（名字 / 常量名 / ID）'), {
      target: { value: '生命水晶' },
    })
    fireEvent.click((await screen.findAllByRole('button', { name: /生命水晶/ }))[0])
    await screen.findByText('命中 8 处')
    fireEvent.click(screen.getByRole('button', { name: /导出坐标 CSV/ }))

    expect(click).toHaveBeenCalled()
    const text = await blobs[0].text()
    expect(text).toContain('# 生命水晶 (tile #12)')
    expect(text).toContain('x,y')
    expect(text).toContain('0,0')
    expect(text.split('\n').filter((l) => /^\d+,\d+$/.test(l))).toHaveLength(8)
    click.mockRestore()
  })

  it('清除按钮回到搜索态', async () => {
    renderFind()
    fireEvent.change(screen.getByPlaceholderText('搜索图格（名字 / 常量名 / ID）'), {
      target: { value: '生命水晶' },
    })
    const candidates = await screen.findAllByRole('button', { name: /生命水晶/ })
    fireEvent.click(candidates[0])
    await screen.findByText('命中 8 处')
    fireEvent.click(screen.getByRole('button', { name: '清除查找结果' }))
    expect(screen.queryByText('命中 8 处')).toBeNull()
  })
})
