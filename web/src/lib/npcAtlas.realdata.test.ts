import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NpcAtlas } from '@/types'

/**
 * 真实 NPC 图集契约：`tools/gen-npc-atlas.py` 的 `FRAME_GRIDS` 必须和游戏一致。
 *
 * 这 6 个 NPC 的贴图是「多列网格」，游戏在 `Main.DrawNPCDirect` 里用 `Frame(列, 行, ...)`
 * 取单帧。若生成脚本漏了分格，图鉴里会显示成并排的好几帧 / 被裁窄的一条。
 */
const dataDir = resolve(process.cwd(), '../data')
const atlas = JSON.parse(readFileSync(resolve(dataDir, 'npc-atlas.json'), 'utf8')) as NpcAtlas

/** 出处：Terraria/Main.cs `DrawNPCDirect` 的 `Frame(列, 行, ...)`；单帧 = 贴图宽高 / 列行。 */
const FRAME_GRIDS: Record<number, [number, number]> = {
  396: [191, 268], // MoonLordHead                Frame(3, 3)  573/3 × 804/3
  564: [120, 108], // DD2DarkMageT1               Frame(5, 9)  600/5 × 972/9
  565: [120, 108], // DD2DarkMageT3               Frame(5, 9)
  576: [232, 174], // DD2OgreT2                   Frame(5, 10) 1162/5 × 1740/10
  577: [232, 174], // DD2OgreT3                   Frame(5, 10)
  696: [64, 46], // PalworldFoxsparksDistressed Frame(6, 27) 384/6 × 1242/27
}

describe('真实数据：NPC 图集', () => {
  it('元信息与规模合理', () => {
    expect(atlas.meta.sheet).toBe('npc-atlas.png')
    expect(atlas.meta.hash).toMatch(/^[0-9a-f]{12}$/)
    expect(atlas.meta.count).toBe(Object.keys(atlas.regions).length)
  })

  it('所有 region 都在图集范围内', () => {
    const { width, height } = atlas.meta
    const out = Object.entries(atlas.regions).filter(
      ([, [x, y, w, h]]) => x + w > width || y + h > height,
    )
    expect(out).toEqual([])
  })

  it.each(Object.entries(FRAME_GRIDS))(
    '多列网格 NPC %s 取的是单帧（游戏 Frame 分格）',
    (id, [w, h]) => {
      expect(atlas.regions[id]?.slice(2)).toEqual([w, h])
    },
  )
})
