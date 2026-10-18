import { describe, expect, it } from 'vitest'
import { bestPrefixIds, formatBenefit, isPrefixValid, prefixDeltaLines, rankPrefixes, roundHalfEven } from './prefixes'
import type { PrefixMods } from '@/types'

const mods = new Map<number, PrefixMods>([
  [59, { dmg: 1.15, kb: 1.15, crt: 5, val: 1.45475 }], // 神级
  [81, { dmg: 1.15, kb: 1.15, crt: 5, spd: 0.9, size: 1.1, val: 1.760248 }], // 传奇
  [83, { dmg: 1.15, kb: 1.15, crt: 5, spd: 0.9, mcst: 0.9, val: 1.760248 }], // 神话
  [65, { val: 1.2 }], // 护佑
  [72, { val: 1.2, benefit: { key: 'damage', value: 4 } }], // 险恶
  [30, { mcst: 1.2, dmg: 0.9, val: 0.9 }], // 无知
  [10, { dmg: 0.85, val: 0.85 }], // 钝
])

describe('roundHalfEven', () => {
  it('复刻 C# Math.Round（四舍六入五成双）', () => {
    expect(roundHalfEven(4.5)).toBe(4)
    expect(roundHalfEven(5.5)).toBe(6)
    expect(roundHalfEven(-4.5)).toBe(-4)
    expect(roundHalfEven(10.8)).toBe(11)
    expect(roundHalfEven(10.2)).toBe(10)
  })
})

describe('isPrefixValid', () => {
  it('复刻游戏的 4 个「无效果 → 无效」判定', () => {
    // 伤害 1：钝(dmg 0.85) → roundHalfEven(0.85)=1 == 1 → 无效
    expect(isPrefixValid({ damage: 1 }, mods.get(10))).toBe(false)
    // 伤害 7：roundHalfEven(5.95)=6 != 7 → 有效
    expect(isPrefixValid({ damage: 7 }, mods.get(10))).toBe(true)
    // 击退为 0 时任何击退倍率都无效
    expect(isPrefixValid({ damage: 10, knockBack: 0 }, mods.get(81))).toBe(false)
    // 缺属性时无法判定 → 不丢
    expect(isPrefixValid(undefined, mods.get(10))).toBe(true)
  })
})

describe('formatBenefit', () => {
  const t = (k: string) =>
    ({ 'prefix.stat.damage': '%伤害', 'prefix.stat.mana': '魔力', 'prefix.stat.defense': '防御力' })[k] ?? k

  it('伤害/防御无空格，魔力有空格（复刻游戏 tooltip 行）', () => {
    expect(formatBenefit({ key: 'damage', value: 4 }, t)).toBe('+4%伤害')
    expect(formatBenefit({ key: 'mana', value: 20 }, t)).toBe('+20 魔力')
    expect(formatBenefit({ key: 'defense', value: 4 }, t)).toBe('+4防御力')
  })
})

describe('prefixDeltaLines（词缀变化行，红绿）', () => {
  const t = (k: string, vars?: Record<string, string | number>) => {
    const names: Record<string, string> = {
      damage: '%伤害',
      speed: '%速度',
      crit: '%暴击率',
      mana: '%魔力消耗',
      size: '%大小',
      shootSpeed: '%射弹速度',
      knockback: '%击退力',
      armorPen: '{v}点盔甲穿透力',
      tagDamage: '{v}点召唤标记伤害',
    }
    const name = k.startsWith('prefix.delta.') ? k.replace('prefix.delta.', '') : k.replace('prefix.stat.', '')
    let s = names[name] ?? k
    if (vars) for (const [key, val] of Object.entries(vars)) s = s.replace(`{${key}}`, String(val))
    return s
  }

  it('武器词缀：伤害/攻速/暴击/击退为绿（正），复刻游戏', () => {
    const deltas = prefixDeltaLines({ damage: 100, useAnimation: 20, knockBack: 5 }, mods.get(81), t)
    const byText = new Map(deltas.map((d) => [d.text, d.tone]))
    expect(byText.get('+15%伤害')).toBe('up')
    expect(byText.get('+10%速度')).toBe('up') // spd 0.9 → useAnimation 20→18
    expect(byText.get('+5%暴击率')).toBe('up')
    expect(byText.get('+15%击退力')).toBe('up')
  })

  it('魔法降蓝耗是好事（绿），增蓝耗是红', () => {
    const lower = prefixDeltaLines({ damage: 42, useAnimation: 12, mana: 10 }, mods.get(83), t)
    expect(lower.find((d) => d.text === '-10%魔力消耗')?.tone).toBe('up')
    const higher = prefixDeltaLines({ damage: 42, useAnimation: 12, mana: 10 }, mods.get(30), t)
    expect(higher.find((d) => d.text.includes('%魔力消耗'))?.tone).toBe('down')
  })

  it('饰品词缀：直接给一行绿色效果', () => {
    const deltas = prefixDeltaLines({ accessory: true }, mods.get(72), t)
    expect(deltas).toEqual([{ text: '+4%伤害', tone: 'up' }])
  })
})

describe('bestPrefixIds / rankPrefixes', () => {
  it('取评分最高的词缀；并列返回多个（饰品顶级词缀）', () => {
    const w = { damage: 100, useAnimation: 20, knockBack: 5 }
    expect(bestPrefixIds([59, 81], mods, w)).toEqual([81])
    expect(bestPrefixIds([65, 72, 59], mods, {})).toEqual([65, 72])
    expect(bestPrefixIds([], mods, w)).toEqual([])
  })

  it('魔法武器：mana×0.9 恰为 .5 时不能被误判无效（银行家舍入）', () => {
    // 魔法竖琴：mana=5，神话 mcst=0.9 → 4.5 → C# 舍入 4 ≠ 5 → 有效
    expect(
      bestPrefixIds([59, 83], mods, { damage: 42, useAnimation: 12, mana: 5, knockBack: 1.5 }),
    ).toEqual([83])
  })

  it('按评分从高到低排序', () => {
    const ranked = rankPrefixes([10, 59, 81], mods, {
      damage: 100,
      useAnimation: 20,
      knockBack: 5,
    })
    expect(ranked.map((p) => p.id)).toEqual([81, 59, 10])
    expect(ranked.map((p) => p.val)).toEqual([1.760248, 1.45475, 0.85])
  })

  it('缺少 val 的词缀仍出现在列表里（排最后），但不参与最佳', () => {
    const noVal = new Map<number, PrefixMods>([[7, { dmg: 1.1 }]])
    const s = { damage: 100, useAnimation: 20, knockBack: 5 }
    expect(rankPrefixes([7], noVal, s).map((p) => p.id)).toEqual([7])
    expect(bestPrefixIds([7], noVal, s)).toEqual([])
  })
})
