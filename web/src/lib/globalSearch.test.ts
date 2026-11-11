import { House } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { makeDataset, testItems } from '@/test/fixtures'
import { ITEM_COLLECTIONS } from './collections'
import {
  MAX_PER_GROUP,
  MAX_TOTAL,
  rank,
  searchEverything,
  type GlobalSearchSources,
} from './globalSearch'
import type { FishGood } from '@/lib/tshock'
import type { Item } from '@/types'

function sources(overrides: Partial<GlobalSearchSources> = {}): GlobalSearchSources {
  return {
    pages: [
      { id: 'home', label: '首页', icon: House },
      { id: 'items', label: '物品 ID', icon: House },
      { id: 'dataid', label: '数据 ID', icon: House },
      { id: 'commands', label: '指令小抄', icon: House },
    ],
    dataset: makeDataset(),
    goods: [],
    ...overrides,
  }
}

const ids = (list: { id: string }[]) => list.map((hit) => hit.id)

describe('rank', () => {
  it('完全相同 > 前缀 > 包含，忽略大小写与首尾空格', () => {
    expect(rank('zenith', 'Zenith')).toBe(0)
    expect(rank('zen', 'Zenith')).toBe(1)
    expect(rank('enit', 'Zenith')).toBe(2)
    expect(rank('xyz', 'Zenith')).toBe(-1)
    expect(rank('zenith', '   ')).toBe(-1)
  })

  it('多个字段取最好的一条', () => {
    expect(rank('stone', 'StoneWall', 'Stone')).toBe(0)
  })
})

describe('searchEverything', () => {
  it('空词返回空结果（面板自己不显示组）', () => {
    expect(searchEverything(sources(), '')).toEqual([])
    expect(searchEverything(sources(), '   ')).toEqual([])
  })

  it('物品：按名称命中，主操作是就地打开详情', () => {
    const [group] = searchEverything(sources(), '天顶')
    expect(group.id).toBe('items')
    expect(group.hits[0]).toMatchObject({
      name: '天顶剑',
      action: { kind: 'item', itemId: 4956 },
      icon: { kind: 'item', itemId: 4956 },
    })
  })

  it('数字查询优先命中 ID 精确项', () => {
    const [group] = searchEverything(sources(), '29')
    expect(group.id).toBe('items')
    expect(group.hits[0]).toMatchObject({ name: '生命水晶', action: { kind: 'item', itemId: 29 } })
  })

  it('页面：用中文习惯叫法也能找到（别名表）', () => {
    const groups = searchEverything(sources(), '数据')
    const pages = groups.find((g) => g.id === 'pages')
    expect(pages?.hits.map((hit) => hit.action)).toContainEqual({ kind: 'page', tab: 'dataid' })
  })

  it('指令：名称与别名都匹配，跳到指令小抄并带上词', () => {
    const groups = searchEverything(sources(), 'g')
    const commands = groups.find((g) => g.id === 'commands')
    expect(commands?.hits[0].action).toEqual({
      kind: 'prefill',
      tab: 'commands',
      intent: { query: 'give' },
    })
  })

  it('NPC / Buff / 图格：跳到数据 ID 并带上数据源与搜索词', () => {
    const npc = searchEverything(sources(), '眼').find((g) => g.id === 'npcs')
    expect(npc?.hits[0].action).toEqual({
      kind: 'prefill',
      tab: 'dataid',
      intent: { kind: 'npc', query: '克苏鲁之眼' },
    })

    const buff = searchEverything(sources(), '再生').find((g) => g.id === 'buffs')
    expect(buff?.hits[0].action).toEqual({
      kind: 'prefill',
      tab: 'dataid',
      intent: { kind: 'buff', query: '再生' },
    })

    // 图格与墙分成两组（内部名都是 Stone）：右边显示各自的 ID。
    const groups2 = searchEverything(sources(), 'Stone')
    const tiles = groups2.find((g) => g.id === 'tiles')
    const walls = groups2.find((g) => g.id === 'walls')
    expect(tiles?.hits[0]?.meta).toBe('#1')
    expect(tiles?.hits[0]?.action).toEqual({
      kind: 'prefill',
      tab: 'dataid',
      intent: { kind: 'tile', query: tiles?.hits[0]?.name },
    })
    expect(walls?.hits[0]?.meta).toBe('#1')
    expect(walls?.hits[0]?.action).toEqual({
      kind: 'prefill',
      tab: 'dataid',
      intent: { kind: 'wall', query: walls?.hits[0]?.name },
    })
  })

  it('行内操作的数据：ID 域可复制 ID，指令可复制 + 填终端', () => {
    const groups = searchEverything(sources(), '天顶')
    expect(groups.find((g) => g.id === 'items')?.hits[0]).toMatchObject({ copy: '4956' })

    const command = searchEverything(sources(), 'give').find((g) => g.id === 'commands')?.hits[0]
    expect(command).toMatchObject({ copy: '/give', command: '/give', icon: { kind: 'lucide' } })

    const npc = searchEverything(sources(), '眼').find((g) => g.id === 'npcs')?.hits[0]
    expect(npc?.copy).toBe('4')
    const buff = searchEverything(sources(), '再生').find((g) => g.id === 'buffs')?.hits[0]
    expect(buff?.copy).toBe('2')

    const tileGroups = searchEverything(sources(), 'Stone')
    expect(tileGroups.find((g) => g.id === 'tiles')?.hits[0]?.copy).toBe('1')
    expect(tileGroups.find((g) => g.id === 'walls')?.hits[0]?.copy).toBe('1')
  })

  it('没有图标的域也带上图标（物品集合）', () => {
    const collection = ITEM_COLLECTIONS[0]
    const collectionHit = searchEverything(sources(), collection.name).find((g) => g.id === 'collections')?.hits[0]
    expect(collectionHit?.icon).toEqual({ kind: 'lucide', icon: expect.anything() })
  })

  it('鱼店商品：按名称 / 说明命中，跳鱼店并带上词；没有货架时整组不出现', () => {
    const goods = [
      {
        serial: 7,
        name: '传送回出生点',
        iconId: 50,
        cost: '10 金币',
        map: ['服务'],
        desc: '把你传回出生点',
        unlock: '',
        comment: '',
      },
    ] as unknown as FishGood[]

    const group = searchEverything(sources({ goods }), '出生点').find((g) => g.id === 'goods')
    expect(group?.hits[0]).toMatchObject({
      name: '传送回出生点',
      meta: '10 金币',
      icon: { kind: 'item', itemId: 50 },
      action: { kind: 'prefill', tab: 'store', intent: { query: '传送回出生点' } },
    })

    // 说明 / 分类也参与匹配
    expect(searchEverything(sources({ goods }), '服务').find((g) => g.id === 'goods')).toBeTruthy()
    expect(searchEverything(sources(), '出生点').some((g) => g.id === 'goods')).toBe(false)
  })

  it('物品集合：命中后跳到物品图鉴并应用集合', () => {
    const collection = ITEM_COLLECTIONS[0]
    const groups = searchEverything(sources(), collection.name)
    const group = groups.find((g) => g.id === 'collections')
    expect(group?.hits[0].action).toEqual({
      kind: 'prefill',
      tab: 'items',
      intent: { collectionId: collection.id },
    })
  })

  it('不再有「玩家」分组（按需求移除：玩家名不作搜索域）', () => {
    expect(searchEverything(sources(), 'alice')).toEqual([])
  })

  it('每组最多 3 条、总计最多 12 条，被截断的给「全部」出口', () => {
    const many: Item[] = Array.from({ length: 10 }, (_, i) => ({
      ...testItems[0],
      id: 100 + i,
      key: `Stone${i}`,
      name: `石头${i}`,
    }))
    const groups = searchEverything(sources({ dataset: makeDataset({ items: many }) }), '石头')
    const items = groups.find((g) => g.id === 'items')
    expect(items?.hits).toHaveLength(MAX_PER_GROUP)
    expect(items?.total).toBe(10)
    expect(items?.seeAll).toEqual({ tab: 'items', intent: { query: '石头' } })
    expect(groups.reduce((n, g) => n + g.hits.length, 0)).toBeLessThanOrEqual(MAX_TOTAL)
  })

  it('组顺序固定：物品在物品集合之前、页面在最前', () => {
    const groups = searchEverything(sources(), '天顶')
    expect(groups.map((g) => g.id).slice(0, 2)).toEqual(['items', 'collections'])
    const pageGroups = searchEverything(sources(), '物品')
    expect(pageGroups[0].id).toBe('pages')
    expect(ids(pageGroups[0].hits)).toContain('pages:items')
  })
})
