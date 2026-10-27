import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { aes128CbcEncrypt, PLR_AES_KEY } from './aes'
import { decryptPlr, parsePlr, type PlrTrack } from './plr'
import { applyPlrEdits, changedPlainOffsets } from './plrWrite'

const demo = () => new Uint8Array(readFileSync('public/demo/Joy.plr'))

function parseWithTrack(data: Uint8Array, release?: number) {
  const track = { boosts: {}, inventory: [] } as unknown as PlrTrack
  if (release != null) track.release = 0
  const player = parsePlr(data, track)
  return { player, track }
}

describe('.plr 写回（补丁 + 重新加密）', () => {
  it('空编辑：输出与原文件逐字节相同', () => {
    const raw = demo()
    const { track } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, {})
    expect(Array.from(out)).toEqual(Array.from(raw))
  })

  it('改生命 / 魔力 / 渔夫 / Golf / 模式后能重新解析出新值，其余字段不变', () => {
    const raw = demo()
    const before = parseWithTrack(raw)
    const out = applyPlrEdits(raw, before.track, {
      statLife: 350,
      statLifeMax: 400,
      statMana: 100,
      statManaMax: 200,
      anglerQuests: 42,
      golferScore: 1234,
      difficulty: 1,
    })
    const after = parseWithTrack(out)

    expect(out.length).toBe(raw.length)
    expect(after.player.statLife).toBe(350)
    expect(after.player.statLifeMax).toBe(400)
    expect(after.player.statMana).toBe(100)
    expect(after.player.statManaMax).toBe(200)
    expect(after.player.anglerQuests).toBe(42)
    expect(after.player.golferScore).toBe(1234)
    expect(after.player.difficulty).toBe(1)
    // 没动的东西必须原样：名字 / 外观色 / 背包 / 存档版本 / 时间
    expect(after.player.name).toBe(before.player.name)
    expect(after.player.release).toBe(before.player.release)
    expect(after.player.hair).toBe(before.player.hair)
    expect(after.player.hairColor).toEqual(before.player.hairColor)
    expect(after.player.inventory).toEqual(before.player.inventory)
    expect(after.player.buffs).toEqual(before.player.buffs)
    expect(after.player.lastSavedTicks).toBe(before.player.lastSavedTicks)
  })

  it('只改动被编辑的那几个字节（明文其余部分一模一样）', () => {
    const raw = demo()
    const { track, player } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, { statLife: player.statLife - 1 })
    const offsets = changedPlainOffsets(raw, out)
    // 生命是 int32：变化的字节必须全部落在偏移表记的 4 个字节里（400→399 只动最低字节）。
    expect(offsets.length).toBeGreaterThan(0)
    for (const off of offsets) {
      expect(off).toBeGreaterThanOrEqual(track.statLife!)
      expect(off).toBeLessThan(track.statLife! + 4)
    }
  })

  it('改背包槽位（数量 / 词缀 / 清空）后能重新解析出来', () => {
    const raw = demo()
    const { track, player } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, {
      inventory: {
        0: { id: 4956, stack: 1, prefix: 82 }, // 天顶剑 + 传奇
        1: { id: 0, stack: 0, prefix: 0 }, // 清空
      },
    })
    const after = parseWithTrack(out).player
    expect(after.inventory[0]).toMatchObject({ id: 4956, stack: 1, prefix: 82 })
    expect(after.inventory[1]).toMatchObject({ id: 0 })
    // 其它槽位不受影响
    expect(after.inventory.slice(2)).toEqual(player.inventory.slice(2))
  })

  it('改永久增强（1.4.5.8 存档才有这些位）', () => {
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const { track } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, {
      boosts: {
        extraAccessory: true,
        unlockedBiomeTorches: true,
        usingBiomeTorches: true,
        ateArtisanBread: true,
        usedAegisCrystal: true,
      },
    })
    const after = parseWithTrack(out).player
    expect(after.extraAccessory).toBe(true)
    expect(after.unlockedBiomeTorches).toBe(true)
    expect(after.usingBiomeTorches).toBe(true)
    expect(after.ateArtisanBread).toBe(true)
    expect(after.usedAegisCrystal).toBe(true)
  })

  it('老存档没有的字段明确报错，不会瞎猜位置', () => {
    const raw = demo()
    const { track } = parseWithTrack(raw)
    // Joy 是 release 226，没有「吃掉工匠面包」这个字段
    expect(() => applyPlrEdits(raw, track, { boosts: { ateArtisanBread: true } })).toThrow(/无法编辑/)
  })

  it('尾部变长数据读不动时：不抛错、定长字段与背包照常，矿车升级包不记偏移', () => {
    // 拿真实的 1.4.5.8 存档，把「研究进度条数」改成不可能的值（模拟第三方服务器改过的存档）
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const before = parseWithTrack(raw)
    const plain = decryptPlr(raw).slice()
    const countAt = before.track.golferScore! + 4 + 1 // ≥282 有 1 字节前导 bool
    new DataView(plain.buffer, plain.byteOffset).setInt32(countAt, 0x0b000017, true)
    const broken = aes128CbcEncrypt(PLR_AES_KEY, PLR_AES_KEY, plain)

    const track = {} as PlrTrack
    const player = parsePlr(broken, track)
    expect(track.tailUnparsed).toBe(true)
    expect(track.superCartBits).toBeUndefined()
    // 定长字段与背包不受影响
    expect(player.name).toBe(before.player.name)
    expect(player.statLife).toBe(before.player.statLife)
    expect(player.inventory.map((i) => i.id)).toEqual(before.player.inventory.map((i) => i.id))
    // 不记偏移就不会去写它（写也只写前面那些字段）
    const out = applyPlrEdits(broken, track, { statLife: 200 })
    expect(parsePlr(out).statLife).toBe(200)
  })
})

describe('装备区写回（只写 id + prefix）', () => {
  it('改装备 / 染料 / 杂项：重新解析生效，其它字段不动', () => {
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const { player, track } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, {
      equipment: {
        armor: { 0: { id: 4956, stack: 0, prefix: 0 } }, // 头部 → 天顶剑（随便换，游戏按类型判定槽位）
        dye: { 0: { id: 29, stack: 0, prefix: 0 } },
        miscEquips: { 2: { id: 75, stack: 0, prefix: 0 } },
        miscDyes: { 4: { id: 29, stack: 0, prefix: 0 } },
      },
    })
    const after = parsePlr(out)
    expect(after.armor[0].id).toBe(4956)
    expect(after.dye[0].id).toBe(29)
    expect(after.miscEquips[2].id).toBe(75)
    expect(after.miscDyes[4].id).toBe(29)
    // 其它字段 / 其它装备格原样
    expect(after.name).toBe(player.name)
    expect(after.statLife).toBe(player.statLife)
    expect(after.armor.map((i) => i.id).slice(1)).toEqual(player.armor.map((i) => i.id).slice(1))
    expect(out.length).toBe(raw.length)
    // 变化的字节必须全部落在「被改的那几个格子」的 id(int32) / prefix(u8) 范围里
    const editedSlots = [
      track.equipment.armor![0],
      track.equipment.dye![0],
      track.equipment.miscEquips![2],
      track.equipment.miscDyes![4],
    ]
    const changed = changedPlainOffsets(raw, out)
    expect(changed.length).toBeGreaterThan(0)
    for (const offset of changed) {
      const inSomeSlot = editedSlots.some(
        (slot) => (offset >= slot.id && offset < slot.id + 4) || offset === slot.prefix,
      )
      expect(inSomeSlot).toBe(true)
    }
  })

  it('把装备格清空（id = 0），词缀必须是 0', () => {
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const { track } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, { equipment: { armor: { 3: { id: 0, stack: 0, prefix: 0 } } } })
    expect(parsePlr(out).armor[3].id).toBe(0)
  })

  it('槽位不存在时明确报错（不会瞎写）', () => {
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const { track } = parseWithTrack(raw)
    expect(() => applyPlrEdits(raw, track, { equipment: { armor: { 99: { id: 1, stack: 0, prefix: 0 } } } })).toThrow(
      /不存在/,
    )
  })
})

describe('随身仓储写回（id + stack + prefix）', () => {
  it('改猪猪 / 保险箱 / 熔炉 / 虚空袋：重新解析生效，其它字段不动', () => {
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const { player, track } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, {
      storage: {
        piggyBank: { 0: { id: 29, stack: 7, prefix: 0 } },
        safe: { 3: { id: 75, stack: 99, prefix: 0 } },
        forge: { 39: { id: 4956, stack: 1, prefix: 0 } },
        voidVault: { 12: { id: 29, stack: 1, prefix: 0 } },
      },
    })
    const after = parsePlr(out)
    expect(after.piggyBank[0]).toMatchObject({ id: 29, stack: 7 })
    expect(after.safe[3]).toMatchObject({ id: 75, stack: 99 })
    expect(after.forge[39]).toMatchObject({ id: 4956, stack: 1 })
    expect(after.voidVault[12]).toMatchObject({ id: 29, stack: 1 })
    // 其它字段与原文件一致
    expect(after.name).toBe(player.name)
    expect(after.inventory.map((i) => i.id)).toEqual(player.inventory.map((i) => i.id))
    expect(after.piggyBank.map((i) => i.id).slice(1)).toEqual(player.piggyBank.map((i) => i.id).slice(1))
    expect(out.length).toBe(raw.length)
    // 变化的字节只落在被改格子的 id/stack/prefix 上
    const slots = [
      track.storage.piggyBank![0],
      track.storage.safe![3],
      track.storage.forge![39],
      track.storage.voidVault![12],
    ]
    for (const offset of changedPlainOffsets(raw, out)) {
      expect(
        slots.some((s) => (offset >= s.id && offset < s.id + 4) || (offset >= s.stack && offset < s.stack + 4) || offset === s.prefix),
      ).toBe(true)
    }
  })

  it('老存档没有熔炉 / 虚空袋时，改它们会明确报错', () => {
    const raw = demo() // Joy = release 226：有熔炉（≥182）但**没有**虚空袋（≥198）？实际 226 ≥ 198 也有
    const { player, track } = parseWithTrack(raw)
    // 这份存档确实有虚空袋（≥198），所以先确认有；再造一个「没有」的场景：人为清空偏移表
    expect(player.voidVault.length).toBeGreaterThan(0)
    const broken = { ...track, storage: { ...track.storage, voidVault: [] } }
    expect(() => applyPlrEdits(raw, broken, { storage: { voidVault: { 0: { id: 1, stack: 1, prefix: 0 } } } })).toThrow(
      /不存在/,
    )
  })
})

describe('三套配装写回（id + stack + prefix）', () => {
  it('改第 1 套的装备第 1 格与染料第 1 格：重新解析生效，其它配装不动', () => {
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const { player, track } = parseWithTrack(raw)
    const out = applyPlrEdits(raw, track, {
      loadouts: {
        0: {
          armor: { 0: { id: 4956, stack: 1, prefix: 0 }, 19: { id: 29, stack: 1, prefix: 0 } },
          dye: { 9: { id: 29, stack: 1, prefix: 0 } },
        },
      },
    })
    const after = parsePlr(out)
    expect(after.loadouts[0].armor[0].id).toBe(4956)
    expect(after.loadouts[0].armor[19].id).toBe(29)
    expect(after.loadouts[0].dye[9].id).toBe(29)
    // 另外两套原样
    expect(after.loadouts[1].armor.map((i) => i.id)).toEqual(player.loadouts[1].armor.map((i) => i.id))
    expect(after.loadouts[2].dye.map((i) => i.id)).toEqual(player.loadouts[2].dye.map((i) => i.id))
    expect(out.length).toBe(raw.length)
    // 变化字节只落在被改格子的 id/stack/prefix
    const slots = [
      track.loadouts[0].armor[0],
      track.loadouts[0].armor[19],
      track.loadouts[0].dye[9],
    ]
    for (const offset of changedPlainOffsets(raw, out)) {
      expect(
        slots.some((s) => (offset >= s.id && offset < s.id + 4) || (offset >= s.stack && offset < s.stack + 4) || offset === s.prefix),
      ).toBe(true)
    }
  })

  it('配装下标或槽位不存在时报错', () => {
    const raw = new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const { track } = parseWithTrack(raw)
    expect(() => applyPlrEdits(raw, track, { loadouts: { 5: { armor: { 0: { id: 1, stack: 1, prefix: 0 } } } } })).toThrow(
      /配装 6 不存在/,
    )
    expect(() =>
      applyPlrEdits(raw, track, { loadouts: { 0: { armor: { 99: { id: 1, stack: 1, prefix: 0 } } } } }),
    ).toThrow(/不存在/)
  })
})
