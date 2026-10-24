import { describe, expect, it } from 'vitest'
import { buildPlayerShotLayout, playerShotFilename, type ShotLabels } from '@/lib/playerShot'
import { EQUIP_GROUP_A, EQUIP_GROUP_B } from '@/lib/playerSlots'
import { emptyPlayerLook } from '@/lib/tshock'

/**
 * 「导出图片」的**版面**单测（纯函数）。
 * 绘制需要 canvas 2d，jsdom 下没有实现，因此只断言尺寸 / 分组 / 格子落点。
 */

const labels: ShotLabels = {
  status: '本地导入',
  info: ['生命 100 / 100', '魔力 20 / 20'],
  groups: {},
}

describe('buildPlayerShotLayout', () => {
  it('画布尺寸为正，且所有分组与格子都落在画布内', () => {
    const layout = buildPlayerShotLayout(emptyPlayerLook('hf'), labels)
    expect(layout.width).toBeGreaterThan(300)
    expect(layout.height).toBeGreaterThan(400)
    for (const group of layout.groups) {
      for (const slot of group.slots) {
        expect(slot.x).toBeGreaterThanOrEqual(0)
        expect(slot.y).toBeGreaterThanOrEqual(0)
        expect(slot.x + layout.slot).toBeLessThanOrEqual(layout.width)
        expect(slot.y + layout.slot).toBeLessThanOrEqual(layout.height)
      }
    }
  })

  it('包含背包（10×5）+ 钱币 / 弹药 / 垃圾桶 + 装备区五列', () => {
    const layout = buildPlayerShotLayout(emptyPlayerLook('hf'), labels)
    const byKey = new Map(layout.groups.map((g) => [g.key, g]))
    expect(byKey.get('players.group.inventory')?.slots).toHaveLength(50)
    expect(byKey.get('players.group.coins')?.slots).toHaveLength(4)
    expect(byKey.get('players.group.ammo')?.slots).toHaveLength(4)
    expect(byKey.get('players.group.trash')?.slots).toHaveLength(1)
    for (const key of [...EQUIP_GROUP_B, ...EQUIP_GROUP_A]) {
      expect(byKey.get(key)?.slots.length).toBeGreaterThan(0)
    }
  })

  it('垃圾桶在主格第 10 列下方（与页面一致），钱币 / 弹药在主格右侧', () => {
    const layout = buildPlayerShotLayout(emptyPlayerLook('hf'), labels)
    const byKey = new Map(layout.groups.map((g) => [g.key, g]))
    const inv = byKey.get('players.group.inventory')!
    const trash = byKey.get('players.group.trash')!.slots[0]
    // 同一列的第 10 格（索引 9）= 第 1 行最后一列
    expect(trash.x - inv.slots[9].x).toBe(0)
    // 在背包 5 行之下
    expect(trash.y).toBeGreaterThan(inv.slots[49].y)
    const coins = byKey.get('players.group.coins')!.slots[0]
    const ammo = byKey.get('players.group.ammo')!.slots[0]
    expect(coins.x).toBeGreaterThan(inv.slots[9].x + layout.slot)
    expect(ammo.x).toBeGreaterThan(coins.x)
  })

  it('属性行逐行排开；没有属性行时也不为负', () => {
    const withInfo = buildPlayerShotLayout(emptyPlayerLook('hf'), labels)
    expect(withInfo.info).toHaveLength(2)
    expect(withInfo.info[1].y).toBeGreaterThan(withInfo.info[0].y)
    const empty = buildPlayerShotLayout(emptyPlayerLook('hf'), { ...labels, info: [] })
    expect(empty.info).toHaveLength(0)
    expect(empty.height).toBeGreaterThan(0)
  })
})

describe('playerShotFilename', () => {
  it('保留玩家名并去掉文件系统不允许的字符', () => {
    expect(playerShotFilename('hf')).toBe('hf.png')
    expect(playerShotFilename('a/b c:d')).toBe('a_b_c_d.png')
    expect(playerShotFilename('')).toBe('player.png')
  })
})
