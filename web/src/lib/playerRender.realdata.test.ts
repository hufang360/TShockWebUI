import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlayerDrawOps, resolveOps } from '@/lib/playerRender'
import { emptyPlayerLook, type PlayerLook } from '@/lib/tshock'
import type { PlayerAtlas } from '@/types'

/**
 * 真实角色图集契约：`tools/gen-player-atlas.py` 产出的 key 必须覆盖
 * 前端对**每个 skinVariant** 生成的全部绘制层。防止生成脚本与渲染逻辑漂移。
 */
const dataDir = resolve(process.cwd(), '../data')
const atlas = JSON.parse(
  readFileSync(resolve(dataDir, 'player-atlas.json'), 'utf8'),
) as PlayerAtlas

function lookWith(overrides: Partial<PlayerLook>): PlayerLook {
  return { ...emptyPlayerLook('hf'), ...overrides }
}

describe('真实数据：玩家角色图集', () => {
  it('元信息与规模合理', () => {
    expect(atlas.meta.frameWidth).toBe(40)
    expect(atlas.meta.frameHeight).toBe(56)
    expect(atlas.meta.variants).toBe(12)
    expect(atlas.meta.hairs).toBe(228)
    expect(atlas.meta.sheet).toBe('player-atlas.png')
    expect(Object.keys(atlas.regions).length).toBeGreaterThan(400)
    expect(atlas.meta.width).toBeLessThanOrEqual(atlas.meta.limitWidth)
  })

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
    'skinVariant=%i 的所有绘制层都能在图集中找到',
    (variant) => {
      const ops = buildPlayerDrawOps(lookWith({ skinVariant: variant, hair: 1 }))
      const missing = ops.map((o) => o.region).filter((k) => atlas.regions[k] == null)
      expect(missing).toEqual([])
      expect(resolveOps(ops, atlas)).toHaveLength(ops.length)
    },
  )

  it('抽样发型（含后发）都能找到前发与后发', () => {
    for (const hair of [0, 1, 6, 51, 64, 133, 227]) {
      const ops = buildPlayerDrawOps(lookWith({ hair }))
      expect(atlas.regions[`h:${hair}`], `缺发型 h:${hair}`).toBeTruthy()
      for (const op of ops) expect(atlas.regions[op.region]).toBeTruthy()
    }
  })

  it('每个区域都是合法的 40×56 像素框', () => {
    for (const [key, rect] of Object.entries(atlas.regions)) {
      expect(rect, key).toHaveLength(4)
      expect(rect[2]).toBe(40)
      expect(rect[3]).toBe(56)
    }
  })
})
