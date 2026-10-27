import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildWorld, Writer } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from './worldFile'
import { parseWorldSections } from './worldStats'
import { renderWorldThumbnail } from './worldThumb'

function analyzed(bytes: Uint8Array) {
  const track = { bosses: {} } as unknown as WorldTrack
  const parsed = parseWorld(bytes, track)
  return {
    parsed,
    track,
    sections: parseWorldSections(bytes, track, parsed.info.release),
    thumb: () => renderWorldThumbnail(bytes, parsed),
  }
}

/** 10×10 小世界：上半（y<5）空气 + 水，下半石头，最后两列泥土。 */
function sampleWorld() {
  return buildWorld({
    width: 10,
    height: 10,
    tiles: (x, y) => {
      if (y < 5) return { typ: -1, liquid: 1, liquidAmount: 255 }
      return x >= 8 ? { typ: 0 } : { typ: 1, wall: 2 }
    },
    chests: [
      { x: 1, y: 6, name: '宝箱', items: [[29, 3], [75, 99]] },
      { x: 2, y: 6, items: [[29, 2]] },
    ],
    signs: [{ x: 3, y: 2, text: '你好' }],
    npcs: [
      { netId: 22, name: '向导' },
      { netId: 17, name: '商人' },
    ],
    tileEntities: 3,
  })
}

describe('地图分析：图格 / 墙 / 液体', () => {
  it('空气 + 图格 = 总格数，液体与墙按格数累加', async () => {
    const { thumb } = analyzed(sampleWorld())
    const stats = (await thumb()).stats
    expect(stats.total).toBe(100)
    expect(stats.air).toBe(50) // y<5 五行没有图格（有液体也算空气）
    expect(stats.tiles.get(1)).toBe(40) // 5 行 × 8 列
    expect(stats.tiles.get(0)).toBe(10) // 最后两列 × 5 行
    expect(stats.air + [...stats.tiles.values()].reduce((a, b) => a + b, 0)).toBe(100)
    expect(stats.liquid.water).toBe(50)
    expect(stats.liquid.lava).toBe(0)
    expect(stats.walls.get(2)).toBe(40) // 石头格上的墙
  })

  it('RLE 重复的每一格都计入（不能只算一次）', async () => {
    const bytes = buildWorld({
      width: 2,
      height: 100,
      // 两列各 1 条 RLE：整列都是石头（repeat 99）
      tiles: (x) => ({ typ: x === 0 ? 1 : 2, repeat: 99 }),
    })
    const { thumb } = analyzed(bytes)
    const stats = (await thumb()).stats
    expect(stats.tiles.get(1)).toBe(100)
    expect(stats.tiles.get(2)).toBe(100)
    expect(stats.air).toBe(0)
  })

  it('分层：边界按 groundLevel / rockLevel / 高度-200 切，跨层 RLE 会拆开计入', async () => {
    // 20 宽 × 240 高：groundLevel=20、rockLevel=100、地狱从 240-200 = 40 → 夹到 >= cavern(100)
    const bytes = buildWorld({
      width: 20,
      height: 240,
      groundLevel: 20,
      rockLevel: 100,
      // 每列一整条 RLE（240 格），会跨过两个层边界
      tiles: () => ({ typ: 1, repeat: 239 }),
    })
    const { thumb } = analyzed(bytes)
    const stats = (await thumb()).stats
    expect(stats.zoneBounds[0]).toBe(0)
    expect(stats.zoneBounds[1]).toBe(20)
    expect(stats.zoneBounds[2]).toBe(100)
    // 地狱起点 = max(cavern, height-200=40) = 100（与洞穴同界，所以洞穴层为空）
    expect(stats.zoneBounds[3]).toBe(100)
    const byKey = new Map(stats.zones.map((z) => [z.key, z]))
    expect(byKey.get('surface')!.total).toBe(20 * 20) // y 0–19
    expect(byKey.get('underground')!.total).toBe(20 * 80) // y 20–99
    expect(byKey.get('cavern')!.total).toBe(0) // 被地狱起点顶掉
    expect(byKey.get('underworld')!.total).toBe(20 * 140) // y 100–239
    // 每层加起来 = 总格数
    expect(stats.zones.reduce((n, z) => n + z.total, 0)).toBe(stats.total)
    // 全部是石头 → 每层的图格数等于该层格数
    expect(byKey.get('underworld')!.tiles.get(1)).toBe(2800)
  })

  it('真实 demo 世界：分层合计等于总格数', async () => {
    const bytes = new Uint8Array(readFileSync('public/demo/world.wld'))
    const { thumb } = analyzed(bytes)
    const stats = (await thumb()).stats
    expect(stats.zones.reduce((n, z) => n + z.total, 0)).toBe(stats.total)
    expect(stats.zones.reduce((n, z) => n + z.air, 0)).toBe(stats.air)
    // 地狱层存在（高度 1200 → 从 1000 起）且基本是灰烬/石头
    expect(stats.zones[3].key).toBe('underworld')
    expect(stats.zones[3].total).toBeGreaterThan(0)
  })

  it('真实 demo 世界：空气占比与总格数自洽', async () => {
    const bytes = new Uint8Array(readFileSync('public/demo/world.wld'))
    const { parsed, thumb } = analyzed(bytes)
    const stats = (await thumb()).stats
    expect(stats.total).toBe(parsed.info.width * parsed.info.height)
    expect(stats.air + [...stats.tiles.values()].reduce((a, b) => a + b, 0)).toBe(stats.total)
    // 空白世界：石头 / 土 / 其它，不会出现负数或离谱占比
    expect(stats.air / stats.total).toBeGreaterThan(0.4)
    expect(stats.air / stats.total).toBeLessThan(0.5)
  })
})

describe('地图分析：箱子 / 招牌 / NPC / 图格实体', () => {
  it('精确统计数量与箱子物品（同 id 合并）', () => {
    const { sections } = analyzed(sampleWorld())
    expect(sections.chests).toBe(2)
    expect(sections.signs).toBe(1)
    expect(sections.npcs).toBe(2)
    expect(sections.tileEntities).toBe(3)
    expect(sections.chestItemKinds).toBe(2)
    expect([...sections.chestItems!.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [29, 5], // 生命水晶 3 + 2
      [75, 99],
    ])
  })

  it('NPC 段被截断时降级为 null，而不是抛错', () => {
    const bytes = buildWorld({
      width: 8,
      height: 8,
      tiles: () => ({ typ: -1 }),
      npcs: [{ netId: 22, name: '向导' }],
    })
    const track = { bosses: {} } as unknown as WorldTrack
    parseWorld(bytes, track)
    // 把 NPC 段的结束指针提前，制造「读不完」的段
    const broken = { ...track, pointers: [...track.pointers] }
    broken.pointers[5] = broken.pointers[5] - 6
    expect(parseWorldSections(bytes, broken, 326).npcs).toBeNull()
  })

  it('明细：逐箱内容 / 招牌全文 / NPC 名字与位置', () => {
    const bytes = buildWorld({
      width: 8,
      height: 8,
      tiles: () => ({ typ: -1 }),
      chests: [
        { x: 1, y: 2, name: '宝箱', items: [[29, 3], [4956, 1, 82]] },
        { x: 3, y: 4, items: [] },
      ],
      signs: [{ x: 5, y: 6, text: '第一行\n第二行' }],
      npcs: [{ netId: 22, name: 'Cole' }],
    })
    const { sections } = analyzed(bytes)
    expect(sections.chestList).toHaveLength(2)
    expect(sections.chestList![0]).toMatchObject({ x: 1, y: 2, name: '宝箱' })
    expect(sections.chestList![0].items).toMatchObject([
      { slot: 0, id: 29, stack: 3, prefix: 0, rawStack: 3 },
      { slot: 1, id: 4956, stack: 1, prefix: 82, rawStack: 1 },
    ])
    expect(sections.chestList![1].items).toEqual([])
    expect(sections.signList).toEqual([{ x: 5, y: 6, text: '第一行\n第二行' }])
    expect(sections.npcList).toHaveLength(1)
    expect(sections.npcList![0]).toMatchObject({ netId: 22, name: 'Cole', homeX: 4, homeY: 20 })
  })

  it('段指针异常时对应项为 null，而不是抛错', () => {
    const bytes = sampleWorld()
    const track = { bosses: {} } as unknown as WorldTrack
    parseWorld(bytes, track)
    // 把箱子段指针弄成越界：统计应当降级为 null
    const broken = { ...track, pointers: [...track.pointers] }
    broken.pointers[3] = bytes.length + 999
    const sections = parseWorldSections(bytes, broken, 326)
    // 箱子段越界 → 只降级这一项（后面的段也会因为起点错位而不可用，这是预期）
    expect(sections.chests).toBeNull()
  })
})

/**
 * NPC 段是**门槛最多**的一段（`WorldFile.LoadNPCs`）：微光列表 ≥268、`BitsByte` ≥213、
 * `homelessDespawn` ≥315、老于 190 的 netID 是旧版名字字符串。少读 / 多读一个字节，
 * 后面的 NPC 全部读偏（真实验证时 1.4.3 的世界就是这样读出一串乱码）。
 * 这里手搓各版本的 NPC 段，逐条钉死。
 */
describe('地图分析：NPC 段的版本门槛', () => {
  interface NpcSpec {
    netId?: number
    legacyName?: string
    name: string
    homeless?: boolean
    variation?: number
    despawn?: boolean
  }

  function npcSection(
    release: number,
    npcs: NpcSpec[],
    opts: { shimmered?: number[]; others?: { netId: number }[] } = {},
  ): { bytes: Uint8Array; track: WorldTrack } {
    const w = new Writer()
    w.i16(0) // 第 3 段：箱子（空）
    const endChests = w.length
    w.i16(0) // 第 4 段：招牌（空）
    const endSigns = w.length
    if (release >= 268) {
      w.i32(opts.shimmered?.length ?? 0)
      for (const id of opts.shimmered ?? []) w.i32(id)
    }
    for (const npc of npcs) {
      w.bool(true)
      // ≥190 是 int32 netID；更老存的是旧版名字
      if (release >= 190) w.i32(npc.netId ?? 0)
      else w.str(npc.legacyName ?? 'Guide')
      w.str(npc.name)
      w.f32(100)
      w.f32(200)
      w.bool(npc.homeless ?? false)
      w.i32(10)
      w.i32(20)
      if (release >= 213) {
        w.u8(npc.variation ? 1 : 0)
        if (npc.variation) w.i32(npc.variation)
      }
      if (release >= 315) w.bool(npc.despawn ?? false)
    }
    w.bool(false) // 城镇 NPC 循环结束
    // 第二个循环（保存 / 加载用 NPC）
    for (const other of opts.others ?? []) {
      w.bool(true)
      if (release >= 190) w.i32(other.netId)
      else w.str('Bunny')
      w.f32(1)
      w.f32(2)
    }
    w.bool(false)
    const endNpcs = w.length
    w.i32(0) // 第 6 段：图格实体
    const endEntities = w.length
    const track = {
      pointers: [0, 0, 0, endChests, endSigns, endNpcs, endEntities],
    } as unknown as WorldTrack
    return { bytes: w.toBytes(), track }
  }

  it('1.4.5.8（326）：微光列表 + BitsByte + homelessDespawn 全有', () => {
    const { bytes, track } = npcSection(
      326,
      [
        { netId: 22, name: '向导', variation: 7, despawn: true },
        { netId: 37, name: '' }, // 老人：文件名里 GivenName 本来就是空
      ],
      { shimmered: [17], others: [{ netId: 22 }] },
    )
    const sections = parseWorldSections(bytes, track, 326)
    expect(sections.npcs).toBe(3) // 2 个城镇 NPC + 1 个微光化（只有 id）
    expect(sections.npcList?.map((n) => [n.netId, n.name])).toEqual([
      [22, '向导'],
      [37, ''],
    ])
    expect(sections.npcList?.[0]).toMatchObject({
      x: 100,
      y: 200,
      homeless: false,
      homeX: 10,
      homeY: 20,
    })
  })

  it('1.4.3（279）：有微光列表，但**没有** homelessDespawn 位', () => {
    const { bytes, track } = npcSection(
      279,
      [
        { netId: 22, name: '向导', variation: 3 },
        { netId: 18, name: '护士', homeless: true },
      ],
      { shimmered: [20] },
    )
    const sections = parseWorldSections(bytes, track, 279)
    expect(sections.npcs).toBe(3)
    expect(sections.npcList?.map((n) => [n.netId, n.name, n.homeless])).toEqual([
      [22, '向导', false],
      [18, '护士', true],
    ])
  })

  it('1.4.0.5（221）：没有微光列表，BitsByte 有、homelessDespawn 没有', () => {
    const { bytes, track } = npcSection(221, [{ netId: 22, name: '向导', variation: 2 }])
    const sections = parseWorldSections(bytes, track, 221)
    expect(sections.npcs).toBe(1)
    expect(sections.npcList?.[0]).toMatchObject({ netId: 22, name: '向导', homeless: false })
  })

  it('1.3.0（168，<190）：netID 与第二个循环都用旧版名字字符串', () => {
    const { bytes, track } = npcSection(168, [{ legacyName: 'Guide', name: 'Andrew' }], {
      others: [{ netId: 0 }],
    })
    const sections = parseWorldSections(bytes, track, 168)
    expect(sections.npcs).toBe(1)
    expect(sections.npcList).toEqual([
      { netId: 0, name: 'Andrew', x: 100, y: 200, homeX: 10, homeY: 20, homeless: false },
    ])
  })

  it('1.3.5（194）：netID 存的是旧版名字，跳过字符串、netId 记 0', () => {
    const { bytes, track } = npcSection(194, [
      { legacyName: 'Guide', name: 'Andrew' },
      { legacyName: 'Nurse', name: 'Amy' },
    ])
    const sections = parseWorldSections(bytes, track, 194)
    expect(sections.npcs).toBe(2)
    expect(sections.npcList?.map((n) => [n.netId, n.name])).toEqual([
      [0, 'Andrew'],
      [0, 'Amy'],
    ])
  })
})

/**
 * 箱子段也有版本门槛（`WorldFile.LoadChests`）：
 * - `release < 294`：容量是**整段共享的一个 int16**，写在箱子列表之前；≥294 才是每个箱子自带 int32。
 *   这一条漏了的话，1.4.4.9 及更早的真实世界会**一个箱子都读不出来**（实测：3 个真实世界 332 / 489 / 499 个箱子全丢）。
 * - `stack < 0` 不是空槽：游戏用它表示「只堆 1 个但带词缀」，后面仍跟 `int32 id + u8 prefix`；只有 0 才是空槽。
 */
describe('地图分析：箱子段的版本门槛', () => {
  function chestSection(
    release: number,
    chests: { x: number; y: number; name?: string; items?: [id: number, stack: number, prefix?: number][] }[],
  ): { bytes: Uint8Array; track: WorldTrack } {
    const capacity = 40
    const w = new Writer()
    w.i16(chests.length)
    const shared = release < 294
    if (shared) w.i16(capacity)
    for (const chest of chests) {
      w.i32(chest.x)
      w.i32(chest.y)
      w.str(chest.name ?? '')
      if (!shared) w.i32(capacity)
      for (let slot = 0; slot < capacity; slot++) {
        const item = chest.items?.[slot]
        if (!item) {
          w.i16(0)
          continue
        }
        const [id, stack, prefix = 0] = item
        w.i16(stack)
        if (stack !== 0) {
          w.i32(id)
          w.u8(prefix)
        }
      }
    }
    const endChests = w.length
    w.i16(0) // 招牌段（空）
    const endSigns = w.length
    if (release >= 268) w.i32(0) // NPC 段：微光化列表（空）
    w.bool(false) // 城镇 NPC 循环结束
    w.bool(false) // 第二个循环结束
    const endNpcs = w.length
    w.i32(0) // 图格实体段
    const endEntities = w.length
    const track = {
      pointers: [0, 0, 0, endChests, endSigns, endNpcs, endEntities],
    } as unknown as WorldTrack
    return { bytes: w.toBytes(), track }
  }

  const chests = [
    { x: 1, y: 2, name: '宝箱', items: [[29, 3], [75, 99]] as [number, number][] },
    { x: 5, y: 6, items: [] as [number, number][] },
  ]

  it('1.4.4.9（279）：容量是共享 int16，箱子与物品都要读出来', () => {
    const { bytes, track } = chestSection(279, chests)
    const sections = parseWorldSections(bytes, track, 279)
    expect(sections.chests).toBe(2)
    expect(sections.chestList).toHaveLength(2)
    expect(sections.chestList![0]).toMatchObject({ x: 1, y: 2, name: '宝箱' })
    expect(sections.chestList![0].items).toMatchObject([
      { slot: 0, id: 29, stack: 3, prefix: 0 },
      { slot: 1, id: 75, stack: 99, prefix: 0 },
    ])
    expect(sections.chestItems!.get(29)).toBe(3)
    expect(sections.chestItems!.get(75)).toBe(99)
    expect(sections.chestItemKinds).toBe(2)
  })

  it('1.4.5.8（326）：每个箱子自带 int32 容量', () => {
    const { bytes, track } = chestSection(326, chests)
    const sections = parseWorldSections(bytes, track, 326)
    expect(sections.chests).toBe(2)
    expect(sections.chestList![0].items).toHaveLength(2)
    expect(sections.chestList![1].items).toEqual([])
  })

  it('stack 为负 = 「1 个但带词缀」，仍要读 id + prefix（不是空槽）', () => {
    const { bytes, track } = chestSection(326, [
      { x: 3, y: 4, items: [[4956, -1, 82], [29, 0]] },
    ])
    const sections = parseWorldSections(bytes, track, 326)
    expect(sections.chestList![0].items).toMatchObject([
      { slot: 0, id: 4956, stack: 1, prefix: 82, rawStack: -1 },
    ])
    expect(sections.chestItems!.get(4956)).toBe(1)
  })
})
