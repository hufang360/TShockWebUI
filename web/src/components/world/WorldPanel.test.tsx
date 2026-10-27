import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { buildWorld, dotnetTicks } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from '@/lib/save/worldFile'
import { renderWorldThumbnail } from '@/lib/save/worldThumb'
import { WorldPanel } from './WorldPanel'

async function setup(markers?: { kind: 'tile' | 'wall' | 'liquid'; id: number; label: string; hits: { x: number; y: number }[] }) {
  const bytes = buildWorld({ width: 40, height: 20, tiles: () => ({ typ: 1 }) })
  const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
  const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 100_000 })
  const utils = render(
    <I18nProvider lang="zh">
      <WorldPanel world={parsed.info} thumb={thumb} markers={markers ?? null} />
    </I18nProvider>,
  )
  void dotnetTicks
  return { ...utils, world: parsed.info }
}

describe('WorldPanel（缩略图 + 标记 + 1:1 大图）', () => {
  it('标记层始终存在，`data-marked` 反映命中数', async () => {
    const { rerender } = await setup()
    expect(screen.getByTestId('world-thumbnail-markers').getAttribute('data-marked')).toBe('0')

    const bytes = buildWorld({ width: 40, height: 20, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 100_000 })
    rerender(
      <I18nProvider lang="zh">
        <WorldPanel
          world={parsed.info}
          thumb={thumb}
          markers={{ kind: 'tile', id: 12, label: '生命水晶 ×2', hits: [{ x: 3, y: 4 }, { x: 5, y: 6 }] }}
        />
      </I18nProvider>,
    )
    expect(screen.getByTestId('world-thumbnail-markers').getAttribute('data-marked')).toBe('2')
    // 左上角图例
    expect(screen.getByText('生命水晶 ×2')).toBeTruthy()
  })

  it('点缩略图打开 1:1 大图，滚动画布存在', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: /点击查看原图|看原图|放大/ }))
    expect(await screen.findByTestId('world-zoom-scroll')).toBeTruthy()
    expect(screen.getByTestId('world-thumbnail-zoom')).toBeTruthy()
  })
})

describe('WorldPanel 固定标注与版本显示', () => {
  it('覆盖层会标出生点 / 地牢（data-pins=1），版本显示成「游戏版本（release）」', async () => {
    const bytes = buildWorld({ width: 40, height: 20, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 100_000 })
    render(
      <I18nProvider lang="zh">
        <WorldPanel world={parsed.info} thumb={thumb} />
      </I18nProvider>,
    )
    expect(screen.getByTestId('world-thumbnail-markers').getAttribute('data-pins')).toBe('1')
    // 合成世界的 release 是 326 → 1.4.5.8
    expect(screen.getByText('1.4.5.8（326）')).toBeTruthy()
  })
})

describe('WorldPanel：跳转后关得掉 1:1 大图', () => {
  it('`focus` 打开的大图，点关闭时会通知父组件清掉 focus（否则 open 一直为 true，关不掉）', async () => {
    const bytes = buildWorld({ width: 40, height: 20, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 100_000 })
    let cleared = 0
    render(
      <I18nProvider lang="zh">
        <WorldPanel
          world={parsed.info}
          thumb={thumb}
          focus={{ x: 3, y: 4, seq: 1 }}
          onFocusClear={() => {
            cleared++
          }}
        />
      </I18nProvider>,
    )
    // focus 存在 → 大图直接打开
    expect(screen.getByTestId('world-zoom-scroll')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // 关闭必须回传，让父组件把 focus 置空
    expect(cleared).toBeGreaterThan(0)
  })
})

describe('WorldPanel：悬停看这一格是什么', () => {
  it('鼠标移到缩略图上有格子名字；移出后提示消失', async () => {
    const bytes = buildWorld({ width: 20, height: 10, tiles: (x) => ({ typ: x < 10 ? 1 : -1 }) })
    const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 10_000, recordColumnOffsets: true })
    render(
      <I18nProvider lang="zh">
        <DatasetProvider value={makeDataset()}>
          <WorldPanel world={parsed.info} thumb={thumb} bytes={bytes} parsed={parsed} />
        </DatasetProvider>
      </I18nProvider>,
    )
    const button = screen.getByTestId('world-thumb-button')
    // jsdom 没有布局：手动给出 200×100 的矩形，指针落在左上 1/8 处（世界坐标 x≈1, y≈0）
    button.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.mouseMove(button, { clientX: 15, clientY: 5 })
    const tip = screen.getByTestId('world-hover-tip')
    // 图格 1 的代表物品是 29（生命水晶）→ 显示物品名；坐标也要在
    expect(tip.textContent).toContain('生命水晶')
    expect(tip.textContent).toMatch(/\d+, \d+/)
    fireEvent.mouseLeave(button)
    expect(screen.queryByTestId('world-hover-tip')).toBeNull()
  })

  it('没有原始字节时（只有 info/位图）不显示提示，也不报错', async () => {
    const bytes = buildWorld({ width: 20, height: 10, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 10_000 })
    render(
      <I18nProvider lang="zh">
        <DatasetProvider value={makeDataset()}>
          <WorldPanel world={parsed.info} thumb={thumb} />
        </DatasetProvider>
      </I18nProvider>,
    )
    const button = screen.getByTestId('world-thumb-button')
    button.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.mouseMove(button, { clientX: 15, clientY: 5 })
    // 提示会出现，但没有格子内容 → 显示「空气」而不是崩掉
    expect(screen.getByTestId('world-hover-tip').textContent).toContain('空气')
  })
})

describe('WorldPanel：颜色图例', () => {
  it('按占比列出方块，色块与缩略图同一张颜色表；最多 6 项', async () => {
    // 30 列：前 10 列图格 1（夹具里代表物品 29 = 生命水晶），中 10 列图格 2，后 10 列空气
    const bytes = buildWorld({
      width: 30,
      height: 1,
      tiles: (x) => ({ typ: x < 10 ? 1 : x < 20 ? 2 : -1 }),
    })
    const parsed = parseWorld(bytes, { bosses: {} } as unknown as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 10_000 })
    render(
      <I18nProvider lang="zh">
        <DatasetProvider value={makeDataset()}>
          <WorldPanel world={parsed.info} thumb={thumb} />
        </DatasetProvider>
      </I18nProvider>,
    )
    const legend = screen.getByTestId('world-legend')
    const items = [...legend.querySelectorAll('li')]
    expect(items.length).toBe(2) // 只有两种非空图格
    const first = items[0]
    const swatch = first.querySelector('span[style]') as HTMLElement
    expect(swatch.style.backgroundColor).toMatch(/^rgb|#/)
    expect(first.textContent).toContain('生命水晶')
    expect(first.textContent).toContain('33.3%')
    // 图格 2 在夹具里没有名字 → 回退 #2
    expect(items[1].textContent).toContain('#2')
  })
})
