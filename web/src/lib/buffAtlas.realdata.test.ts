import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BuffAtlas } from '@/types'

/**
 * 真实 Buff 图集契约：`data/buff-atlas.json` 必须覆盖 `data/buffs.json` 的所有 id，
 * 且每个 region 都是游戏里的 32×32 静态图标（`Content/Images/Buff_<id>.png`）。
 */
const dataDir = resolve(process.cwd(), '../data')
const atlas = JSON.parse(readFileSync(resolve(dataDir, 'buff-atlas.json'), 'utf8')) as BuffAtlas
const buffs = JSON.parse(readFileSync(resolve(dataDir, 'buffs.json'), 'utf8')) as {
  buffs: { id: number }[]
}

describe('真实数据：Buff 图集', () => {
  it('元信息与规模合理', () => {
    expect(atlas.meta.sheet).toBe('buff-atlas.png')
    expect(atlas.meta.hash).toMatch(/^[0-9a-f]{12}$/)
    expect(atlas.meta.count).toBe(Object.keys(atlas.regions).length)
    expect(atlas.meta.missing).toBe(0)
  })

  it('覆盖 data/buffs.json 里的每一个 Buff', () => {
    const missing = buffs.buffs.filter((b) => !atlas.regions[String(b.id)]).map((b) => b.id)
    expect(missing).toEqual([])
  })

  it('所有 region 都在图集范围内，且是 32×32 图标', () => {
    const { width, height } = atlas.meta
    const out = Object.entries(atlas.regions).filter(
      ([, [x, y, w, h]]) => x + w > width || y + h > height || w !== 32 || h !== 32,
    )
    expect(out).toEqual([])
  })
})
