import { describe, expect, it } from 'vitest'
import {
  buildPlayerDrawOps,
  clampHair,
  clampVariant,
  decodeColor,
  hasBackHair,
  isLongCoatVariant,
  PLAYER_DEFAULT_COLORS,
  resolveOps,
} from '@/lib/playerRender'
import { emptyPlayerLook, type PlayerLook } from '@/lib/tshock'
import type { PlayerAtlas } from '@/types'

/** int32 小端 RGBA，与 TShock.Utils.EncodeColor 一致。 */
function encode(r: number, g: number, b: number, a: number): number {
  return (r | (g << 8) | (b << 16) | (a << 24)) | 0
}

function look(overrides: Partial<PlayerLook> = {}): PlayerLook {
  return { ...emptyPlayerLook('hf'), ...overrides }
}

function atlasWith(keys: string[]): PlayerAtlas {
  const regions: PlayerAtlas['regions'] = {}
  keys.forEach((k, i) => {
    regions[k] = [i * 40, 0, 40, 56]
  })
  return {
    meta: {
      gameVersion: '1.4.5.8',
      width: 1000,
      height: 952,
      limitWidth: 1024,
      padding: 0,
      frameWidth: 40,
      frameHeight: 56,
      variants: 12,
      hairs: 228,
      regions: keys.length,
      sheet: 'player-atlas.png',
      generatedBy: 'test',
      note: '',
    },
    regions,
  }
}

describe('decodeColor / 默认色', () => {
  it('null / undefined 回退默认色', () => {
    expect(decodeColor(null, PLAYER_DEFAULT_COLORS.skinColor)).toEqual([255, 125, 90, 255])
    expect(decodeColor(undefined, PLAYER_DEFAULT_COLORS.eyeColor)).toEqual([105, 90, 75, 255])
  })

  it('负数 int32 也能解出 RGBA（A 通道最高位）', () => {
    expect(decodeColor(encode(215, 90, 55, 255), PLAYER_DEFAULT_COLORS.hairColor)).toEqual([
      215, 90, 55, 255,
    ])
    expect(decodeColor(encode(1, 2, 3, 128), PLAYER_DEFAULT_COLORS.skinColor)).toEqual([
      1, 2, 3, 128,
    ])
  })
})

describe('hasBackHair / 变体判定', () => {
  it('backHairDraw 与游戏 GetHairSettings 一致（抽样）', () => {
    for (const h of [6, 51, 55, 64, 73, 78, 90, 93, 95, 113, 115, 133, 134, 146, 162])
      expect(hasBackHair(h), `hair ${h} 应有后发`).toBe(true)
    for (const h of [0, 1, 7, 50, 56, 63, 74, 77, 88, 89, 94, 100, 104, 112, 116, 132])
      expect(hasBackHair(h), `hair ${h} 不应有后发`).toBe(false)
  })

  it('长袍形态仅 3/7/8', () => {
    expect(isLongCoatVariant(3)).toBe(true)
    expect(isLongCoatVariant(7)).toBe(true)
    expect(isLongCoatVariant(8)).toBe(true)
    expect(isLongCoatVariant(0)).toBe(false)
    expect(isLongCoatVariant(4)).toBe(false)
  })

  it('越界值被夹紧', () => {
    expect(clampVariant(99)).toBe(11)
    expect(clampVariant(-3)).toBe(0)
    expect(clampHair(999)).toBe(227)
    expect(clampHair(-1)).toBe(0)
  })
})

describe('buildPlayerDrawOps 合成顺序', () => {
  it('默认男号：后臂/腿/裤子/上衣/头/前臂顺序正确，无后发', () => {
    const ops = buildPlayerDrawOps(look())
    const regions = ops.map((o) => o.region)
    expect(regions).toEqual([
      'b:0:3:torso',
      'b:0:10:leg',
      'b:0:7:backArm',
      'b:0:5:backArm',
      'b:0:8:backArm',
      'b:0:13:backArm',
      'b:0:11:leg',
      'b:0:12:leg',
      'b:0:4:backShoulder',
      'b:0:6:backShoulder',
      'b:0:4:torso',
      'b:0:6:torso',
      'b:0:0:head',
      'b:0:1:eyeWhites',
      'b:0:2:eyes',
      'h:1',
      'b:0:7:frontArm',
      'b:0:8:frontArm',
      'b:0:13:frontArm',
      'b:0:6:frontArm',
      'b:0:7:frontShoulder',
      'b:0:8:frontShoulder',
      'b:0:13:frontShoulder',
      'b:0:6:frontShoulder',
    ])
    // 站立前发源高 54（无后发）
    expect(ops.filter((o) => o.region === 'h:1')[0].srcHeight).toBe(54)
  })

  it('带后发的发型：最底层先画后发，前发裁到 26', () => {
    const ops = buildPlayerDrawOps(look({ hair: 6 }))
    expect(ops[0]).toMatchObject({ region: 'h:6', srcHeight: 54 })
    const front = ops.filter((o) => o.region === 'h:6')
    expect(front).toHaveLength(2)
    expect(front[1].srcHeight).toBe(26)
  })

  it('长袍形态（3/7/8）在裤子之后上衣之前插入 longCoat', () => {
    const ops = buildPlayerDrawOps(look({ skinVariant: 3 }))
    const regions = ops.map((o) => o.region)
    expect(regions.indexOf('b:3:14:longCoat')).toBeGreaterThan(regions.indexOf('b:3:12:leg'))
    expect(regions.indexOf('b:3:14:longCoat')).toBeLessThan(regions.indexOf('b:3:4:backShoulder'))
    expect(regions).not.toContain('b:0:14:longCoat')
  })

  it('女性形态用 variant 4 的贴图键', () => {
    const regions = buildPlayerDrawOps(look({ skinVariant: 4 })).map((o) => o.region)
    expect(regions).toContain('b:4:3:torso')
    expect(regions).toContain('b:4:0:head')
  })

  it('越界外观被夹紧后仍使用合法键', () => {
    const regions = buildPlayerDrawOps(look({ skinVariant: 99, hair: 999 })).map((o) => o.region)
    expect(regions).toContain('b:11:3:torso')
    expect(regions).toContain('h:227')
  })

  it('未设置颜色时使用游戏默认色', () => {
    const ops = buildPlayerDrawOps(look())
    const torso = ops.find((o) => o.region === 'b:0:3:torso')
    const shirt = ops.find((o) => o.region === 'b:0:6:torso')
    expect(torso?.color).toEqual([255, 125, 90, 255])
    expect(shirt?.color).toEqual([175, 165, 140, 255])
  })

  it('设置了颜色时按小端 RGBA 着色', () => {
    const ops = buildPlayerDrawOps(
      look({ skinColor: encode(10, 20, 30, 255), shirtColor: encode(1, 2, 3, 255) }),
    )
    expect(ops.find((o) => o.region === 'b:0:3:torso')?.color).toEqual([10, 20, 30, 255])
    expect(ops.find((o) => o.region === 'b:0:6:torso')?.color).toEqual([1, 2, 3, 255])
  })
})

describe('resolveOps', () => {
  it('过滤掉图集里不存在的区域，绝不抛错', () => {
    const ops = buildPlayerDrawOps(look())
    const atlas = atlasWith(['b:0:3:torso', 'h:1'])
    const resolved = resolveOps(ops, atlas)
    expect(resolved.map((o) => o.region).sort()).toEqual(['b:0:3:torso', 'h:1'])
  })
})
