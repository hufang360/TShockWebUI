import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeCompletions } from './completion'
import { makeDataset } from '@/test/fixtures'
import type { CommandDef } from '@/types'

/**
 * 用**真实生成的数据**（data/commands.json，由 tools/gen-data.mjs 从 TShock 源码提取）
 * 跑一遍参数补全，防止数据 schema 与前端逻辑漂移。
 * 物品/词缀沿用测试夹具，避免解析 1MB 的 items.json。
 */
// vitest 的 cwd 是 web/，数据在仓库根 data/ 下。
const commands = JSON.parse(
  readFileSync(resolve(process.cwd(), '../data/commands.json'), 'utf8'),
).commands as CommandDef[]

const dataset = makeDataset({ commands })
const at = (text: string) => ({ dataset, text, caret: text.length, players: ['Alice', 'Bob'] })

describe('真实命令数据（data/commands.json）', () => {
  it('绝大多数核心指令都带上了参数表', () => {
    const withParams = commands.filter((c) => (c.paramSets?.length ?? 0) > 0)
    expect(withParams.length).toBeGreaterThanOrEqual(60)
    for (const c of withParams) {
      for (const set of c.paramSets ?? []) {
        expect(set.syntax.length).toBeGreaterThan(0)
        for (const a of set.args) {
          expect(Boolean(a.literal) !== Boolean(a.name)).toBe(true)
          if (a.kind === 'enum') expect(a.values?.length ?? 0).toBeGreaterThan(0)
        }
      }
    }
  })

  it('/give：物品 → 玩家 → 数量 → 词缀 逐位补全', () => {
    expect(computeCompletions(at('/give 生命'))[0]).toMatchObject({ kind: 'item', insert: '29' })
    expect(computeCompletions(at('/give 29 A')).map((c) => c.insert)).toEqual(['Alice'])
    expect(computeCompletions(at('/give 29 Alice '))).toHaveLength(0) // amount：number
    expect(computeCompletions(at('/give 29 Alice 1 传'))[0]).toMatchObject({
      kind: 'prefix',
      insert: '81',
    })
  })

  it('/spawnboss：BOSS 名来自源码 switch 的 case 标签', () => {
    const items = computeCompletions(at('/spawnboss moon'))
    expect(items.map((c) => c.insert)).toContain('"moon lord"') // 含空格 → 自动加引号
    expect(items.every((c) => c.kind === 'enum')).toBe(true)
  })

  it('/time 与 /clear：枚举取值不允许顺手弹玩家名', () => {
    expect(computeCompletions(at('/time ni')).map((c) => c.insert)).toEqual(['night'])
    expect(computeCompletions(at('/clear item 50')).every((c) => c.kind !== 'player')).toBe(true)
  })

  it('/help：参数是指令名', () => {
    const items = computeCompletions(at('/help gi'))
    expect(items.some((c) => c.kind === 'command' && c.insert === 'give')).toBe(true)
  })

  it('/region allow：<name> 按源码实为账号名 → 玩家补全', () => {
    expect(computeCompletions(at('/region allow A')).map((c) => c.insert)).toEqual(['Alice'])
  })

  it('/item 只给自己发物品，没有玩家参数（第 2 位是数量，不给候选）', () => {
    const item = commands.find((c) => c.name === 'item')
    expect(item?.paramSets?.[0]?.args.map((a) => a.name)).toEqual([
      'item name/id',
      'item amount',
      'prefix id/name',
    ])
    expect(computeCompletions(at('/item 29 A'))).toHaveLength(0)
  })

  it('allowServer=false 的指令同样有参数表（前端仍会拦截执行）', () => {
    const tp = commands.find((c) => c.name === 'tp')
    expect(tp?.allowServer).toBe(false)
    expect(tp?.paramSets?.length ?? 0).toBeGreaterThan(0)
    expect(computeCompletions(at('/tp A')).map((c) => c.insert)).toEqual(['Alice'])
  })
})

describe('运行期补全数据（NPC / buff / 区域 / 传送点）', () => {
  const withRuntime = (text: string) => ({
    ...at(text),
    runtimeValues: { regions: ['主城', '商店 街'], warps: ['home', 'shop'] },
  })

  it('/spawnmob 与 /buff：NPC / buff 候选来自本地数据，插数字 ID', () => {
    expect(computeCompletions(at('/spawnmob 蓝'))[0]).toMatchObject({ kind: 'npc', insert: '1' })
    expect(computeCompletions(at('/buff 黑'))[0]).toMatchObject({ kind: 'buff', insert: '1' })
    // /gbuff 第二参是 buff
    expect(computeCompletions(at('/gbuff Alice 再'))[0]).toMatchObject({ kind: 'buff', insert: '2' })
    // /butcher 的 NPC 参数同样来自本地数据
    expect(computeCompletions(at('/butcher 蓝'))[0]).toMatchObject({ kind: 'npc', insert: '1' })
  })

  it('/warp：传送点候选来自运行时数据（含空格自动加引号）', () => {
    expect(computeCompletions(withRuntime('/warp ho')).map((c) => c.insert)).toContain('home')
    // 子命令 send 的 warpname 参数
    expect(computeCompletions(withRuntime('/warp send Alice sh')).map((c) => c.insert)).toContain('shop')
  })

  it('/region：区域名候选来自运行时数据', () => {
    expect(computeCompletions(withRuntime('/region tp 主')).map((c) => c.insert)).toEqual(['主城'])
    // 含空格 → 加双引号（TShock ParseParameters 支持引号）
    expect(computeCompletions(withRuntime('/region tp 商店')).map((c) => c.insert)).toEqual(['"商店 街"'])
  })

  it('没有运行时数据时区域/传送点不给候选（不猜）', () => {
    expect(computeCompletions(at('/warp ho'))).toHaveLength(0)
    expect(computeCompletions(at('/region tp 主')).every((c) => c.kind !== 'region')).toBe(true)
  })
})
