import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NPC_COLLECTIONS, NPC_COLLECTION_BY_ID } from './npcCollections'
import type { Npc } from '@/types'

const npcs = JSON.parse(
  readFileSync(resolve(process.cwd(), '../data/npcs.json'), 'utf8'),
).npcs as Npc[]
const ids = new Set(npcs.map((n) => n.id))

describe('npcCollections', () => {
  it('分类 id 唯一', () => {
    const seen = new Set<string>()
    for (const c of NPC_COLLECTIONS) {
      expect(seen.has(c.id)).toBe(false)
      seen.add(c.id)
    }
  })

  it('每个分类里的 NPC id 都真实存在', () => {
    for (const c of NPC_COLLECTIONS) {
      expect(c.ids.length).toBeGreaterThan(0)
      for (const id of c.ids) {
        expect(ids.has(id), `${c.id} 里的 ${id} 不在 npcs.json`).toBe(true)
      }
    }
  })

  it('NPC 分类包含向导 / 护士等城镇 NPC 与受缚形态', () => {
    const npcIds = NPC_COLLECTION_BY_ID.get('npc')?.ids ?? []
    // 向导 22 / 护士 18 / 商人 17 / 爆破专家 38 / 军火商 19 / 树妖 20
    expect(npcIds).toEqual(expect.arrayContaining([22, 18, 17, 38, 19, 20]))
    // 受缚形态
    expect(npcIds).toEqual(expect.arrayContaining([105, 106, 123, 354, 376, 579]))
    // 猫狗兔 / 城镇史莱姆
    expect(npcIds).toEqual(expect.arrayContaining([637, 638, 656, 670, 678, 679, 680, 681, 682, 683, 684]))
  })

  it('小动物分类包含常见小动物', () => {
    const critterIds = NPC_COLLECTION_BY_ID.get('critter')?.ids ?? []
    expect(critterIds).toEqual(expect.arrayContaining([46, 74, 297, 442, 592]))
  })
})
