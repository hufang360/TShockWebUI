import { afterEach, describe, expect, it } from 'vitest'
import { buildPlayerShotLayout, playerShotFilename, renderPlayerShot, type ShotLabels } from '@/lib/playerShot'
import { installCanvasStub } from '@/test/canvasStub'
import { EQUIP_GROUP_A, EQUIP_GROUP_B } from '@/lib/playerSlots'
import { emptyPlayerLook } from '@/lib/tshock'

/**
 * 「导出图片」的**版面**单测（纯函数）+ 一条**编码链路**用例（`test/canvasStub.ts` 提供 canvas 桩）。
 * jsdom 本身没有 canvas 2d，所以绘制细节只能靠桩记录「画布尺寸 / 文本 / PNG 类型」来断言。
 */

let stub: ReturnType<typeof installCanvasStub> | null = null
afterEach(() => {
  stub?.restore()
  stub = null
})

const labels: ShotLabels = {
  status: '本地导入',
  info: ['生命 100 / 100', '魔力 20 / 20'],
  groups: {},
  boostTitle: '永久增强',
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
    // 在背包 5 行之下，且**紧接**下一行（垃圾桶那格没有标题占位）
    const pitch = inv.slots[9].x - inv.slots[8].x
    expect(trash.y).toBe(inv.slots[49].y + pitch)
    // 垃圾桶不画标题文字（页面上只有一个带图标的格子，之前图片里多印了「垃圾桶」三个字）
    expect(byKey.get('players.group.trash')!.label).toBe('')
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

describe('导出图片：真的走到编码（canvas 桩）', () => {
  it('画布尺寸 = 布局 × pixelRatio，文本里有角色名，输出 image/png', async () => {
    stub = installCanvasStub()
    const look = { ...emptyPlayerLook('搬运工'), health: 400, maxHealth: 500 }
    const labels = { status: '', info: ['生命 400 / 500'], groups: {}, boostTitle: '永久增强' }
    const layout = buildPlayerShotLayout(look, labels)
    const blob = await renderPlayerShot(look, labels, null, 2)

    expect(blob.type).toBe('image/png')
    expect(stub.log.canvases).toEqual([
      { width: Math.round(layout.width * 2), height: Math.round(layout.height * 2) },
    ])
    expect(stub.log.texts).toContain('搬运工')
    expect(stub.log.texts).toContain('生命 400 / 500')
    expect(stub.log.blobTypes).toEqual(['image/png'])
  })
})
