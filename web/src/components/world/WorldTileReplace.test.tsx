import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DatasetProvider } from '@/lib/datasetContext'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { parseWorld, type WorldTrack } from '@/lib/save/worldFile'
import { renderWorldThumbnail } from '@/lib/save/worldThumb'
import { WorldTileReplace } from './WorldTileReplace'

async function setup(
  onReplace = vi.fn(),
  dataset = makeDataset(),
) {
  const bytes = new Uint8Array(readFileSync('public/demo/world.wld'))
  const parsed = parseWorld(bytes, {} as WorldTrack)
  const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 20_000, yieldEvery: 1e9 })
  render(
    <I18nProvider lang="zh">
      <DatasetProvider value={dataset}>
        <WorldTileReplace world={parsed} stats={thumb.stats} onReplace={onReplace} />
      </DatasetProvider>
    </I18nProvider>,
  )
  return { parsed, onReplace }
}

describe('图格替换卡片', () => {
  it('填两个 id → 显示「将替换 N 格」，确认后才回调', async () => {
    const { onReplace } = await setup()
    // demo 世界里石块(1) 数量最多
    fireEvent.change(screen.getByLabelText('把这种图格'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('换成'), { target: { value: '0' } })
    expect(screen.getByText(/将替换 [\d,]+ 格/)).toBeTruthy()

    // 第一下只进入「确认」状态，不执行
    fireEvent.click(screen.getByRole('button', { name: /替换$/ }))
    expect(onReplace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认替换' }))
    expect(onReplace).toHaveBeenCalledWith(1, 0)
  })

  it('不安全的选择给出原因、按钮禁用（宽度不同 / 换成空气 / 同一种）', async () => {
    // 给夹具补一个 ≥256 的图格（1 ↔ 400 才是「id 字节宽度不同」）
    const withWide = makeDataset({
      tiles: {
        ...makeDataset().tiles,
        entries: [...makeDataset().tiles.entries, { id: 400, key: 'WideTile', item: null }],
      } as never,
    })
    await setup(vi.fn(), withWide)
    const run = () => screen.getByRole('button', { name: /替换$/ }) as HTMLButtonElement

    fireEvent.change(screen.getByLabelText('把这种图格'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('换成'), { target: { value: '-1' } })
    expect(screen.getByText(/不能替换成空气/)).toBeTruthy()
    expect(run().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('换成'), { target: { value: '1' } })
    expect(screen.getByText(/前后是同一种图格/)).toBeTruthy()
    expect(run().disabled).toBe(true)

    // 1 ↔ 400：id 字节宽度不同
    fireEvent.change(screen.getByLabelText('换成'), { target: { value: '400' } })
    expect(screen.getByText(/字节宽度不同/)).toBeTruthy()
    expect(run().disabled).toBe(true)
  })

  it('世界里没有这种图格时不给替换', async () => {
    // 图格 6 在 demo 世界里是 0 格（且不是 frame-important、id <256 → 不会先撞上别的守卫）
    const withRare = makeDataset({
      tiles: {
        ...makeDataset().tiles,
        entries: [...makeDataset().tiles.entries, { id: 6, key: 'RareTile', item: null }],
      } as never,
    })
    await setup(vi.fn(), withRare)
    fireEvent.change(screen.getByLabelText('把这种图格'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('换成'), { target: { value: '0' } })
    expect(screen.getByText('这个世界里没有这种图格')).toBeTruthy()
    expect((screen.getByRole('button', { name: /替换$/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
