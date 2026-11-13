// @vitest-environment node
import { House } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { makeDataset, testItems } from '@/test/fixtures'
import { ITEM_COLLECTIONS } from './collections'
import {
  MAX_PER_GROUP,
  MAX_PER_GROUP_DETAIL,
  MAX_TOTAL,
  rank,
  commandInvocation,
  searchEverything,
  searchGroup,
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
      { id: 'tables', label: '常用表格', icon: House },
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

  it('指令：/help、.help、/help 4 都命中 help（TShock 的两种前缀）', () => {
    for (const query of ['/help', '.help', '/help 4']) {
      const commands = searchEverything(sources(), query).find((g) => g.id === 'commands')
      expect(commands?.hits.map((h) => h.id)).toContain('commands:help')
    }
  })

  it('指令：名称与别名都匹配，跳到常用表格并带上词', () => {
    const groups = searchEverything(sources(), 'g')
    const commands = groups.find((g) => g.id === 'commands')
    expect(commands?.hits[0].action).toEqual({
      kind: 'prefill',
      tab: 'tables',
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

describe('commandInvocation', () => {
  it('/help 4 / .help 4 归一成可执行的一行', () => {
    const hit = commandInvocation(sources(), '/help 4')
    expect(hit?.command).toBe('/help 4')
    expect(hit?.runnable).toBe(true)
    // `.` 是 TShock 游戏内前缀，网页侧统一成 `/`。
    expect(commandInvocation(sources(), '.help 4')?.command).toBe('/help 4')
    // 连续空白不制造两条不同的指令。
    expect(commandInvocation(sources(), '/help   4')?.command).toBe('/help 4')
  })

  it('必填参数不拦执行：裸 `/give` 也给（缺参数让 TShock 回用法错误）', () => {
    expect(commandInvocation(sources(), 'help 4')).toBeNull()
    const bare = commandInvocation(sources(), '/give')
    expect(bare?.command).toBe('/give')
    expect(bare?.runnable).toBe(true)
    // 数据里仍有 needsArgs，只用于失败后给「填入终端」。
    expect(bare?.needsArgs).toBe(true)
  })

  it('仅游戏内的指令：给一行但标红且不可执行（回车只是去看用法）', () => {
    const hit = commandInvocation(sources(), '/item 29')
    expect(hit?.inGameOnly).toBe(true)
    expect(hit?.runnable).toBe(false)
    // 指令组里的那行同样带上标记，列表里标红。
    const row = searchEverything(sources(), 'item').find((g) => g.id === 'commands')?.hits[0]
    expect(row?.inGameOnly).toBe(true)
    expect(row?.runnable).toBe(false)
  })

  it('未收录的插件指令也放行（Tier A 交给 TShock 校验）', () => {
    const hit = commandInvocation(sources(), '.wm 4')
    expect(hit?.command).toBe('/wm 4')
    expect(hit?.runnable).toBe(true)
  })
})

describe('searchGroup', () => {
  const many = (count: number): Item[] =>
    Array.from({ length: count }, (_, i) => ({
      ...testItems[0],
      id: 100 + i,
      key: `Stone${i}`,
      name: `石头${i}`,
    }))

  it('二级给前 20 条，超过才给「前往页面」出口', () => {
    const dataset = makeDataset({ items: many(25) })
    const detail = searchGroup(sources({ dataset }), 'items', '石头')
    expect(detail.hits).toHaveLength(MAX_PER_GROUP_DETAIL)
    expect(detail.total).toBe(25)
    expect(detail.seeAll).toEqual({ tab: 'items', intent: { query: '石头' } })

    // 没超过上限：全部都在二级里，不给出口。
    const fits = searchGroup(sources({ dataset: makeDataset({ items: many(8) }) }), 'items', '石头')
    expect(fits.hits).toHaveLength(8)
    expect(fits.seeAll).toBeUndefined()
  })

  it('空词返回空；不支持展开的组（页面）没有出口', () => {
    expect(searchGroup(sources(), 'items', '   ')).toEqual({ group: 'items', hits: [], total: 0 })
    const pages = searchGroup(sources(), 'pages', '页')
    expect(pages.hits.length).toBeGreaterThan(0)
    expect(pages.seeAll).toBeUndefined()
  })

  it('指令二级：必填参数只做标记（needsArgs），不阻止执行', () => {
    const detail = searchGroup(sources(), 'commands', 'give')
    const give = detail.hits.find((hit) => hit.name === '/give')
    expect(give?.runnable).toBe(true)
    expect(give?.needsArgs).toBe(true)
    const help = searchGroup(sources(), 'commands', 'help').hits.find((hit) => hit.name === '/help')
    expect(help?.runnable).toBe(true)
    expect(help?.needsArgs).toBe(false)
  })
})
