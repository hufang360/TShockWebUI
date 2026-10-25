import { describe, expect, it } from 'vitest'
import {
  SPAWN_BOSS_TIPS,
  SPAWN_MOB_EXAMPLES,
  TP_NPC_EXAMPLES,
  spawnBossCommand,
  spawnMobCommand,
  tpNpcCommand,
} from './spawnTips'

describe('spawnTips', () => {
  it('含空格的参数加引号（TShock ParseParameters 处理引号）', () => {
    expect(spawnBossCommand('king slime')).toBe('/spawnboss "king slime"')
    expect(spawnBossCommand('golem')).toBe('/spawnboss golem')
    expect(spawnMobCommand('guide')).toBe('/spawnmob guide')
    expect(spawnMobCommand('traveling merchant')).toBe('/spawnmob "traveling merchant"')
    expect(spawnMobCommand(22)).toBe('/spawnmob 22')
  })

  it('/tpnpc 用英文名（中文/英文服务器都匹配），含空格加引号', () => {
    expect(tpNpcCommand({ key: 'TravellingMerchant', en: 'Traveling Merchant' })).toBe(
      '/tpnpc "Traveling Merchant"',
    )
    expect(tpNpcCommand({ key: 'Guide', en: 'Guide' })).toBe('/tpnpc Guide')
    // 缺英文名时回退内部名（不静默产出空参数）
    expect(tpNpcCommand({ key: 'Guide' })).toBe('/tpnpc Guide')
  })

  it('Boss 清单与 ShowSpawnTips 一致：30 条、sb 唯一、顺序从史莱姆王到月亮领主', () => {
    expect(SPAWN_BOSS_TIPS).toHaveLength(30)
    expect(new Set(SPAWN_BOSS_TIPS.map((t) => t.sb)).size).toBe(SPAWN_BOSS_TIPS.length)
    expect(SPAWN_BOSS_TIPS[0].sb).toBe('king slime')
    expect(SPAWN_BOSS_TIPS.at(-1)?.sb).toBe('moon lord')
  })

  it('示例用 NPCID 常量名：召唤向导 / 旅商、传送渔夫 / 哥布林工匠', () => {
    expect([...SPAWN_MOB_EXAMPLES]).toEqual(['Guide', 'TravellingMerchant'])
    expect([...TP_NPC_EXAMPLES]).toEqual(['Angler', 'GoblinTinkerer'])
  })
})
