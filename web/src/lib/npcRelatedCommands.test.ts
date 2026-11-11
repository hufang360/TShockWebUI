// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NPC_DUNGEON_IDS,
  NPC_STATE_TOGGLE_IDS,
  NPC_SUMMON_ITEM,
  NPC_TOWN_IDS,
  NPC_TP_EXTRA_IDS,
  bossShortAlias,
  npcRelatedCommands,
  renameNpcCommand,
  toggleNpcCommand,
} from './npcRelatedCommands'

/** 只要指令原文（断言用）。 */
const texts = (npc: Parameters<typeof npcRelatedCommands>[0]) =>
  npcRelatedCommands(npc).map((c) => c.command)

describe('npcRelatedCommands', () => {
  it('Boss：召唤（完整写法 + 简写）→ 召唤 NPC（非城镇 NPC 不给传送 / 改名）', () => {
    const eye = {
      id: 4,
      key: 'EyeofCthulhu',
      name: '克苏鲁之眼',
      en: 'Eye of Cthulhu',
      sb: 'eye of cthulhu',
      sbAliases: ['eoc', 'eye', 'eye of cthulhu'],
      sbAll: true,
    }
    expect(texts(eye)).toEqual(['/spawnboss "eye of cthulhu"', '/sb eoc', '/sb all', '/sm 4'])
    // `/sb all` 带说明（悬停显示「召唤所有Boss」）。
    expect(npcRelatedCommands(eye)[2].note?.key).toBe('commandLine.note.spawnAll')
  })

  it('普通怪：只有召唤 NPC（`/tpnpc` / `/renameNPC` 只给城镇 NPC）', () => {
    const slime = { id: 1, key: 'BlueSlime', name: '蓝史莱姆', en: 'Blue Slime' }
    expect(texts(slime)).toEqual(['/sm 1'])
  })

  it('/spawnmob 写别名 /sm（与 Boss 的 /sb 同一口径）', () => {
    expect(texts({ id: 20, key: 'Dryad', name: '树妖', en: 'Dryad' })).toEqual([
      '/sm 20',
      '/tpnpc Dryad',
      '/renameNPC 20 <newname>',
    ])
  })

  it('城镇 NPC 多一条 /tpnpc 与 /renameNPC（改名用 ID：名字有重名，见下一条）', () => {
    expect(texts({ id: 22, key: 'Guide', name: '向导', en: 'Guide' })).toEqual([
      '/sm 22',
      '/tpnpc Guide',
      '/renameNPC 22 <newname>',
    ])
  })

  it('Boss 召唤物：登录后多一条 /give（悬停显示物品名）', () => {
    const kingSlime = { id: 50, key: 'KingSlime', name: '史莱姆王', en: 'King Slime', sb: 'king slime' }
    const commands = npcRelatedCommands(kingSlime, {
      username: 'Alice',
      itemName: (id) => (id === 560 ? '史莱姆王冠' : undefined),
    })
    const give = commands.find((c) => c.command.startsWith('/give '))
    expect(give?.command).toBe('/give 560 Alice')
    expect(give?.note).toEqual({ key: 'commandLine.note.summonItem', vars: { name: '史莱姆王冠' } })
    // 未登录（没有玩家名）就不给这一行。
    expect(texts(kingSlime).some((c) => c.startsWith('/give '))).toBe(false)
  })

  it('地牢 NPC：多 /setdungeon 与 /wm dungeon（带说明）', () => {
    for (const id of [37, 54, 68, 379, 437, 438, 439]) {
      expect(NPC_DUNGEON_IDS.has(id)).toBe(true)
      const commands = npcRelatedCommands({ id, key: 'X', name: 'X', en: 'X' })
      const dungeon = commands.filter((c) => c.command === '/setdungeon' || c.command === '/wm dungeon')
      expect(dungeon.map((c) => c.note?.key)).toEqual([
        'commandLine.note.setDungeon',
        'commandLine.note.viewDungeon',
      ])
    }
    expect(texts({ id: 4, key: 'X', name: 'X', en: 'X' })).not.toContain('/setdungeon')
  })

  it('/tpnpc 额外给 379 / 438（非城镇也有固定名字）', () => {
    for (const id of [379, 438]) {
      expect(NPC_TP_EXTRA_IDS.has(id)).toBe(true)
      expect(texts({ id, key: 'X', name: 'X', en: 'X' })).toContain('/tpnpc X')
    }
  })

  it('召唤物映射：只挂有单一对应 NPC 的 Boss', () => {
    expect(NPC_SUMMON_ITEM.get(50)).toBe(560)
    expect(NPC_SUMMON_ITEM.get(4)).toBe(43)
    expect(NPC_SUMMON_ITEM.get(113)).toBe(267)
    expect(NPC_SUMMON_ITEM.get(134)).toBe(556)
    expect(NPC_SUMMON_ITEM.size).toBeGreaterThanOrEqual(14)
  })

  it('可解救 / 可购买的 NPC 多一条 /npc（用 ID，不认名称的指令才用英文名）', () => {
    const ids = [
      369, 376, // 渔夫 / 沉睡渔夫
      107, 105, // 哥布林工匠 / 受缚哥布林
      123, 124, // 机械师 / 受缚机械师
      353, 354, // 发型师 / 被网住的发型师
      550, 579, // 酒馆老板 / 昏迷男子
      588, 589, // 高尔夫球手
      106, 108, // 巫师 / 受缚巫师
      441, 534, // 税收官 / 痛苦亡魂
      637, 638, 656, // 猫 / 狗 / 兔兔
      670, 678, 679, 680, 681, 682, 683, 684, // 1.4.4.5 史莱姆
    ]
    for (const id of ids) {
      expect(NPC_STATE_TOGGLE_IDS.has(id)).toBe(true)
      expect(texts({ id, key: 'X', name: 'X', en: 'X' }).at(-1)).toBe(`/npc ${id}`)
    }
    // 不在清单里的 NPC 不会瞎给 `/npc`。
    const eye = { id: 4, key: 'EyeofCthulhu', name: '克苏鲁之眼', en: 'Eye of Cthulhu' }
    expect(texts(eye)).not.toContain('/npc 4')
  })

  it('/renameNPC 只给城镇 NPC（未解救形态不给）', () => {
    // 城镇 NPC：向导 / 渔夫 / 猫 / 史莱姆
    for (const id of [22, 369, 637, 670]) {
      expect(NPC_TOWN_IDS.has(id)).toBe(true)
      expect(texts({ id, key: 'X', name: 'X', en: 'X' }).some((c) => c.startsWith('/renameNPC '))).toBe(
        true,
      )
    }
    // 受缚 / 沉睡 / 被网 / 昏迷形态、以及普通怪：不给改名
    for (const id of [105, 376, 354, 579, 1, 4]) {
      expect(NPC_TOWN_IDS.has(id)).toBe(false)
      expect(texts({ id, key: 'X', name: 'X', en: 'X' }).some((c) => c.startsWith('/renameNPC '))).toBe(
        false,
      )
    }
  })

  it('/renameNPC 用 ID 传参（名字重名会改错），新名字留占位符', () => {
    // `Bunny` 既指城镇兔兔 656、也指小动物兔子 46：按名字会先命中 46 → 改名失败。
    expect(renameNpcCommand(656)).toBe('/renameNPC 656 <newname>')
    expect(renameNpcCommand(22, '阿导')).toBe('/renameNPC 22 阿导')
  })

  it('/npc 与 Boss 简写', () => {
    expect(toggleNpcCommand(369)).toBe('/npc 369')
    // 取不到比全名更短的别名时退到第一个词
    expect(bossShortAlias({ id: 50, key: 'KingSlime', name: '史莱姆王', sb: 'king slime' })).toBe(
      'king',
    )
    expect(bossShortAlias({ id: 50, key: 'KingSlime', name: '史莱姆王' })).toBeNull()
  })
})

/**
 * 真实生成数据的体检：手工维护的 ID 清单不能写错（改名 / 换版本时 id 会变）。
 * vitest 的 cwd 是 `web/`，数据在仓库根 `data/` 下。
 */
describe('npcRelatedCommands（真实数据）', () => {
  const dataDir = resolve(process.cwd(), '../data')
  const readJson = <T>(file: string): T => JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T
  const npcs = readJson<{ npcs: Array<{ id: number; key: string; en?: string; sb?: string; sbAll?: boolean }> }>(
    'npcs.json',
  ).npcs
  const npcIds = new Set(npcs.map((n) => n.id))
  const itemIds = new Set(
    readJson<{ items: Array<{ id: number }> }>('items.json').items.map((i) => i.id),
  )

  it('地牢 / 传送 / 解救清单里的 id 都真实存在', () => {
    for (const id of [...NPC_DUNGEON_IDS, ...NPC_TP_EXTRA_IDS, ...NPC_STATE_TOGGLE_IDS, ...NPC_TOWN_IDS]) {
      expect(npcIds.has(id), `NPC ${id}`).toBe(true)
    }
  })

  it('召唤物清单：NPC 存在、物品存在、且对得上「召唤物」名字', () => {
    const loc = readJson<{ ItemName: Record<string, string> }>('loc.zh-Hans.json')
    const byId = new Map(readJson<{ items: Array<{ id: number; key: string }> }>('items.json').items.map((i) => [i.id, i]))
    for (const [npcId, itemId] of NPC_SUMMON_ITEM) {
      expect(npcIds.has(npcId), `NPC ${npcId}`).toBe(true)
      const item = byId.get(itemId)
      expect(item, `物品 ${itemId}`).toBeTruthy()
      // 名字里带「召唤 / 诱饵 / 娃娃 / 电池 / 水晶 / 之蜂 / 符 / 虫 / 冠 / 华」等字样的才是召唤物，
      // 这里只保证不是明显写错（拿到具体名字便于排查）。
      expect(loc.ItemName[item!.key] ?? item!.key).toBeTruthy()
    }
  })

  it('几个真实 NPC 的完整行序（含召唤物、地牢、/sm）', () => {
    const npc = (id: number) => {
      const n = npcs.find((x) => x.id === id)!
      return { id: n.id, key: n.key, name: n.en ?? n.key, en: n.en, sb: n.sb, sbAll: n.sbAll }
    }
    const itemName = () => '召唤物'
    // 克苏鲁之眼：Boss 全套餐 + 召唤物（登录时）
    expect(npcRelatedCommands(npc(4), { username: 'Alice', itemName }).map((c) => c.command)).toEqual([
      '/spawnboss "eye of cthulhu"',
      '/sb eye', // sbAliases 排序后第一个非全名别名
      '/sb all',
      '/give 43 Alice',
      '/sm 4',
    ])
    // 老人（城镇 + 地牢）
    expect(npcRelatedCommands(npc(37)).map((c) => c.command)).toEqual([
      '/sm 37',
      '/tpnpc "Old Man"',
      '/renameNPC 37 <newname>',
      '/setdungeon',
      '/wm dungeon',
    ])
    // 邪教徒弓手：非城镇但有固定名字 + 地牢
    expect(npcRelatedCommands(npc(379)).map((c) => c.command)).toEqual([
      '/sm 379',
      '/tpnpc "Cultist Archer"',
      '/setdungeon',
      '/wm dungeon',
    ])
    // 树妖：城镇 NPC 的常态
    expect(npcRelatedCommands(npc(20)).map((c) => c.command)).toEqual([
      '/sm 20',
      '/tpnpc Dryad',
      '/renameNPC 20 <newname>',
    ])
  })

  it('`/sb all` 的行只出现在数据标了 `sbAll` 的 Boss 上', () => {
    const all = npcs.filter((n) => n.sbAll).map((n) => n.id)
    expect(all.length).toBeGreaterThan(10)
    for (const id of all) {
      const npc = npcs.find((n) => n.id === id)!
      expect(
        npcRelatedCommands({ id, key: npc.key, name: npc.en ?? npc.key, en: npc.en, sb: npc.sb, sbAll: true }).some(
          (c) => c.command === '/sb all',
        ),
      ).toBe(true)
    }
    // 没有 sb 的普通怪不会出现 `/sb all`
    expect(npcs.filter((n) => !n.sb).every((n) => !n.sbAll)).toBe(true)
    expect(itemIds.size).toBeGreaterThan(1000)
  })
})
