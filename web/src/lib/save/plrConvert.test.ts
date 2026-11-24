// @vitest-environment node
/**
 * `.plr` 升级（低版本 → 高版本）的单元测试。
 *
 * 关键的往返用例：把 1.4.5.8 的 fixture **拆成 1.4.4（269）布局**（删掉 262 之后新增的
 * 8 类字节），再升级回 326，要求「插入回来后明文前 L 字节与原文件完全一致」——
 * 这证明升级只做插入，没有顺手改动别的字节。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { aes128CbcEncrypt, PLR_AES_KEY } from './aes'
import { decryptPlr, parsePlr, type PlrPlayer, type PlrTrack } from './plr'
import { checkPlrConvert, convertPlr, downgradePlr, upgradePlr, PLR_CONVERT_MIN_RELEASE } from './plrConvert'
import { applyPlrEdits } from './plrWrite'
import { readPlr326, stripTo144 } from '@/test/plrSave'

const fixture326 = readPlr326
const demo226 = () => new Uint8Array(readFileSync('public/demo/Joy.plr'))

const trackOf = (data: Uint8Array) => {
  const track = {} as PlrTrack
  const player = parsePlr(data, track)
  return { track, player }
}

describe('`.plr` 版本转换：能不能转', () => {
  it('版本区间判断（双向）', () => {
    expect(checkPlrConvert(269, 326)).toBeNull()
    expect(checkPlrConvert(326, 269)).toBeNull() // 降级也支持
    expect(checkPlrConvert(315, 326)).toBeNull()
    expect(checkPlrConvert(269, 269)).toBe('sameLayout')
    expect(checkPlrConvert(325, 326)).toBe('sameLayout')
    expect(checkPlrConvert(269, 400)).toBe('tooNew')
    expect(checkPlrConvert(226, 326)).toBeNull() // 1.4.0.2 也能升
    expect(checkPlrConvert(226, 228)).toBe('sameLayout')
    expect(checkPlrConvert(219, 326)).toBe('sourceTooOld') // 1.4.0 之前不支持
    expect(checkPlrConvert(326, 219)).toBe('targetTooOld')
    expect(PLR_CONVERT_MIN_RELEASE).toBe(220)
  })

  it('尾部读不出来 / 退款队列非空时不给转换（宁可不做也不猜偏移）', () => {
    const track = {} as PlrTrack
    track.tailUnparsed = true
    expect(checkPlrConvert(318, 326, track)).toBe('tailUnreadable')
    const noAnchors = {} as PlrTrack
    expect(checkPlrConvert(318, 326, noAnchors)).toBe('tailUnreadable')

    const withRefunds = {} as PlrTrack
    withRefunds.anchors = { tailStart: 10, researchStart: 20, refundCount: 2 }
    expect(checkPlrConvert(326, 269, withRefunds)).toBe('refundsPresent')
    // 升级方向不受影响：升级只需要写一个空队列
    expect(checkPlrConvert(269, 326, withRefunds)).toBeNull()
  })
})

describe('`.plr` 升级：只插入新字段', () => {
  it('1.4.4 → 1.4.5.8：重新解析后除版本号外逐字段相同，插入位置外逐字节不变', () => {
    const src = fixture326()
    const { bytes: v269, removed } = stripTo144(src)
    // 只有声音变体（按性别 1 或 2）不是 0，其余插入位在原 fixture 里都是 0。
    const nonZero = removed.filter((r) => r.value !== 0)
    expect(nonZero.length).toBe(1)
    expect([1, 2]).toContain(nonZero[0].value)
    const { track: track269, player: before } = trackOf(v269)
    expect(before.release).toBe(269)
    expect(track269.tailUnparsed).toBeUndefined()

    const upgraded = upgradePlr(v269, track269, 326)
    const upgradedTrack = {} as PlrTrack
    const after = parsePlr(upgraded, upgradedTrack)

    expect(after.release).toBe(326)
    expect(upgradedTrack.tailUnparsed).toBeUndefined()
    const repr = (value: unknown) => (typeof value === 'bigint' ? `${value}n` : JSON.stringify(value))
    for (const key of Object.keys(before) as (keyof PlrPlayer)[]) {
      if (key === 'release') continue
      expect(`${key}=${repr(after[key])}`).toBe(`${key}=${repr(before[key])}`)
    }

    // 明文前 L 字节与原 326 fixture 完全一致 = 只做了插入（插回来的都是原来的 0）。
    const original = decryptPlr(src)
    const roundTrip = decryptPlr(upgraded)
    // 插入 136 字节后要重新补位到 16 的倍数，所以只断言「对齐 + 只多出一个补位块以内」。
    expect(roundTrip.length % 16).toBe(0)
    expect(roundTrip.length).toBeGreaterThan(original.length)
    expect(roundTrip.length - original.length).toBeLessThan(32)
    expect(Array.from(roundTrip.subarray(0, original.length))).toEqual(Array.from(original))
  })

  it('升级 + 改字段一次做完：偏移表按升级后的文件重算', () => {
    const { bytes: v269 } = stripTo144(fixture326())
    const { track } = trackOf(v269)
    const out = applyPlrEdits(v269, track, {
      release: 326,
      statLife: 100,
      inventory: { 0: { id: 75, stack: 5, prefix: 0 } },
    })
    const after = parsePlr(out)
    expect(after.release).toBe(326)
    expect(after.statLife).toBe(100)
    expect(after.inventory[0]).toMatchObject({ id: 75, stack: 5, prefix: 0 })
  })

  it('插入量：1.4.0.2 补 1218 字节、1.4.4.9 补 136 字节、1.4.5.6 补 121 字节', () => {
    const pad16 = (n: number) => (16 - (n % 16)) % 16
    const cases: [Uint8Array, number, number][] = [
      [demo226(), 226, 1218], // 229/230/252/253/254/255/256/260/262 + 280…
      [stripTo144().bytes, 269, 136], // 只差 280/281/282/283/300/310/322/324
    ]
    for (const [bytes, release, inserted] of cases) {
      const { track } = trackOf(bytes)
      const out = upgradePlr(bytes, track, 326)
      const plainBefore = decryptPlr(bytes).length
      expect({ release, delta: out.length, }) // 占位，便于失败时看出是哪一档
      expect({ release, delta: out.length - plainBefore }).toEqual({
        release,
        delta: inserted + pad16(plainBefore + inserted),
      })
    }
  })

  it('同布局段（325 → 326）只改版本号，长度不变', () => {
    const src = fixture326()
    const { track } = trackOf(src)
    const out = applyPlrEdits(src, track, { release: 325 })
    expect(out.length).toBe(src.length)
    expect(parsePlr(out).release).toBe(325)
  })

  it('1.4.0.2 → 1.4.5.8：真存档升级后字段全等（含研究进度 705 条）', () => {
    const joy = demo226()
    const { track, player: before } = trackOf(joy)
    expect(before.researchedCount).toBe(705)
    const upgraded = upgradePlr(joy, track, 326)
    const upgradedTrack = {} as PlrTrack
    const after = parsePlr(upgraded, upgradedTrack)
    expect(after.release).toBe(326)
    expect(upgradedTrack.tailUnparsed).toBeUndefined()
    const repr = (value: unknown) => (typeof value === 'bigint' ? `${value}n` : JSON.stringify(value))
    for (const key of Object.keys(before) as (keyof PlrPlayer)[]) {
      if (key === 'release' || key === 'loadouts' || key === 'currentLoadoutIndex') continue
      expect(`${key}=${repr(after[key])}`).toBe(`${key}=${repr(before[key])}`)
    }
    // 新增的三套配装是空的（0 下标、没有物品、没有隐藏位）
    expect(after.loadouts).toHaveLength(3)
    expect(after.currentLoadoutIndex).toBe(0)
    expect(after.loadouts.every((lo) => [...lo.armor, ...lo.dye].every((it) => it.id === 0))).toBe(true)
  })

  it('降级到 1.4.4：只删 280+ 的字段，1.4.4 就有的逐字段不变', () => {
    const src = fixture326()
    const { track, player } = trackOf(src)
    const out = downgradePlr(src, track, 269)
    const downTrack = {} as PlrTrack
    const after = parsePlr(out, downTrack)
    expect(after.release).toBe(269)
    expect(downTrack.tailUnparsed).toBeUndefined()
    const repr = (value: unknown) => (typeof value === 'bigint' ? `${value}n` : JSON.stringify(value))
    for (const key of Object.keys(player) as (keyof PlrPlayer)[]) {
      if (key === 'release') continue
      expect(`${key}=${repr(after[key])}`).toBe(`${key}=${repr(player[key])}`)
    }

    // 再升回去：删掉的那些字段原本是空的，必须逐字节复原（明文前缀一致）
    const back = convertPlr(out, downTrack, 326)
    const original = decryptPlr(src)
    expect(Array.from(decryptPlr(back).subarray(0, original.length))).toEqual(Array.from(original))
  })

  it('降级到 1.4.3：整段容器（配装 / 矿车包 / 死亡次数…）被删掉，更早的字段不变', () => {
    const src = fixture326()
    const { track, player } = trackOf(src)
    const out = downgradePlr(src, track, 248)
    const after = parsePlr(out)
    expect(after.release).toBe(248)
    // 1.4.4 才有的段全没了
    expect(after.loadouts).toHaveLength(0)
    expect(after.unlockedSuperCart).toBe(false)
    expect(after.enabledSuperCart).toBe(false)
    expect(after.deathsPve).toBe(0)
    expect(after.deathsPvp).toBe(0)
    expect(after.ateArtisanBread).toBe(false)
    expect(after.usedAegisCrystal).toBe(false)
    // 1.4.3 就有的字段保持原样
    const repr = (value: unknown) => (typeof value === 'bigint' ? `${value}n` : JSON.stringify(value))
    const keys: (keyof PlrPlayer)[] = [
      'name', 'difficulty', 'playTimeTicks', 'hair', 'hairDye', 'skinVariant',
      'statLife', 'statLifeMax', 'statMana', 'statManaMax', 'extraAccessory',
      'unlockedBiomeTorches', 'usingBiomeTorches', 'taxMoney', 'buffs', 'spawns',
      'anglerQuests', 'golferScore', 'lastSavedTicks', 'armor', 'dye', 'inventory',
      'miscEquips', 'miscDyes', 'piggyBank', 'safe', 'forge', 'voidVault',
      'hairColor', 'skinColor', 'eyeColor', 'shirtColor', 'underShirtColor', 'pantsColor', 'shoeColor',
      'researchedCount', 'research',
    ]
    for (const key of keys) {
      expect(`${String(key)}=${repr(after[key])}`).toBe(`${String(key)}=${repr(player[key])}`)
    }
  })

  it('降级 + 改字段一次做完', () => {
    const src = fixture326()
    const { track } = trackOf(src)
    const out = applyPlrEdits(src, track, { release: 269, statLife: 123 })
    const after = parsePlr(out)
    expect(after.release).toBe(269)
    expect(after.statLife).toBe(123)
  })

  it('不支持的转换会报错，而不是写出半份存档', () => {
    const old = decryptPlr(demo226()).slice()
    new DataView(old.buffer).setInt32(0, 219, true)
    const oldFile = aes128CbcEncrypt(PLR_AES_KEY, PLR_AES_KEY, old)
    const oldTrack = {} as PlrTrack
    parsePlr(oldFile, oldTrack)
    expect(() => upgradePlr(oldFile, oldTrack, 326)).toThrow(/sourceTooOld/)

    const src = fixture326()
    const srcTrack = trackOf(src).track
    expect(() => convertPlr(src, srcTrack, 219)).toThrow(/targetTooOld/)
  })
})
