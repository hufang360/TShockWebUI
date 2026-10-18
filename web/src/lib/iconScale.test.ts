import { describe, expect, it } from 'vitest'
import {
  ITEM_ICON_SIZE_LIMIT,
  iconContentSize,
  npcContentSize,
  shouldSmooth,
} from '@/lib/iconScale'

/** 真实贴图尺寸（取自 data/items-atlas.json 的 regions）。 */
const COPPER_COIN = [12, 12] as const // id 71
const WOODEN_SWORD = [32, 32] as const // id 24
const ZENITH = [56, 56] as const // id 4956
const LIGHT_DISC_LAUNCHER = [74, 32] as const // id 2796

describe('iconContentSize', () => {
  it('sizeLimit 与游戏 ItemSlot.DrawItemIcon 一致（背包 / 聊天为 32）', () => {
    expect(ITEM_ICON_SIZE_LIMIT).toBe(32)
  })

  it('game：贴图长边 ≤32 时按 1:1（只缩不放）', () => {
    expect(iconContentSize(...COPPER_COIN, 32, 'game')).toEqual({ width: 12, height: 12 })
    expect(iconContentSize(...WOODEN_SWORD, 32, 'game')).toEqual({ width: 32, height: 32 })
  })

  it('game：超过 32 的贴图等比压到 32（天顶剑 56 → 32）', () => {
    expect(iconContentSize(...ZENITH, 32, 'game')).toEqual({ width: 32, height: 32 })
  })

  it('game：长条贴图按最长边约束，长宽比不变（电圈发射器 74×32）', () => {
    const { width, height } = iconContentSize(...LIGHT_DISC_LAUNCHER, 32, 'game')
    expect(width).toBeCloseTo(32, 6)
    expect(height).toBeCloseTo((32 * 32) / 74, 6)
  })

  it('game：box=24（= 游戏聊天 32×0.75 的占位框）时，金币 9px / 木剑 24px / 天顶剑 24px', () => {
    expect(iconContentSize(...COPPER_COIN, 24, 'game')).toEqual({ width: 9, height: 9 })
    expect(iconContentSize(...WOODEN_SWORD, 24, 'game')).toEqual({ width: 24, height: 24 })
    expect(iconContentSize(...ZENITH, 24, 'game')).toEqual({ width: 24, height: 24 })
  })

  it('game：像素取整 —— 方框 >32 时按整数倍放大（避免最近邻宽窄不一）', () => {
    // 40/32 = 1.25 → 1×；44/32 = 1.375 → 1×；48/32 = 1.5 → 1×（floor，用 round 会溢出到 2×）
    expect(iconContentSize(...COPPER_COIN, 40, 'game')).toEqual({ width: 12, height: 12 })
    expect(iconContentSize(...WOODEN_SWORD, 40, 'game')).toEqual({ width: 32, height: 32 })
    expect(iconContentSize(...ZENITH, 40, 'game')).toEqual({ width: 32, height: 32 })
    expect(iconContentSize(...WOODEN_SWORD, 44, 'game')).toEqual({ width: 32, height: 32 })
    expect(iconContentSize(...WOODEN_SWORD, 48, 'game')).toEqual({ width: 32, height: 32 })
    // 64/32 = 2 → 2×
    expect(iconContentSize(...COPPER_COIN, 64, 'game')).toEqual({ width: 24, height: 24 })
    expect(iconContentSize(...WOODEN_SWORD, 64, 'game')).toEqual({ width: 64, height: 64 })
    expect(iconContentSize(...ZENITH, 64, 'game')).toEqual({ width: 64, height: 64 })
  })

  it('game：缩小（方框 ≤32）保持小数，与游戏的 0.85 / 0.75 一致', () => {
    expect(iconContentSize(20, 26, 24, 'game')).toEqual({ width: 15, height: 19.5 })
    expect(iconContentSize(20, 26, 32, 'game')).toEqual({ width: 20, height: 26 })
  })

  it('fit：不做像素取整（旧行为保持原样）', () => {
    expect(iconContentSize(...COPPER_COIN, 40, 'fit')).toEqual({ width: 40, height: 40 })
  })

  it('game：比例与游戏一致 —— 金币长边 / 木剑长边 = 12/32', () => {
    const coin = iconContentSize(...COPPER_COIN, 24, 'game')
    const sword = iconContentSize(...WOODEN_SWORD, 24, 'game')
    expect(coin.width / sword.width).toBeCloseTo(12 / 32, 6)
  })

  it('game：贴图大于方框时与 contain（fit）结果相同，不产生新的缩放误差', () => {
    for (const [w, h] of [ZENITH, LIGHT_DISC_LAUNCHER]) {
      for (const box of [16, 20, 24, 28, 32]) {
        const game = iconContentSize(w, h, box, 'game')
        const fit = iconContentSize(w, h, box, 'fit')
        expect(game.width).toBeCloseTo(fit.width, 9)
        expect(game.height).toBeCloseTo(fit.height, 9)
      }
    }
  })

  it('fit：仍然填满方框（旧行为，保留给特殊场景）', () => {
    expect(iconContentSize(...COPPER_COIN, 20, 'fit')).toEqual({ width: 20, height: 20 })
    expect(iconContentSize(...ZENITH, 20, 'fit')).toEqual({ width: 20, height: 20 })
  })

  it('结果永不超出方框', () => {
    for (const [w, h] of [COPPER_COIN, WOODEN_SWORD, ZENITH, LIGHT_DISC_LAUNCHER]) {
      for (const box of [16, 20, 24, 32, 40, 44, 48, 64, 96]) {
        for (const mode of ['game', 'fit'] as const) {
          const size = iconContentSize(w, h, box, mode)
          expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(box + 1e-9)
        }
      }
    }
  })

  it('默认模式是 game', () => {
    expect(iconContentSize(...COPPER_COIN, 24)).toEqual(iconContentSize(...COPPER_COIN, 24, 'game'))
  })

  it('非法尺寸不抛错，返回 0', () => {
    expect(iconContentSize(0, 0, 20)).toEqual({ width: 0, height: 0 })
    expect(iconContentSize(12, 12, 0)).toEqual({ width: 0, height: 0 })
    expect(iconContentSize(-12, 12, 20)).toEqual({ width: 0, height: 0 })
  })
})

describe('shouldSmooth（采样方式）', () => {
  it('缩小 → 插值（与游戏的 LinearClamp 一致）', () => {
    expect(shouldSmooth(32, 24)).toBe(true) // 结果面板 24px 方框
    expect(shouldSmooth(32, 16)).toBe(true)
    expect(shouldSmooth(56, 12)).toBe(true)
  })

  it('放大 → 最近邻（整数倍放大用插值会发糊、还会渗出 1px 虚边）', () => {
    expect(shouldSmooth(32, 64)).toBe(false) // 大屏 2×
    expect(shouldSmooth(32, 96)).toBe(false)
    expect(shouldSmooth(12, 24)).toBe(false)
  })

  it('1:1 → 不插值（插值是恒等，开关无差别）', () => {
    expect(shouldSmooth(32, 32)).toBe(false)
  })

  it('与 iconContentSize 联动：大屏 2× 时走最近邻，结果面板缩小走插值', () => {
    const big = iconContentSize(32, 32, 64, 'game')
    expect(shouldSmooth(32, big.width)).toBe(false)
    const small = iconContentSize(32, 32, 24, 'game')
    expect(shouldSmooth(32, small.width)).toBe(true)
  })
})

describe('npcContentSize', () => {
  // 真实 NPC 贴图尺寸（取自 data/npc-atlas.json 的 regions）。
  const FIREFLY = [10, 16] as const // 355 萤火虫
  const MERCHANT = [40, 56] as const // 17 商人
  const BUNNY = [48, 40] as const // 46 兔兔
  const EYE_OF_CTHULHU = [110, 166] as const // 4 克苏鲁之眼

  it('game：只缩不放，保留 NPC 之间的原生大小差异（小动物小、城镇 NPC 中等）', () => {
    // 64 方框里都放得下 → 1:1
    expect(npcContentSize(...FIREFLY, 64, 'game')).toEqual({ width: 10, height: 16 })
    expect(npcContentSize(...MERCHANT, 64, 'game')).toEqual({ width: 40, height: 56 })
    expect(npcContentSize(...BUNNY, 64, 'game')).toEqual({ width: 48, height: 40 })
  })

  it('game：超过方框的等比压到方框内（克苏鲁之眼 110×166）', () => {
    const { width, height } = npcContentSize(...EYE_OF_CTHULHU, 64, 'game')
    expect(height).toBeCloseTo(64 * 0.94, 6)
    expect(width).toBeCloseTo((110 * 64 * 0.94) / 166, 6)
    // 长宽比不变
    expect(width / height).toBeCloseTo(110 / 166, 6)
  })

  it('fit：一律填满方框（详情大图用，小虫也看得见）', () => {
    const { width, height } = npcContentSize(...FIREFLY, 144, 'fit')
    expect(width).toBeCloseTo((10 * 144 * 0.94) / 16, 6)
    expect(height).toBeCloseTo(144 * 0.94, 6)
  })

  it('无效尺寸返回 0', () => {
    expect(npcContentSize(0, 16, 64)).toEqual({ width: 0, height: 0 })
  })
})
