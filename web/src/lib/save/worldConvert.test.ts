// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseWorld, type WorldTrack } from './worldFile'
import { parseWorldSections } from './worldStats'
import {
  checkWorldConvert,
  collectWorldUsage,
  convertWorld,
  worldContentIssues,
} from './worldConvert'
import { WORLD_VERSIONS, isSameWorldLayout, worldReleaseSegment, worldVersionOptions } from './worldVersions'
import { buildWorld, type WorldSpec } from '@/test/worldFile'

function tracked(bytes: Uint8Array) {
  const track = {} as WorldTrack
  const parsed = parseWorld(bytes, track)
  return { parsed, track }
}

function smallSpec(extra: Partial<WorldSpec> = {}): WorldSpec {
  return {
    width: 24,
    height: 24,
    tiles: (x, y) => (x === 5 && y === 5 ? { typ: 1 } : { typ: -1 }),
    ...extra,
  }
}

function releaseOf(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getInt32(0, true)
}

function revisionOf(bytes: Uint8Array, track: WorldTrack): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(track.revisionAt, true)
}

describe('世界版本表', () => {
  it('只提供 1.4.4.9–1.4.6.1 的目标，且 release 不重复', () => {
    const releases = WORLD_VERSIONS.map((v) => v.release)
    expect(new Set(releases).size).toBe(releases.length)
    expect(releases[0]).toBe(225) // 1.4.0.1
    expect(releases.at(-1)).toBe(329)
    expect(releases).toContain(230)
    expect(releases).toContain(248)
    expect(releases).toContain(269)
    expect(releases).toContain(315)
    expect(releases).toContain(326)
  })

  it('同布局段：段边界覆盖头部 / 箱子 / NPC / 图格实体 / 闪电 / 蜘蛛', () => {
    expect(isSameWorldLayout(315, 319)).toBe(true)
    expect(isSameWorldLayout(326, 325)).toBe(true)
    expect(isSameWorldLayout(329, 329)).toBe(true)
    // 268（NPC 微光）、294（箱子）、307/308（假人）、315（NPC despawn）、323、328 都是边界
    expect(isSameWorldLayout(267, 268)).toBe(false)
    expect(isSameWorldLayout(293, 294)).toBe(false)
    expect(isSameWorldLayout(306, 307)).toBe(false)
    expect(isSameWorldLayout(307, 308)).toBe(false)
    expect(isSameWorldLayout(314, 315)).toBe(false)
    expect(isSameWorldLayout(322, 323)).toBe(false)
    expect(isSameWorldLayout(327, 328)).toBe(false)
    expect(worldReleaseSegment(225)).toEqual({ lo: 225, hi: 226 })
    expect(worldReleaseSegment(279)).toEqual({ lo: 268, hi: 283 })
  })

  it('下拉：同段的已知版本 + 当前版本', () => {
    expect(worldVersionOptions(326).map((v) => v.release)).toEqual([325, 326])
    // 版本表里没有的 release 也留在选项里
    const opts = worldVersionOptions(300)
    expect(opts.map((v) => v.release)).toContain(300)
  })
})

describe('转换可行性判断', () => {
  it('范围 / 升级不设下限，降级到 1.4.4（269）为止', () => {
    expect(checkWorldConvert(225, 329)).toBeNull() // 1.4.0.1 升到 1.4.6.1
    expect(checkWorldConvert(230, 329)).toBeNull()
    expect(checkWorldConvert(279, 329)).toBeNull()
    expect(checkWorldConvert(329, 269)).toBeNull() // 降级下限 1.4.4
    expect(checkWorldConvert(329, 248)).toBe('downgradeTooOld')
    expect(checkWorldConvert(279, 230)).toBe('downgradeTooOld')
    expect(checkWorldConvert(224, 329)).toBe('sourceTooOld')
    expect(checkWorldConvert(305, 329)).toBe('sourceUnknown') // 预览版不做转换
    expect(checkWorldConvert(279, 340)).toBe('targetTooNew')
    expect(checkWorldConvert(279, 320)).toBe('unknownTarget') // 非正式版本不作为目标
    // 同布局段内改版本不涉及格式（也允许低于降级下限）
    expect(checkWorldConvert(242, 248)).toBeNull()
  })
})

describe('.wld 版本转换（合成世界）', () => {
  it('279 → 329：版本、世界名、箱子 / NPC 都保留', () => {
    const src = buildWorld(
      smallSpec({
        release: 279,
        name: '老世界',
        chests: [{ x: 4, y: 5, name: '箱', items: [[50, 3, 0]] }],
        npcs: [{ netId: 17, name: '商人' }],
      }),
    )
    const { parsed, track } = tracked(src)
    expect(parsed.info.release).toBe(279)
    expect(parsed.info.lastPlayed).toBeNull()

    const out = convertWorld(src, track, 329)
    const after = tracked(out)
    expect(after.parsed.info.release).toBe(329)
    expect(after.parsed.info.name).toBe('老世界')
    // 284 的 lastPlayed 用创建时间补上，所以不再是 null
    expect(after.parsed.info.lastPlayed).toBe(parsed.info.createdAt)
    // 新版本才有的种子默认都没有
    expect(after.parsed.info.specialSeeds).toEqual(parsed.info.specialSeeds)

    const beforeSections = parseWorldSections(src, track, 279)
    const afterSections = parseWorldSections(out, after.track, 329)
    expect(afterSections.chests).toBe(1)
    expect(afterSections.chestList?.[0].items).toEqual(beforeSections.chestList?.[0].items)
    expect(afterSections.npcs).toBe(1)
    expect(afterSections.npcList?.[0].netId).toBe(17)
  })

  it('279 → 329 → 279：除 Revision 外逐字节回到原文件', () => {
    const src = buildWorld(
      smallSpec({
        release: 279,
        chests: [{ x: 4, y: 5, name: '箱', items: [[50, 3, 0]] }],
        npcs: [{ netId: 17, name: '商人' }],
      }),
    )
    const { track } = tracked(src)
    const up = convertWorld(src, track, 329)
    const upTrack = {} as WorldTrack
    parseWorld(up, upTrack)
    const back = convertWorld(up, upTrack, 279)

    expect(releaseOf(back)).toBe(279)
    // Revision 是唯一允许变的 4 字节
    const a = src.slice()
    const b = back.slice()
    const revAt = track.revisionAt
    a.set(b.subarray(revAt, revAt + 4), revAt)
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('跨 294（箱子）与 315（NPC）单独验证', () => {
    const src = buildWorld(
      smallSpec({
        release: 279,
        chests: [{ x: 4, y: 5, name: '箱', items: [[50, 3, 7]] }],
        npcs: [{ netId: 17, name: '商人' }],
      }),
    )
    const { track } = tracked(src)
    const to315 = convertWorld(src, track, 315)
    const t315 = {} as WorldTrack
    parseWorld(to315, t315)
    const sections = parseWorldSections(to315, t315, 315)
    expect(sections.chestList?.[0].items[0]).toMatchObject({ id: 50, stack: 3, prefix: 7 })
    expect(sections.npcList?.[0].netId).toBe(17)

    // 315 → 329 只加头部两个闪电位 + 无蜘蛛位；箱子 / NPC 段不动
    const to329 = convertWorld(to315, t315, 329)
    const t329 = {} as WorldTrack
    const parsed = parseWorld(to329, t329)
    expect(parsed.info.release).toBe(329)
    expect(Array.from(to329.subarray(t329.pointers[2], t329.footerAt))).toEqual(
      Array.from(to315.subarray(t315.pointers[2], t315.footerAt)),
    )
  })

  it('预览版（305）不能当源：段格式（尤其假人 311）没做转换验证', () => {
    const src = buildWorld(smallSpec({ release: 305 }))
    const { track } = tracked(src)
    expect(() => convertWorld(src, track, 329)).toThrow(/sourceUnknown/)
  })

  it('同布局段（325 → 326）：只改 4 字节版本号，Revision 不变', () => {
    const src = buildWorld(smallSpec({ release: 325 }))
    const { track } = tracked(src)
    const out = convertWorld(src, track, 326)
    expect(out.length).toBe(src.length)
    expect(releaseOf(out)).toBe(326)
    expect(revisionOf(out, track)).toBe(revisionOf(src, track))
    // 除版本号外逐字节相同
    const a = src.slice()
    const b = out.slice()
    a.set(b.subarray(0, 4), 0)
    b.set(a.subarray(0, 4), 0)
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('326 → 329：跨 328（无蜘蛛位），头部多 1 字节，其余段不动', () => {
    const src = buildWorld(smallSpec({ release: 326 }))
    const { track } = tracked(src)
    const out = convertWorld(src, track, 329)
    const after = tracked(out)
    expect(after.parsed.info.release).toBe(329)
    expect(out.length).toBe(src.length + 1)
    expect(after.track.headerEnd - after.track.headerAt).toBe(
      track.headerEnd - track.headerAt + 1,
    )
    expect(Array.from(out.subarray(after.track.pointers[2], after.track.footerAt))).toEqual(
      Array.from(src.subarray(track.pointers[2], track.footerAt)),
    )
  })

  it('降级遇到目标版本不认识的内容：拒绝并报出具体 ID', () => {
    // 图格 753 是 1.4.5.7 才有的；1.4.4.9（692）不认识
    const tileWorld = buildWorld(
      smallSpec({ release: 329, tiles: () => ({ typ: 753 }) }),
    )
    const tw = tracked(tileWorld)
    expect(() => convertWorld(tileWorld, tw.track, 279)).toThrow(/图格 ID 753/)

    // 箱子里的物品 6195 也是 1.4.5.7+ 的
    const itemWorld = buildWorld(
      smallSpec({ release: 329, chests: [{ x: 4, y: 5, items: [[6195, 1, 0]] }] }),
    )
    const iw = tracked(itemWorld)
    expect(() => convertWorld(itemWorld, iw.track, 279)).toThrow(/物品 ID 6195/)
  })

  it('collectWorldUsage 读到的最大 ID 与缩略图统计一致', () => {
    const src = buildWorld(
      smallSpec({
        release: 326,
        tiles: (x) => (x === 1 ? { typ: 300, wall: 12 } : { typ: -1 }),
        chests: [{ x: 4, y: 5, items: [[50, 1, 0]] }],
        npcs: [{ netId: 17, name: '商人' }],
      }),
    )
    const { track } = tracked(src)
    const usage = collectWorldUsage(src, track)
    expect(usage.tile).toBe(300)
    expect(usage.wall).toBe(12)
    expect(usage.item).toBe(50)
    expect(usage.npc).toBe(17)
  })

  it('1.4.0.1（225）→ 1.4.6.1：名字 / 箱子 / NPC 保留，NPC 微光列表被补上', () => {
    const src = buildWorld(
      smallSpec({
        release: 225,
        name: '一点四零',
        chests: [{ x: 4, y: 5, name: '箱', items: [[50, 3, 0]] }],
        npcs: [{ netId: 17, name: '商人' }],
      }),
    )
    const { track } = tracked(src)
    const out = convertWorld(src, track, 329)
    const after = tracked(out)
    expect(after.parsed.info.release).toBe(329)
    expect(after.parsed.info.name).toBe('一点四零')

    const before = parseWorldSections(src, track, 225)
    const now = parseWorldSections(out, after.track, 329)
    expect(now.chests).toBe(1)
    expect(now.chestList?.[0].items).toEqual(before.chestList?.[0].items)
    expect(now.npcs).toBe(1)
    expect(now.npcList?.[0].netId).toBe(17)
    // 225 没有微光列表（段首 4 字节），329 有；用「段长度增量」间接验证已经补上
    expect(after.track.pointers[5] - after.track.pointers[4]).toBe(
      track.pointers[5] - track.pointers[4] + 4 + 1, // 微光列表 4 字节 + 每个城镇 NPC 的 despawn 1 字节
    )
  })

  it('1.4.4（269）→ 329 → 269：除 Revision 外逐字节回到原文件（含假人）', () => {
    const src = buildWorld(
      smallSpec({
        release: 269,
        tileEntities: [{ displayDoll: true, id: 0, x: 6, y: 6 }],
      }),
    )
    const { track } = tracked(src)
    const up = convertWorld(src, track, 329)
    const upTrack = {} as WorldTrack
    parseWorld(up, upTrack)
    const back = convertWorld(up, upTrack, 269)

    const a = src.slice()
    const b = back.slice()
    a.set(b.subarray(track.revisionAt, track.revisionAt + 4), track.revisionAt)
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('假人（TEDisplayDoll）：307 / 308 各多 1 字节，升级时补、降级时删', () => {
    const src = buildWorld(
      smallSpec({ release: 269, tileEntities: [{ displayDoll: true, id: 0, x: 6, y: 6 }] }),
    )
    const { track } = tracked(src)
    const entityLen = (t: WorldTrack) => t.pointers[6] - t.pointers[5]
    const beforeLen = entityLen(track)

    const up = convertWorld(src, track, 329)
    const upTrack = {} as WorldTrack
    parseWorld(up, upTrack)
    expect(entityLen(upTrack)).toBe(beforeLen + 2) // pose + bits3

    const back = convertWorld(up, upTrack, 269)
    const backTrack = {} as WorldTrack
    parseWorld(back, backTrack)
    expect(entityLen(backTrack)).toBe(beforeLen)
  })

  it('降级遇到目标版本没有的图格实体类型：拒绝并报出类型 ID', () => {
    // 8 = DeadCellsDisplayJar（1.4.5 才有；1.4.4.9 只到 7）
    const src = buildWorld(
      smallSpec({ release: 329, tileEntities: [{ type: 8, extra: [0, 0, 0, 0, 0] }] }),
    )
    const { track } = tracked(src)
    expect(collectWorldUsage(src, track).entity).toBe(8)
    expect(() => convertWorld(src, track, 279)).toThrow(/图格实体 ID 8/)
  })

  it('内容兼容性判断按类别给出最大 ID', () => {
    const target = WORLD_VERSIONS.find((v) => v.release === 279)!
    expect(worldContentIssues(target, { tile: 693, wall: 0, item: 0, npc: 0, entity: 0 })).toEqual([
      { kind: 'tile', id: 693, max: 692 },
    ])
    expect(worldContentIssues(target, { tile: 692, wall: 346, item: 5455, npc: 687, entity: 7 })).toEqual([])
  })
})
