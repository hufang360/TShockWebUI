import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import type { Dataset } from '@/types'
import { RecipePanel } from './RecipePanel'

const ironOre = { id: 11, key: 'IronOre', name: '铁矿', icon: 11, frames: 1, sprite: [16, 16] as [number, number], tags: [] }
const ironBar = { id: 22, key: 'IronBar', name: '铁锭', icon: 22, frames: 1, sprite: [16, 16] as [number, number], tags: [] }
const graveyardBox = { id: 4358, key: 'MusicBoxGraveyard', name: '墓地八音盒', icon: 4358, frames: 1, sprite: [16, 16] as [number, number], tags: [] }

const dataset: Dataset = makeDataset({
  items: [ironOre, ironBar, graveyardBox],
  recipes: {
    meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
    groups: {},
    recipes: [
      {
        result: { id: 22, stack: 1 },
        ingredients: [{ id: 11, stack: 3 }],
        station: 17,
        stationItems: [],
        env: ['graveyard'],
        flags: ['notDecraftable'],
      },
    ],
    byResult: { '22': [0] },
    byIngredient: { '11': [0] },
  },
  shimmer: {
    meta: { gameVersion: '1.4.5.8', itemCount: 2, count: 1, source: 'test', generatedBy: 'test', note: '' },
    items: { '11': 22 },
  },
  shimmerToById: new Map([[11, 22]]),
  shimmerFromById: new Map([[22, [11]]]),
})

function renderPanel(iconOnly = false, copyTags = true) {
  return render(
    <I18nProvider lang="zh">
      <RecipePanel itemId={22} dataset={dataset} iconOnly={iconOnly} copyTags={copyTags} />
    </I18nProvider>,
  )
}

describe('RecipePanel', () => {
  it('渲染合成表 / 微光嬗变，数量以图标角标展示（不再有 ×N 文字）', () => {
    renderPanel()
    expect(screen.getByText('合成表（1）')).toBeTruthy()
    expect(screen.getByText('微光嬗变（1）')).toBeTruthy()
    expect(screen.getAllByText('铁矿').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('铁锭').length).toBeGreaterThanOrEqual(1)
    // 数量作为图标角标文字（stack=3）
    expect(screen.getByText('3')).toBeTruthy()
    // 不再有 "×3" 文字，且图标没有外框格子
    expect(screen.queryByText(/×3/)).toBeNull()
    // 灵雾用物品图标 4358 代替文字；notDecraftable → 紫色「不微光」标签
    expect(screen.getByRole('img', { name: '墓地八音盒' })).toBeTruthy()
    expect(screen.getByText('不微光')).toBeTruthy()
    expect(screen.queryByText('不可微光拆解')).toBeNull()
  })

  it('iconOnly：只留图标（名称隐藏，数量角标保留）', () => {
    renderPanel(true)
    expect(screen.queryByText('铁矿')).toBeNull()
    expect(screen.queryByText('铁锭')).toBeNull()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('配方组「任何XX」在仅图标下也显示文字', () => {
    const ds: Dataset = makeDataset({
      items: [ironOre, ironBar],
      recipes: {
        meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 1, source: 'test', generatedBy: 'test' },
        groups: { g1: { key: 'IronGroup', items: [] } },
        recipes: [
          {
            result: { id: 22, stack: 1 },
            ingredients: [{ id: 11, stack: 1, group: 'g1' }],
            station: 17,
            stationItems: [],
            env: [],
            flags: [],
          },
        ],
        byResult: { '22': [0] },
        byIngredient: { '11': [0] },
      },
    })
    render(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={ds} iconOnly />
      </I18nProvider>,
    )
    expect(screen.getByText(/任何/)).toBeTruthy()
  })

  it('合成条目可复制描述性文本（含 [i:..] 标签）', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('[i:11]')
    expect(text).toContain('[i:22]')
  })

  it('关闭「复制含标签」时复制纯名称文本', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel(false, false)
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('铁矿')
    expect(text).not.toContain('[i:')
  })
})
