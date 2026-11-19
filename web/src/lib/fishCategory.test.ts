// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { FISH_CATEGORIES, commandRoot, matchFishCategories, resolveFishCategory } from './fishCategory'
import type { FishGood } from './tshock'

/** 只填分类判断需要的字段（id / cmds）；其余给空的。 */
function good(patch: Partial<FishGood>): FishGood {
  return {
    serial: 1,
    name: '商品',
    map: [],
    desc: '',
    cost: '',
    unlock: '',
    comment: '',
    ...patch,
  }
}

describe('commandRoot', () => {
  it('去掉前导 / 与参数', () => {
    expect(commandRoot('/igen pond water')).toBe('igen')
    expect(commandRoot('  /clip  paste spawnerfarm foot ')).toBe('clip')
    expect(commandRoot('//npc tphere 3')).toBe('npc')
    expect(commandRoot('/CT')).toBe('ct')
    expect(commandRoot('')).toBe('')
  })
})

describe('鱼店分类', () => {
  it('地牢：按物品 id 归', () => {
    expect(matchFishCategories(good({ id: 155 }))).toEqual(['dungeon']) // 村正
    expect(matchFishCategories(good({ id: 5465 }))).toEqual(['dungeon']) // 牧羊符文
    expect(matchFishCategories(good({ id: 2192 }))).toEqual(['dungeon']) // 骨头焊机
  })

  it('buff：预设 id / -600 段预设 / -5000-buffID', () => {
    expect(matchFishCategories(good({ id: -159 }))).toContain('buff') // 增益
    expect(matchFishCategories(good({ id: -169 }))).toContain('buff') // 钓鱼佬
    expect(matchFishCategories(good({ id: -603 }))).toContain('buff') // 弹无虚发
    expect(matchFishCategories(good({ id: -5001 }))).toContain('buff') // 黑曜石皮
    expect(matchFishCategories(good({ id: -5999 }))).toContain('buff')
    expect(matchFishCategories(good({ id: -4999 }))).not.toContain('buff')
  })

  it('指令：只认 -160', () => {
    expect(matchFishCategories(good({ id: -160 }))).toEqual(['cmd'])
  })

  it('建造：按 cmds 的指令根（含 /ct、/cleartomb，不含 /wm）', () => {
    expect(matchFishCategories(good({ id: -160, cmds: ['/igen room'] }))).toEqual(['cmd', 'build'])
    expect(matchFishCategories(good({ id: -160, cmds: ['/clip paste spawnerfarm foot'] }))).toContain('build')
    expect(matchFishCategories(good({ id: -160, cmds: ['/cleartomb'] }))).toContain('build')
    expect(matchFishCategories(good({ id: -160, cmds: ['/ct'] }))).toContain('build')
    expect(matchFishCategories(good({ id: -160, cmds: ['/wm room'] }))).not.toContain('build')
    // 不是指令根的词不算（/igen check 在 check 字段里，cmds 里只认真实施工的那条）
    expect(matchFishCategories(good({ id: -160, cmds: ['/godmode'] }))).toEqual(['cmd'])
  })

  it('召唤：-146 同时在召唤与世界事件；-601 挑战白光、入侵 -171~-176、血月 / 日食 / 史莱姆雨都算召唤', () => {
    expect(matchFishCategories(good({ id: -146 }))).toEqual(['summon', 'worldEvent'])
    expect(matchFishCategories(good({ id: -601 }))).toEqual(['summon'])
    for (const id of [-171, -172, -173, -174, -175, -176]) {
      expect(matchFishCategories(good({ id }))).toEqual(['summon', 'worldEvent'])
    }
    for (const id of [-178, -182, -183, -149, -150]) {
      expect(matchFishCategories(good({ id }))).toEqual(['summon', 'worldEvent'])
    }
    // 天气 / 时刻不算召唤
    for (const id of [-143, -147, -177, -180, -184]) {
      expect(matchFishCategories(good({ id }))).toEqual(['worldEvent'])
    }
    expect(matchFishCategories(good({ id: -1050 }))).toContain('summon')
    expect(matchFishCategories(good({ id: -1999 }))).toContain('summon')
    expect(matchFishCategories(good({ id: -2000 }))).not.toContain('summon')
  })

  it('团队：-162 / -163 / -602 / -141 烟花起飞，以及 cmds 里的 /tphere', () => {
    expect(matchFishCategories(good({ id: -162 }))).toEqual(['team'])
    expect(matchFishCategories(good({ id: -602, cmds: ['/tphere *'] }))).toEqual(['team'])
    expect(matchFishCategories(good({ id: -141 }))).toEqual(['team'])
    expect(matchFishCategories(good({ id: -160, cmds: ['/tphere *'] }))).toEqual(['cmd', 'team'])
    // 弹无虚发只算 buff，不归团队
    expect(matchFishCategories(good({ id: -603 }))).toEqual(['buff'])
  })

  it('npc：内置 id、清除段、/npc 与 /tpnpc；/npc tphere 不算团队', () => {
    expect(matchFishCategories(good({ id: -161 }))).toEqual(['npc'])
    expect(matchFishCategories(good({ id: -901 }))).toEqual(['npc'])
    expect(matchFishCategories(good({ id: -4369 }))).toContain('npc')
    expect(matchFishCategories(good({ id: -160, cmds: ['/tpnpc {0}'] }))).toEqual(['npc', 'cmd'])
    expect(matchFishCategories(good({ id: -160, cmds: ['/npc tphere {0} --onlyTown'] }))).toEqual(['npc', 'cmd'])
  })

  it('趣味 / 重铸：各认自己那几个 id', () => {
    for (const id of [-189, -190, -902, -906, -907]) {
      expect(matchFishCategories(good({ id }))).toEqual(['fun'])
    }
    for (const id of [-900, -191, -904, -905]) {
      expect(matchFishCategories(good({ id }))).toEqual(['reforge'])
    }
  })

  it('钓鱼：-142 / -169 + 渔业集合（3120 / 3096 / 3037 / 2373~2375）', () => {
    expect(matchFishCategories(good({ id: -142 }))).toEqual(['fishing'])
    expect(matchFishCategories(good({ id: -169 }))).toEqual(['fishing', 'buff'])
    for (const id of [3120, 3096, 3037, 2373, 2374, 2375]) {
      expect(matchFishCategories(good({ id }))).toEqual(['fishing'])
    }
  })

  it('世界事件：月相 / 时间 / 天气 / 入侵 / 事件，跳过 -142 与 -145', () => {
    for (const id of [-131, -139, -143, -144, -147, -164, -165, -177, -188]) {
      expect(matchFishCategories(good({ id }))).toEqual(['worldEvent'])
    }
    // 入侵 / 血月 / 「事件」类同时在召唤里（见上一个用例）
    for (const id of [-171, -176, -149, -150]) {
      expect(matchFishCategories(good({ id }))).toEqual(['summon', 'worldEvent'])
    }
    expect(matchFishCategories(good({ id: -142 }))).toEqual(['fishing'])
    expect(matchFishCategories(good({ id: -145 }))).toEqual(['buff'])
    expect(matchFishCategories(good({ id: -170 }))).toEqual(['buff'])
  })

  it('没有任何分组依据的商品返回空数组', () => {
    expect(matchFishCategories(good({ id: 29 }))).toEqual([])
    expect(matchFishCategories(good({ id: 0 }))).toEqual([])
    expect(matchFishCategories(good({}))).toEqual([])
    expect(matchFishCategories(null)).toEqual([])
    expect(matchFishCategories(undefined)).toEqual([])
  })

  it('每个分组都配了图标 id', () => {
    for (const { id, iconId } of FISH_CATEGORIES) {
      expect(iconId, id).toBeGreaterThan(0)
    }
  })

  it('分组顺序：钓鱼 / buff / npc 最前，地牢紧挨在世界事件前面', () => {
    expect(FISH_CATEGORIES.map((c) => c.id)).toEqual([
      'fishing',
      'buff',
      'npc',
      'cmd',
      'build',
      'summon',
      'team',
      'fun',
      'reforge',
      'dungeon',
      'worldEvent',
    ])
  })

  it('本机存的脏值认不出来就当没选', () => {
    expect(resolveFishCategory('dungeon')).toBe('dungeon')
    expect(resolveFishCategory('')).toBeNull()
    expect(resolveFishCategory('不存在')).toBeNull()
    expect(resolveFishCategory(undefined)).toBeNull()
    expect(resolveFishCategory(42)).toBeNull()
  })
})
