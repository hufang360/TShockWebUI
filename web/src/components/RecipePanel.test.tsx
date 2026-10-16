import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import type { Item, RecipesData } from '@/types'
import { RecipePanel } from './RecipePanel'

const recipes: RecipesData = {
  meta: { gameVersion: '1.4.5.8', count: 2, groupCount: 1, source: 'test', generatedBy: 'test' },
  groups: { Wood: { key: 'ItemName.Wood', items: [9, 619] } },
  recipes: [
    {
      result: { id: 29, stack: 1 },
      ingredients: [
        { id: 9, stack: 5, group: 'Wood' },
        { id: 75, stack: 3 },
      ],
      station: 18,
      stationItems: [36],
    },
    {
      result: { id: 4956, stack: 1 },
      ingredients: [{ id: 29, stack: 1 }],
      station: 16,
      stationItems: [35, 716],
      env: ['water'],
      flags: ['crimson'],
    },
  ],
  byResult: { '29': [0], '4956': [1] },
  byIngredient: { '29': [1], '9': [0], '619': [0], '75': [0] },
}

function makeItem(id: number, name: string, key: string): Item {
  return { id, key, name, icon: id, frames: 1, sprite: [16, 16], tags: [] }
}

const items = [
  makeItem(29, '生命水晶', 'LifeCrystal'),
  makeItem(75, '坠落之星', 'FallenStar'),
  makeItem(4956, '天顶剑', 'Zenith'),
  makeItem(9, '木材', 'Wood'),
  makeItem(36, '工作台', 'WorkBench'),
  makeItem(35, '铁砧', 'IronAnvil'),
  makeItem(716, '铅砧', 'LeadAnvil'),
]

function renderPanel(itemId: number) {
  render(
    <I18nProvider lang="zh">
      <RecipePanel itemId={itemId} dataset={makeDataset({ items, recipes })} />
    </I18nProvider>,
  )
}

describe('RecipePanel', () => {
  it('展示「合成表」与「用于合成」，并渲染配方组', () => {
    renderPanel(29)
    expect(screen.getByText('合成表（1）')).toBeTruthy()
    expect(screen.getByText('用于合成（1）')).toBeTruthy()
    expect(screen.getByText('任何木材')).toBeTruthy()
    // 制作站工作台（物品 36）
    expect(screen.getByText('工作台')).toBeTruthy()
  })

  it('展示制作站、环境与阵营标记', () => {
    renderPanel(4956)
    expect(screen.getByText('合成表（1）')).toBeTruthy()
    expect(screen.getByText('水中')).toBeTruthy()
    expect(screen.getByText('猩红')).toBeTruthy()
  })

  it('无配方时给出提示', () => {
    renderPanel(999999)
    expect(screen.getByText('无合成配方，也不是合成材料。')).toBeTruthy()
  })
})
