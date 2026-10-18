import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n'
import { makeDataset } from '@/test/fixtures'
import { ItemDropsPanel } from './ItemDropsPanel'

const crate = {
  id: 2334,
  key: 'WoodenCrate',
  name: '木匣',
  icon: 2334,
  frames: 1,
  sprite: [16, 16] as [number, number],
  tags: [],
}
const boots = {
  id: 3200,
  key: 'SailfishBoots',
  name: '旗鱼靴',
  icon: 3200,
  frames: 1,
  sprite: [16, 16] as [number, number],
  tags: [],
}

const drop = { id: 3200, chance: 0.0478, minStack: 1, maxStack: 1 }
const dataset = makeDataset({
  items: [crate, boots],
  itemDrops: {
    meta: { gameVersion: '1.4.5.8', trials: 1_000_000, source: 'test', generatedBy: 'test', note: '' },
    items: { '2334': [drop] },
  },
  itemDropsById: new Map([[2334, [drop]]]),
})

describe('ItemDropsPanel', () => {
  it('显示掉落：物品 + 数量 + 概率 + 模拟次数', () => {
    render(
      <I18nProvider lang="zh">
        <ItemDropsPanel itemId={2334} dataset={dataset} />
      </I18nProvider>,
    )
    expect(screen.getByText('掉落（1）')).toBeTruthy()
    expect(screen.getByText('旗鱼靴')).toBeTruthy()
    // Wiki 风格：4.78% → ≈1/21
    expect(screen.getByText('≈1/21')).toBeTruthy()
    expect(screen.getByText(/仅供参考/)).toBeTruthy()
  })

  it('没有掉落数据时不渲染', () => {
    const { container } = render(
      <I18nProvider lang="zh">
        <ItemDropsPanel itemId={4956} dataset={dataset} />
      </I18nProvider>,
    )
    expect(container.textContent).toBe('')
  })

  it('概率 / 模拟次数是可选字段：缺失时不崩、不显示', () => {
    const noChance = makeDataset({
      items: [crate, boots],
      itemDrops: {
        meta: { gameVersion: '', trials: 0, source: '', generatedBy: '', note: '' },
        items: { '2334': [{ id: 3200, chance: Number.NaN, minStack: 1, maxStack: 1 }] },
      },
      itemDropsById: new Map([[2334, [{ id: 3200, chance: Number.NaN, minStack: 1, maxStack: 1 }]]]),
    })
    render(
      <I18nProvider lang="zh">
        <ItemDropsPanel itemId={2334} dataset={noChance} />
      </I18nProvider>,
    )
    expect(screen.getByText('掉落（1）')).toBeTruthy()
    expect(screen.queryByText(/仅供参考/)).toBeNull()
  })
})

describe('真实数据：木匣掉落', () => {
  const dataDir = resolve(process.cwd(), '../data')
  it('wooden crate 掉落里包含旗鱼靴 / 海啸瓶 / 提炼机（实测概率 > 0）', () => {
    const drops = JSON.parse(readFileSync(resolve(dataDir, 'item-drops.json'), 'utf8')) as {
      meta: { trials: number }
      items: Record<string, Array<{ id: number; chance: number }>>
    }
    expect(drops.meta.trials).toBeGreaterThan(0)
    const ids = new Set((drops.items['2334'] ?? []).map((d) => d.id))
    for (const id of [3200, 3201, 997]) expect(ids.has(id)).toBe(true)
  })
})
