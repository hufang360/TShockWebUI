import { describe, expect, it } from 'vitest'
import { aes128CbcDecrypt, aes128CbcEncrypt, PLR_AES_KEY } from './aes'
import { dotnetBinaryToIso, SaveFormatError } from './bytes'
import {
  decryptPlr,
  emptyPlrPlayer,
  parsePlr,
  parsePlrFile,
  plrSlots,
  plrToPlayerLook,
} from './plr'
import { buildWorld, dotnetTicks } from '@/test/worldFile'
import { parseWorld } from './worldFile'

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)))
const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')

describe('AES-128-CBC 解密', () => {
  it('NIST SP 800-38A F.2.1 测试向量', () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c')
    const iv = hex('000102030405060708090a0b0c0d0e0f')
    const ct = hex('7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2')
    expect(toHex(aes128CbcDecrypt(key, iv, ct))).toBe(
      '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51',
    )
  })

  it('NIST SP 800-38A F.2.1 加密向量（与服务端逐位一致）', () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c')
    const iv = hex('000102030405060708090a0b0c0d0e0f')
    const pt = hex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51')
    expect(toHex(aes128CbcEncrypt(key, iv, pt))).toBe(
      '7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2',
    )
  })

  it('解密 → 加密可以还原任何 `.plr`（编辑后另存的基础）', () => {
    const raw = new Uint8Array(require('node:fs').readFileSync('src/lib/save/fixtures/webui-326.plr'))
    const plain = aes128CbcDecrypt(PLR_AES_KEY, PLR_AES_KEY, raw)
    expect(toHex(aes128CbcEncrypt(PLR_AES_KEY, PLR_AES_KEY, plain))).toBe(toHex(raw))
  })

  it('拒绝非 16 字节倍数 / 错误密钥长度', () => {
    expect(() => aes128CbcDecrypt(PLR_AES_KEY, PLR_AES_KEY, new Uint8Array(17))).toThrow()
    expect(() => aes128CbcDecrypt(new Uint8Array(8), PLR_AES_KEY, new Uint8Array(16))).toThrow()
  })
})

describe('.plr 本地解析', () => {
  const fixture = new Uint8Array(
    // vitest 的 node 环境可以直接读文件（jsdom 也提供了 Buffer）。
    new Uint8Array(require('node:fs').readFileSync('src/lib/save/fixtures/webui-326.plr')),
  )

  it('解出 1.4.5.8 新角色的外观 / 属性 / 起始物品', () => {
    const look = parsePlrFile(fixture)
    expect(look.name).toBe('webui')
    expect(look.online).toBe(false)
    expect(look.health).toBe(100)
    expect(look.maxHealth).toBe(100)
    expect(look.mana).toBe(0)
    expect(look.maxMana).toBe(20)
    expect(look.hair).toBe(68)
    expect(look.skinVariant).toBe(9)
    // 颜色按 int32 小端 RGBA 编码（A 恒为 255）。
    expect(look.hairColor).toBe((215 | (90 << 8) | (55 << 16) | (255 << 24)) >>> 0)
    expect(look.skinColor).toBe((255 | (125 << 8) | (90 << 16) | (255 << 24)) >>> 0)
    // 起始物品：铜短剑 / 铜镐 / 铜斧，其余槽位为空。
    expect(look.items).toHaveLength(350)
    expect(look.items.slice(0, 3).map((i) => i.id)).toEqual([3507, 3509, 3506])
    expect(look.items.filter((i) => i.id > 0)).toHaveLength(3)
    // .plr 不存出生点。
    expect(look.spawnX).toBe(-1)
    expect(look.spawnY).toBe(-1)
  })

  it('读出 1.4.5.8 存档里的游玩时长 / 难度 / 渔夫任务 / Golf / 最后保存 / BUFF / 重生点', () => {
    const p = parsePlr(fixture)
    // 新建角色：软核、游玩时长 0、渔夫 0 次、Golf 0 分、没有 BUFF、没有重生点。
    expect(p.release).toBe(326)
    expect(p.difficulty).toBe(0)
    expect(p.playTimeTicks).toBe(0)
    expect(p.anglerQuests).toBe(0)
    expect(p.golferScore).toBe(0)
    expect(p.taxMoney).toBe(0)
    expect(p.deathsPve).toBe(0)
    expect(p.deathsPvp).toBe(0)
    expect(p.buffs).toEqual([])
    expect(p.spawns).toEqual([])
    // 最后保存时间是 .NET DateTime.ToBinary()，能还原成 ISO 时间。
    expect(dotnetBinaryToIso(p.lastSavedTicks)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const look = plrToPlayerLook(p)
    expect(look.saveVersion).toBe(326)
    expect(look.gameVersion).toBe('1.4.5.8')
    expect(look.difficulty).toBe(0)
    expect(look.playTimeTicks).toBeUndefined() // 0 → 不显示
    expect(look.golferScore).toBe(0)
    expect(look.lastSaved).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('槽位布局与 TShock 的 NetItem 一致（背包 0–57 / 装备 59–78 / 猪猪 99–138…）', () => {
    const p = parsePlrFile(fixture)
    const bySlot = new Map(p.items.map((i) => [i.slot, i]))
    expect(bySlot.get(0)?.id).toBe(3507)
    // 58 号槽是「垃圾桶」在 TShock 侧的位置，.plr 里没有 → 空。
    expect(bySlot.get(58)?.id).toBe(0)
    expect(bySlot.get(59)?.id).toBe(0)
    expect(bySlot.get(349)?.id).toBe(0)
  })

  it('非法输入给出可读原因', () => {
    expect(() => decryptPlr(new Uint8Array([1, 2, 3]))).toThrow(SaveFormatError)
    // 长度合法但内容不是存档：解密后版本号离谱。
    const junk = new Uint8Array(64)
    expect(() => parsePlrFile(junk)).toThrow(/不支持的角色存档版本/)
    // 篡改一个字节：解密结果错乱 → 版本号或文件头必然对不上。
    const broken = fixture.slice()
    broken[0] ^= 0xff
    expect(() => parsePlrFile(broken)).toThrow(SaveFormatError)
  })
})

describe('plr → PlayerLook 映射', () => {
  it('空存档也能安全映射（不会抛）', () => {
    const look = plrToPlayerLook({ ...emptyPlrPlayer(), release: 326, name: 'x' })
    expect(look.items).toHaveLength(350)
    expect(look.hairColor).toBe((255 << 24) >>> 0)
    expect(plrSlots).toBeTypeOf('function')
  })
})

describe('.NET DateTime.ToBinary', () => {
  it('按 UTC 还原墙上时间；0 值返回 null', () => {
    expect(dotnetBinaryToIso(dotnetTicks('2024-05-06T07:08:09Z'))).toBe('2024-05-06T07:08:09.000Z')
    // 本地 Kind（DateTime.Now 写的）：不带 Z，ticks 原样当墙上时间（不受运行环境时区影响）
    expect(dotnetBinaryToIso(dotnetTicks('2024-05-06T07:08:09Z', 'local'))).toBe('2024-05-06T07:08:09.000')
    expect(dotnetBinaryToIso(0n)).toBeNull()
  })
})

describe('.wld 头部解析', () => {
  const spec = () =>
    buildWorld({ width: 200, height: 100, tiles: () => ({ typ: -1 }) })

  it('逐字段读出头信息', () => {
    const data = buildWorld({
      width: 200,
      height: 100,
      name: '合成世界',
      seed: 'seed-42',
      groundLevel: 30.5,
      rockLevel: 60.25,
      tiles: () => ({ typ: -1 }),
    })
    const { info, tilesAt } = parseWorld(data)
    expect(info.name).toBe('合成世界')
    expect(info.seed).toBe('seed-42')
    expect(info.worldGenVersion).toBe(1400159338497)
    expect(info.guid).toBe('04030201-0605-0807-090a-0b0c0d0e0f10')
    expect(info.worldId).toBe(4242)
    expect([info.width, info.height]).toEqual([200, 100])
    expect(info.gameMode).toBe(1)
    expect(info.specialSeeds).toEqual(['drunk'])
    expect(info.evil).toBe('crimson')
    expect(info.hardmode).toBe(true)
    expect(info.favorite).toBe(true)
    expect(info.revision).toBe(7)
    // 创建时间是「本地墙上时间」→ **不带时区**，原样显示（换算就会差一个时区）
    expect(info.createdAt).toBe('2024-05-06T07:08:09.000')
    // 最后游玩是 UTC → 带 Z，界面换算成本地时区
    expect(info.lastPlayed).toBe('2025-01-02T03:04:05.000Z')
    expect(info.spawn).toEqual({ x: 120, y: 10 })
    expect(info.dungeon).toEqual({ x: 160, y: 70 })
    expect(info.groundLevel).toBe(30.5)
    expect(info.rockLevel).toBe(60.25)
    expect(info.bossesDowned).toEqual([
      'eyeOfCthulhu',
      'evilBoss',
      'destroyer',
      'anyMech',
      'dukeFishron',
      'moonLord',
    ])
    // 返回的图格段起点必须落在图格数据上（能继续解码）。
    expect(tilesAt).toBeGreaterThan(0)
    expect(tilesAt).toBeLessThan(data.length)
  })

  it('拒绝非法 / 过旧 / 过新的文件', () => {
    expect(() => parseWorld(new Uint8Array(0))).toThrow(SaveFormatError)
    expect(() => parseWorld(new TextEncoder().encode('definitely not a world'))).toThrow(
      /文件太小|文件头不匹配/,
    )
    const withRelease = (release: number) => {
      const bytes = spec()
      new DataView(bytes.buffer, bytes.byteOffset).setInt32(0, release, true)
      return bytes
    }
    // release 87（1.2.4 之前的 V1 格式）→ 明确提示版本过旧。
    expect(() => parseWorld(withRelease(87))).toThrow(/版本过旧/)
    // release 999（未来版本）→ 高于支持版本。
    expect(() => parseWorld(withRelease(999))).toThrow(/高于本工具支持的/)
  })
})

describe('.plr → PlayerLook 的本地专用字段', () => {
  it('研究条数 / 多世界重生点会映射到 PlayerLook', () => {
    const fake = {
      ...emptyPlrPlayer(),
      name: '搬运工',
      release: 326,
      researchedCount: 705,
      spawns: [
        { x: 100, y: 200, worldId: 4242, world: '主世界' },
        { x: -5, y: 6, worldId: 7, world: '' },
      ],
    }
    const look = plrToPlayerLook(fake)
    expect(look.researchedCount).toBe(705)
    expect(look.spawns).toEqual([
      { x: 100, y: 200, worldId: 4242, world: '主世界' },
      { x: -5, y: 6, worldId: 7, world: '' },
    ])
  })

  it('没有研究进度（老存档）时不给值，界面据此隐藏该行', () => {
    const look = plrToPlayerLook({ ...emptyPlrPlayer(), release: 210 })
    expect(look.researchedCount).toBeUndefined()
    expect(look.spawns).toEqual([])
  })

  it('真实 1.4.0.2 存档（Joy.plr）：研究 705 种、没有床重生点', () => {
    const p = parsePlr(new Uint8Array(require('node:fs').readFileSync('public/demo/Joy.plr')))
    expect(p.researchedCount).toBe(705)
    expect(p.spawns).toEqual([])
  })
})

describe('.plr 三套配装（≥262）', () => {
  it('真实 1.4.5.8 夹具：3 套配装、下标在 0–2、每套 20 装备 + 10 染料 + 10 隐藏位', () => {
    const p = parsePlr(new Uint8Array(require('node:fs').readFileSync('src/lib/save/fixtures/webui-326.plr')))
    expect(p.loadouts).toHaveLength(3)
    expect(p.currentLoadoutIndex).toBeGreaterThanOrEqual(0)
    expect(p.currentLoadoutIndex).toBeLessThanOrEqual(2)
    for (const loadout of p.loadouts) {
      expect(loadout.armor).toHaveLength(20)
      expect(loadout.dye).toHaveLength(10)
      expect(loadout.hide).toHaveLength(10)
      // id 要么是 0（空），要么是真实物品（夹具是 1.4.5.8 的角色）
      for (const item of [...loadout.armor, ...loadout.dye]) {
        expect(item.id === 0 || (item.id > 0 && item.id < 6200)).toBe(true)
      }
    }
  })

  it('配装槽位落到 TShock 的 260–349（装备 10 + 时装 10 + 染料 10）', () => {
    const fake = {
      ...emptyPlrPlayer(),
      loadouts: [
        {
          armor: Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, stack: 1, prefix: 0, favorited: false })),
          dye: Array.from({ length: 10 }, (_, i) => ({ id: 200 + i, stack: 1, prefix: 0, favorited: false })),
          hide: Array.from({ length: 10 }, () => false),
        },
      ],
    }
    const slots = plrSlots(fake)
    // 前 10 件装备 → 260..269；后 10 件（时装）→ 270..279；10 件染料 → 280..289
    expect(slots[260].id).toBe(100)
    expect(slots[269].id).toBe(109)
    expect(slots[270].id).toBe(110)
    expect(slots[279].id).toBe(119)
    expect(slots[280].id).toBe(200)
    expect(slots[289].id).toBe(209)
    // 第二套从 290 开始，第三套从 320 开始（没给就全空）
    expect(slots[290].id).toBe(0)
    expect(slots[320].id).toBe(0)
  })

  it('老存档（<262）没有配装段：空数组、下标 0，其它字段照常', () => {
    const p = parsePlr(new Uint8Array(require('node:fs').readFileSync('public/demo/Joy.plr')))
    expect(p.release).toBe(226) // 1.4.0.2，配装是 1.4.3（262）才有的
    expect(p.loadouts).toEqual([])
    expect(p.currentLoadoutIndex).toBe(0)
    expect(p.researchedCount).toBe(705) // 后面的研究进度段仍然解析成功
  })
})
