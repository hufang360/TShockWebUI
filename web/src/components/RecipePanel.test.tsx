import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import type { Dataset } from '@/types'
import { RecipePanel } from './RecipePanel'

const ironOre = { id: 11, key: 'IronOre', name: '铁矿', icon: 11, frames: 1, sprite: [16, 16] as [number, number], tags: [] }
const ironBar = { id: 22, key: 'IronBar', name: '铁锭', icon: 22, frames: 1, sprite: [16, 16] as [number, number], tags: [] }
const graveyardBox = { id: 4358, key: 'MusicBoxGraveyard', name: '墓地八音盒', icon: 4358, frames: 1, sprite: [16, 16] as [number, number], tags: [] }
const shimmer = { id: 5362, key: 'MusicBoxShimmer', name: '八音盒（以太）', icon: 5362, frames: 1, sprite: [16, 16] as [number, number], tags: [] }

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
    // 灵雾用物品图标 4358 代替文字；`notDecraftable` 不在配方行里显示（已改为物品级「可微分」）
    expect(screen.getByRole('img', { name: '墓地八音盒' })).toBeTruthy()
    expect(screen.queryByText('不微光')).toBeNull()
  })

  it('iconOnly：只留图标（名称隐藏，数量角标保留）', () => {
    renderPanel(true)
    expect(screen.queryByText('铁矿')).toBeNull()
    expect(screen.queryByText('铁锭')).toBeNull()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('仅图标下连配方组的「任何XX」文字也不显示（仍保留在复制文本里）', () => {
    const ds: Dataset = makeDataset({
      items: [ironOre, ironBar, shimmer],
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
    // 仅图标：不显示「任何XX」文字
    expect(screen.queryByText(/任何/)).toBeNull()
    // 非仅图标：显示「任何XX」
    expect(screen.getByRole('img', { name: '铁矿' })).toBeTruthy()
  })

  it('非仅图标时配方组显示「任何XX」文字（复制文本也带）', () => {
    const ds: Dataset = makeDataset({
      items: [ironOre, ironBar, shimmer],
      recipes: {
        meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 1, source: 'test', generatedBy: 'test' },
        groups: { g1: { key: 'ItemName.IronBar', items: [22] } },
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
      loc: {
        ItemName: { IronOre: '铁矿', IronBar: '铁锭' },
        Prefix: {},
        NPCName: {},
        BuffName: {},
      },
    })
    render(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={ds} />
      </I18nProvider>,
    )
    expect(screen.getByText('任何铁锭')).toBeTruthy()
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

  it('可微光分解：额外显示一条反向记录（产物 @ 微光 → 原材料）', () => {
    const ds: Dataset = makeDataset({
      items: [ironOre, ironBar, shimmer],
      recipes: {
        meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
        groups: {},
        recipes: [
          {
            result: { id: 22, stack: 1 },
            ingredients: [{ id: 11, stack: 3 }],
            station: 17,
            stationItems: [],
            env: [],
            flags: [],
          },
        ],
        byResult: { '22': [0] },
        byIngredient: { '11': [0] },
      },
      itemStats: {
        meta: { gameVersion: '1.4.5.8', itemCount: 2, itemsWithTip: 0, source: 'test', generatedBy: 'test', note: '' },
        items: { '22': { stats: { canDecraft: true, decraftStack: 2 } } },
      },
    })
    render(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={ds} />
      </I18nProvider>,
    )
    // 反向记录：铁锭 @ 微光 → 铁矿
    const reverse = screen.getByTestId('reverse-recipe-row')
    expect(reverse.textContent).toContain('铁锭')
    expect(reverse.textContent).toContain('铁矿')
    expect(reverse.textContent).toContain('微光')
    // 第一条记录不再额外挂「可丢微光分解」标记
    expect(screen.queryByText('可丢微光分解')).toBeNull()
  })

  it('仅图标时反向记录也只留图标（不显示「微光」文字）', () => {
    const ds: Dataset = makeDataset({
      items: [ironOre, ironBar, shimmer],
      recipes: {
        meta: { gameVersion: '1.4.5.8', count: 1, groupCount: 0, source: 'test', generatedBy: 'test' },
        groups: {},
        recipes: [
          {
            result: { id: 22, stack: 1 },
            ingredients: [{ id: 11, stack: 3 }],
            station: 17,
            stationItems: [],
            env: [],
            flags: [],
          },
        ],
        byResult: { '22': [0] },
        byIngredient: { '11': [0] },
      },
      itemStats: {
        meta: { gameVersion: '1.4.5.8', itemCount: 2, itemsWithTip: 0, source: 'test', generatedBy: 'test', note: '' },
        items: { '22': { stats: { canDecraft: true, decraftStack: 2 } } },
      },
    })
    const { rerender } = render(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={ds} />
      </I18nProvider>,
    )
    rerender(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={ds} iconOnly />
      </I18nProvider>,
    )
    expect(screen.queryByText('微光')).toBeNull()
    expect(screen.getByTestId('reverse-recipe-row')).toBeTruthy()
  })

  it('默认单列；勾选「两列视图」后改 grid-cols-2', () => {
    const { container, rerender } = render(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={dataset} />
      </I18nProvider>,
    )
    const grids = () => [...container.querySelectorAll('.grid')]
    expect(grids().some((g) => g.className.includes('grid-cols-1'))).toBe(true)

    rerender(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={dataset} twoColumn />
      </I18nProvider>,
    )
    expect(grids().some((g) => g.className.includes('grid-cols-2'))).toBe(true)
  })

  it('记录格式：制作站在箭头**前面**（材料 @ 制作站 → 产物）', () => {
    renderPanel()
    const row = screen.getAllByTestId('recipe-row')[0]
    const text = row.textContent ?? ''
    // 顺序：材料 → 制作站（图格 17）→ 产物
    expect(text.indexOf('铁矿')).toBeLessThan(text.indexOf('图格 17'))
    expect(text.indexOf('图格 17')).toBeLessThan(text.indexOf('铁锭'))
  })

  it('徒手制作不写制作站：只留条件（如水桶）', () => {
    const ds: Dataset = makeDataset({
      items: [ironOre, ironBar, shimmer],
      recipes: {
        meta: { gameVersion: '1.4.5.8', count: 2, groupCount: 0, source: 'test', generatedBy: 'test' },
        groups: {},
        recipes: [
          {
            result: { id: 22, stack: 1 },
            ingredients: [{ id: 11, stack: 1 }],
            station: -1,
            stationItems: [],
            // mechdusa 没有对应物品图标 → 回退成文字条件（water 等会画成水桶图标）
            env: ['mechdusa'],
            flags: [],
          },
          {
            result: { id: 11, stack: 1 },
            ingredients: [{ id: 22, stack: 1 }],
            station: -1,
            stationItems: [],
            env: [],
            flags: [],
          },
        ],
        byResult: { '22': [0], '11': [1] },
        byIngredient: { '11': [0], '22': [1] },
      },
    })
    render(
      <I18nProvider lang="zh">
        <RecipePanel itemId={22} dataset={ds} />
      </I18nProvider>,
    )
    const row = screen.getAllByTestId('recipe-row')[0]
    const text = row.textContent ?? ''
    // 条件保留，但不出现「徒手」/「图格 -1」/制作站锤子
    expect(text).toContain('机械美杜莎')
    expect(text).not.toContain('徒手')
    expect(text).not.toContain('图格 -1')
    expect(row.querySelector('.lucide-hammer')).toBeNull()
  })

  it('复制的文本跟随新格式：制作站在箭头前面', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel(false, false)
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    const text = writeText.mock.calls[0][0] as string
    // 铁矿 x3 @ 图格 17 (墓地) → 铁锭
    expect(text).toBe('铁矿 x3 @ 图格 17 (墓地) → 铁锭')
  })
})
