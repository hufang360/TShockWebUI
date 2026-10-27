import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWorld, type WorldTrack } from './worldFile'
import { applyWorldEdits, encodeDotNetString } from './worldWrite'

const demo = () => new Uint8Array(readFileSync('public/demo/world.wld'))

function parseTracked(data: Uint8Array) {
  const track = { bosses: {} } as unknown as WorldTrack
  const parsed = parseWorld(data, track)
  return { parsed, track }
}

/** footer 里的世界名（自己按结构读一遍，验证「写进去的名字确实能被读出来」）。 */
function footerName(bytes: Uint8Array, track: WorldTrack): string {
  let p = track.footerAt + 1 // 跳过 bool true
  let len = 0
  let shift = 0
  for (;;) {
    const b = bytes[p++]
    len |= (b & 0x7f) << shift
    shift += 7
    if ((b & 0x80) === 0) break
  }
  return new TextDecoder().decode(bytes.subarray(p, p + len))
}

describe('.wld 写回', () => {
  it('空编辑：输出与输入逐字节相同', () => {
    const raw = demo()
    const { track } = parseTracked(raw)
    expect(Array.from(applyWorldEdits(raw, track, {}))).toEqual(Array.from(raw))
  })

  it('A 级（定长字段）就地补丁：只改那几字节，段指针与长度都不变', () => {
    const raw = demo()
    const { parsed, track } = parseTracked(raw)
    const out = applyWorldEdits(raw, track, {
      gameMode: 2,
      spawn: { x: 100, y: 50 },
      time: 12345,
      dayTime: false,
      moonPhase: 4,
      bloodMoon: true,
      hardmode: false,
      bosses: { eyeOfCthulhu: true, moonLord: true },
    })
    expect(out.length).toBe(raw.length)

    const { parsed: after, track: afterTrack } = parseTracked(out)
    expect(after.info.gameMode).toBe(2)
    expect(after.info.spawn).toEqual({ x: 100, y: 50 })
    expect(after.info.hardmode).toBe(false)
    expect(after.info.bossesDowned).toContain('eyeOfCthulhu')
    expect(after.info.bossesDowned).toContain('moonLord')
    // 段指针一个都没动
    expect(afterTrack.pointers).toEqual(track.pointers)
    // 未编辑的内容保持不变
    expect(after.info.name).toBe(parsed.info.name)
    expect(after.info.width).toBe(parsed.info.width)

    // 变化的字节必须都在被编辑字段的范围内（.wld 没加密，可以逐字节比）
    const changed = Array.from(raw.keys()).filter((i) => raw[i] !== out[i])
    const allowed = [
      track.gameMode!,
      track.gameMode! + 1,
      track.gameMode! + 2,
      track.gameMode! + 3,
      track.spawn!,
      track.spawn! + 1,
      track.spawn! + 2,
      track.spawn! + 3,
      track.spawn! + 4,
      track.spawn! + 5,
      track.spawn! + 6,
      track.spawn! + 7,
      track.hardmode!,
      track.moonPhase!,
      track.moonPhase! + 1,
      track.moonPhase! + 2,
      track.moonPhase! + 3,
      track.bloodMoon!,
      track.dayTime!,
      track.bosses.eyeOfCthulhu!,
      track.bosses.moonLord!,
    ]
    const timeRange = Array.from({ length: 8 }, (_, i) => track.time! + i)
    for (const pos of changed) {
      expect([...allowed, ...timeRange]).toContain(pos)
    }
  })

  it('B 级：改世界名 → 头部段变长、段指针整体平移、footer 名字同步、Revision+1', () => {
    const raw = demo()
    const { parsed, track } = parseTracked(raw)
    const beforeRevision = new DataView(raw.buffer, raw.byteOffset).getUint32(track.revisionAt, true)

    const out = applyWorldEdits(raw, track, { name: '全新名字' })
    const { parsed: after, track: afterTrack } = parseTracked(out)

    expect(after.info.name).toBe('全新名字')
    expect(afterTrack.pointers[0]).toBe(track.pointers[0]) // 文件头长度不变
    // 段平移量 = **头部段**的增量（与文件总长的增量不同：footer 里的名字也变长了）
    const headerDelta = afterTrack.pointers[1] - track.pointers[1]
    expect(headerDelta).toBe(encodeDotNetString('全新名字').length - track.name.size)
    for (let i = 1; i < track.pointers.length; i++) {
      expect(afterTrack.pointers[i]).toBe(track.pointers[i] + headerDelta)
    }
    // 文件总增量 = 头部增量 + footer 名字增量
    expect(out.length - raw.length).toBe(headerDelta * 2)
    // footer 跟着改（游戏加载时会逐字节比较）
    expect(footerName(out, afterTrack)).toBe('全新名字')
    expect(after.info.worldId).toBe(parsed.info.worldId)
    // Revision 自增
    expect(new DataView(out.buffer, out.byteOffset).getUint32(afterTrack.revisionAt, true)).toBe(
      (beforeRevision + 1) >>> 0,
    )
    // 中间各段（图格等）逐字节相同
    expect(Array.from(out.subarray(afterTrack.pointers[1], afterTrack.footerAt))).toEqual(
      Array.from(raw.subarray(track.pointers[1], track.footerAt)),
    )
  })

  it('真实世界文件：一次改完名字 / 种子 / 难度 / 出生点 / 时间 / 月相 / 困难 / Boss', () => {
    const raw = demo()
    const { parsed, track } = parseTracked(raw)
    const out = applyWorldEdits(raw, track, {
      name: '我的新世界名字',
      seed: 'abcdefgh',
      gameMode: 2,
      spawn: { x: 2000, y: 300 },
      time: 27000,
      dayTime: false,
      moonPhase: 5,
      hardmode: true,
      bosses: { moonLord: true, plantera: true },
    })
    const { parsed: after, track: afterTrack } = parseTracked(out)

    expect(after.info.name).toBe('我的新世界名字')
    expect(after.info.seed).toBe('abcdefgh')
    expect(after.info.gameMode).toBe(2)
    expect(after.info.spawn).toEqual({ x: 2000, y: 300 })
    expect(after.info.time).toBe(27000)
    expect(after.info.dayTime).toBe(false)
    expect(after.info.moonPhase).toBe(5)
    expect(after.info.hardmode).toBe(true)
    expect(after.info.bossesDowned).toContain('moonLord')
    expect(after.info.bossesDowned).toContain('plantera')

    // 段指针：第 0 段（文件头）不动，其余整体平移同一个量（= 头部段增量）；footer 跟着走
    const headerDelta = afterTrack.pointers[1] - track.pointers[1]
    expect(afterTrack.pointers[0]).toBe(track.pointers[0])
    for (let i = 1; i < track.pointers.length; i++) {
      expect(afterTrack.pointers[i]).toBe(track.pointers[i] + headerDelta)
    }
    expect(afterTrack.footerAt).toBe(track.footerAt + headerDelta)
    // 中间各段（图格 / 箱子 / …）逐字节不变
    expect(Array.from(out.subarray(afterTrack.pointers[1], afterTrack.footerAt))).toEqual(
      Array.from(raw.subarray(track.pointers[1], track.footerAt)),
    )
    // footer 名字同步 + 保存次数 +1
    expect(footerName(out, afterTrack)).toBe('我的新世界名字')
    expect(after.info.revision).toBe(parsed.info.revision + 1)
  })

  it('B 级：改种子不影响世界名与 footer', () => {
    const raw = demo()
    const { parsed, track } = parseTracked(raw)
    const out = applyWorldEdits(raw, track, { seed: 'new-seed-2026' })
    const { parsed: after, track: afterTrack } = parseTracked(out)
    expect(after.info.seed).toBe('new-seed-2026')
    expect(after.info.name).toBe(parsed.info.name)
    expect(footerName(out, afterTrack)).toBe(parsed.info.name)
  })

  it('同时改名字 + 定长字段也能正确重排', () => {
    const raw = demo()
    const { track } = parseTracked(raw)
    const out = applyWorldEdits(raw, track, { name: 'X', gameMode: 3, spawn: { x: 5, y: 6 } })
    const { parsed: after } = parseTracked(out)
    expect(after.info.name).toBe('X')
    expect(after.info.gameMode).toBe(3)
    expect(after.info.spawn).toEqual({ x: 5, y: 6 })
    expect(out.length).toBeLessThan(raw.length) // 名字从 13 字节缩到 4
  })

  /**
   * 老存档（release < 210）的指针表末尾是 **0** 占位（那一段该版本不存在）。
   * 这里把 demo 改造成同样的几何：去掉最后一个段、把末尾指针写成 0。
   * 回归点：`footerAt` 必须取「最后一个有效指针」；改名时 0 不能被平移成 delta（否则毁档）。
   */
  const withSentinelPointer = (): { raw: Uint8Array; footerAt: number } => {
    const raw = demo()
    const { track } = parseTracked(raw)
    const last = track.pointers.length - 1
    const footerAt = track.pointers[last]
    const cut = track.pointers[last - 1]
    const out = new Uint8Array(raw.length - (footerAt - cut))
    out.set(raw.subarray(0, cut), 0)
    out.set(raw.subarray(footerAt), cut)
    new DataView(out.buffer, out.byteOffset).setInt32(track.pointersAt + last * 4, 0, true)
    return { raw: out, footerAt: cut }
  }

  it('指针表末尾是 0（老存档几何）：footer 起点取最后一个有效指针，改名不截断', () => {
    const { raw, footerAt } = withSentinelPointer()
    const { parsed, track } = parseTracked(raw)
    const last = track.pointers.length - 1
    expect(track.pointers[last]).toBe(0)
    expect(track.footerAt).toBe(footerAt)
    expect(track.footerAt).toBeGreaterThan(track.headerEnd)
    expect(footerName(raw, track)).toBe(parsed.info.name)

    // 改名：段平移量 = 头部段增量；末尾的 0 原样保留；文件不能被截断
    const out = applyWorldEdits(raw, track, { name: '改名之后的世界' })
    const { parsed: after, track: afterTrack } = parseTracked(out)
    expect(after.info.name).toBe('改名之后的世界')
    expect(out.length).toBeGreaterThan(raw.length)
    const headerDelta = afterTrack.pointers[1] - track.pointers[1]
    for (let i = 1; i < track.pointers.length; i++) {
      if (track.pointers[i] === 0) expect(afterTrack.pointers[i]).toBe(0)
      else expect(afterTrack.pointers[i]).toBe(track.pointers[i] + headerDelta)
    }
    expect(afterTrack.footerAt).toBe(footerAt + headerDelta)
    // 中间各段逐字节相同
    expect(Array.from(out.subarray(afterTrack.pointers[1], afterTrack.footerAt))).toEqual(
      Array.from(raw.subarray(track.pointers[1], track.footerAt)),
    )
    expect(footerName(out, afterTrack)).toBe('改名之后的世界')
  })

  it('传 {} 就能记录 Boss 偏移（子表由 parseWorld 自己初始化）', () => {
    const track = {} as WorldTrack
    parseWorld(demo(), track)
    expect(typeof track.bosses.eyeOfCthulhu).toBe('number')
    expect(typeof track.bosses.moonLord).toBe('number')
  })
})
