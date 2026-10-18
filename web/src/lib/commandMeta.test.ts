import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enumLabelsFor, extraParamSetsFor } from './commandMeta'
import type { CommandDef, Npc } from '@/types'

const npcs: Npc[] = [
  { id: 1, key: 'BlueSlime', name: '蓝史莱姆' },
  {
    id: 4,
    key: 'EyeofCthulhu',
    name: '克苏鲁之眼',
    sb: 'eye of cthulhu',
    sbAliases: ['eoc', 'eye'],
    sbAll: true,
  },
]

describe('enumLabelsFor', () => {
  it('spawnboss：别名 → NPC 名；分组 Boss 用固定名', () => {
    const zh = enumLabelsFor('spawnboss', 'zh', npcs)
    expect(zh['eye of cthulhu']).toBe('克苏鲁之眼')
    expect(zh.eoc).toBe('克苏鲁之眼')
    expect(zh.all).toBe('全部 Boss')
    expect(zh['*']).toBe('全部 Boss')
    expect(zh.twins).toBe('双子魔眼')
    expect(enumLabelsFor('spawnboss', 'en', npcs).twins).toBe('the Twins')
  })

  it('worldevent / worldmode：中英', () => {
    expect(enumLabelsFor('worldevent', 'zh', []).bloodmoon).toBe('血月')
    expect(enumLabelsFor('worldevent', 'en', []).bloodmoon).toBe('Blood Moon')
    expect(enumLabelsFor('worldevent', 'zh', []).martians).toBe('火星暴乱')
    expect(enumLabelsFor('worldmode', 'zh', []).journey).toBe('旅途')
  })

  it('region / firework / warp / time / clear + 字面量子命令', () => {
    expect(enumLabelsFor('region', 'zh', []).u).toBe('上')
    expect(enumLabelsFor('region', 'zh', [])['-d']).toBe('显示区域边界')
    expect(enumLabelsFor('region', 'zh', []).true).toBe('开（保护）')
    expect(enumLabelsFor('region', 'zh', []).resize).toBe('调整区域大小')
    expect(enumLabelsFor('firework', 'zh', []).R).toBe('红')
    expect(enumLabelsFor('warp', 'zh', []).send).toBe('把玩家送到传送点')
    expect(enumLabelsFor('time', 'zh', []).noon).toBe('正午')
    expect(enumLabelsFor('clear', 'zh', []).npc).toBe('生物')
    expect(enumLabelsFor('group', 'zh', []).addperm).toBe('给用户组加权限')
  })

  it('插件：playermanager / worldmodify / fishshop 的子命令备注', () => {
    expect(enumLabelsFor('playermanager', 'zh', []).export).toBe('导出指定玩家 .plr')
    expect(enumLabelsFor('playermanager', 'en', []).look).toBe('View player')
    expect(enumLabelsFor('worldmodify', 'zh', []).moondial).toBe('月晷（跳过夜晚）')
    expect(enumLabelsFor('fishshop', 'zh', []).ask).toBe('询价')
    expect(enumLabelsFor('fishshop', 'en', []).buy).toBe('Buy')
  })

  it('未知指令返回空表', () => {
    expect(enumLabelsFor('give', 'zh', npcs)).toEqual({})
  })
})

describe('extraParamSetsFor', () => {
  it('worldevent：补出 invasion 的第 3 级', () => {
    const sets = extraParamSetsFor('worldevent')
    expect(sets.map((s) => s.syntax)).toContain('worldevent invasion <invasion type> [入侵波数]')
    const invasion = sets.find((s) => s.syntax.includes('invasion'))
    expect(invasion?.args[0]).toEqual({ literal: 'invasion' })
    expect(invasion?.args[1]).toMatchObject({ kind: 'enum' })
    expect(invasion?.args[1].values).toContain('goblins')
  })

  it('插件：pm / wm / fish 都有字面量子命令', () => {
    for (const name of ['playermanager', 'worldmodify', 'fishshop']) {
      const sets = extraParamSetsFor(name)
      expect(sets.length).toBeGreaterThan(5)
      expect(sets.some((s) => s.args[0]?.literal === 'help')).toBe(true)
    }
  })

  it('未知指令返回空表', () => {
    expect(extraParamSetsFor('give')).toEqual([])
  })
})

describe('真实数据覆盖度', () => {
  it('所有 TShock enum 取值都有备注名', () => {
    const commands = JSON.parse(
      readFileSync(resolve(process.cwd(), '../data/commands.json'), 'utf8'),
    ).commands as CommandDef[]
    const realNpcs = JSON.parse(
      readFileSync(resolve(process.cwd(), '../data/npcs.json'), 'utf8'),
    ).npcs as Npc[]
    const loc = JSON.parse(
      readFileSync(resolve(process.cwd(), '../data/loc.zh-Hans.json'), 'utf8'),
    ) as { NPCName?: Record<string, string> }
    const namedNpcs = realNpcs.map((n) => ({ ...n, name: loc.NPCName?.[n.key] ?? n.key }))
    const missing: string[] = []
    for (const c of commands) {
      for (const set of c.paramSets ?? []) {
        for (const a of set.args) {
          if (a.kind !== 'enum' || !a.values) continue
          const labels = enumLabelsFor(c.name, 'zh', namedNpcs)
          for (const v of a.values) {
            if (!labels[v]) missing.push(`${c.name} <${a.name ?? a.literal}> = ${v}`)
          }
        }
      }
    }
    expect(missing).toEqual([])
  })
})
