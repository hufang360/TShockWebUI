import { describe, expect, it } from 'vitest'
import {
  EQUIP_GROUP_A,
  EQUIP_GROUP_B,
  findGroup,
  HIDDEN_SLOTS,
  loadoutColumns,
  PLAYER_SLOT_GROUPS,
} from '@/lib/playerSlots'

/**
 * 槽位布局是「数据下标 → 展示分组」的唯一来源：
 * 一旦顺序 / 区间写错，背包就会错位（显示别人的格子），因此这里做机械校验。
 */
describe('PLAYER_SLOT_GROUPS', () => {
  it('展示槽位 349 个 + 隐藏槽（58）= TShock NetItem 的 350 格', () => {
    const shown = PLAYER_SLOT_GROUPS.reduce((sum, g) => sum + g.count, 0)
    expect(shown + HIDDEN_SLOTS.length).toBe(350)
    expect(shown).toBe(349)
  })

  it('区间连续、互不重叠，并跳过隐藏槽（0..349）', () => {
    const sorted = [...PLAYER_SLOT_GROUPS].sort((a, b) => a.start - b.start)
    let cursor = 0
    for (const g of sorted) {
      if (HIDDEN_SLOTS.includes(cursor)) cursor++
      expect(g.start).toBe(cursor)
      cursor += g.count
    }
    if (HIDDEN_SLOTS.includes(cursor)) cursor++
    expect(cursor).toBe(350)
  })

  it('背包主格是 10×5，钱币 / 弹药各一列放在它右边', () => {
    const inv = findGroup('players.group.inventory')
    expect([inv.start, inv.count, inv.cols]).toEqual([0, 50, 10])
    expect([findGroup('players.group.coins').start, findGroup('players.group.coins').cols]).toEqual([50, 1])
    expect([findGroup('players.group.ammo').start, findGroup('players.group.ammo').cols]).toEqual([54, 1])
  })

  it('垃圾桶用 TShock 的 179 号槽', () => {
    expect(findGroup('players.group.trash').start).toBe(179)
  })

  it('装备区两组：A组=染料/时装/装备，B组=杂项染料/杂项装备；都是单格宽竖列', () => {
    expect([...EQUIP_GROUP_B]).toEqual(['players.group.miscDye', 'players.group.miscEquip'])
    expect([...EQUIP_GROUP_A]).toEqual([
      'players.group.dye',
      'players.group.vanity',
      'players.group.armor',
    ])
    for (const key of [...EQUIP_GROUP_A, ...EQUIP_GROUP_B]) {
      expect(findGroup(key).cols).toBe(1)
    }
    // 两组不能有重叠（曾出现 miscDye/miscEquip 被两组同时引用 → 重复渲染）
    const overlap = EQUIP_GROUP_A.filter((k) => (EQUIP_GROUP_B as readonly string[]).includes(k))
    expect(overlap).toEqual([])
  })

  it('配装 3 列：染料(+20) / 时装(+10) / 装备(+0)，各 10 格', () => {
    expect(loadoutColumns(260)).toEqual([
      { key: 'players.group.dye', start: 280, count: 10 },
      { key: 'players.group.vanity', start: 270, count: 10 },
      { key: 'players.group.armor', start: 260, count: 10 },
    ])
  })

  it('右列（第 2 列）只放随身仓储：猪猪 / 保险箱 / 熔炉 / 虚空袋', () => {
    const right = PLAYER_SLOT_GROUPS.filter((g) => g.column === 2).map((g) => g.key)
    expect(right).toEqual([
      'players.group.piggy',
      'players.group.safe',
      'players.group.forge',
      'players.group.void',
    ])
  })
})
