#!/usr/bin/env node
/**
 * gen-prefix-mods.mjs —— 从反编译源码解析「词缀数值修正」。
 *
 * 来源：`TR_SRC/Terraria/Item.cs` 的 `TryGetPrefixStatMultipliersForItem()` switch（与物品无关的乘/加表）。
 * 输出：data/prefix-mods.json = { meta, mods: { "<prefixId>": { dmg, kb, spd, crt, mcst, ... } } }
 * 只保留与默认不同的字段（乘数为 1、加值为 0 的省略）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TR_SRC = process.env.TR_SRC || join(HERE, '..', '..', 'tr-code-1458')
const OUT = process.env.OUT || join(HERE, '..', 'data', 'prefix-mods.json')

const FIELDS = ['dmg', 'kb', 'spd', 'size', 'shtspd', 'mcst', 'crt', 'tagdmg', 'arpen']

const src = readFileSync(join(TR_SRC, 'Terraria', 'Item.cs'), 'utf8')
const start = src.indexOf('TryGetPrefixStatMultipliersForItem(int rolledPrefix')
const end = src.indexOf('value = 1f * dmg', start)
if (start < 0 || end < 0) throw new Error('未找到 TryGetPrefixStatMultipliersForItem')
const body = src.slice(start, end)

const mods = {}
for (const m of body.matchAll(/case (\d+):([\s\S]*?)break;/g)) {
  const id = Number(m[1])
  const mod = {}
  for (const a of m[2].matchAll(/(\w+) = (-?[\d.]+)f?;/g)) {
    const key = a[1]
    if (!FIELDS.includes(key)) continue
    mod[key] = Number(a[2])
  }
  mods[id] = mod
}
// 饰品词缀 62–80 在 switch 里没有分支（它们直接影响玩家属性，不通过物品乘数），
// value 只由下面的顶级词缀倍率决定（如 65/72/76/80/68 → ×1.2）。
for (let id = 62; id <= 80; id++) if (!(id in mods)) mods[id] = {}

// 游戏内 `Item.TryGetPrefixStatMultipliersForItem` 末尾的 `value` 公式，
// 即词缀「评分」（`Item.BestPrefixValue()` / `rolledPrefixIsTopTier` 用它判定「顶级词缀」）。
// 纯词缀属性，与物品无关；保留 6 位小数让应相等的词缀产生完全相同的值（并列即多个最佳）。
const TOP_TIER = { 62: 1.05, 69: 1.05, 73: 1.05, 77: 1.05, 63: 1.1, 70: 1.1, 74: 1.1, 78: 1.1, 67: 1.1,
  64: 1.15, 71: 1.15, 75: 1.15, 79: 1.15, 66: 1.15, 65: 1.2, 72: 1.2, 76: 1.2, 80: 1.2, 68: 1.2 }
const prefixValue = (mod, id) => {
  const g = (k, d) => mod[k] ?? d
  let v = g('dmg', 1) * (2 - g('spd', 1)) * (2 - g('mcst', 1)) * g('size', 1) * g('kb', 1) * g('shtspd', 1)
    * (1 + g('crt', 0) * 0.02) * (1 + g('arpen', 0) * 0.015) * (1 + g('tagdmg', 0) * 0.03)
  v *= TOP_TIER[id] ?? 1
  return Math.round(v * 1e6) / 1e6
}
for (const [id, mod] of Object.entries(mods)) mods[id] = { ...mod, val: prefixValue(mod, Number(id)) }

// 饰品词缀 62–80 的**精确效果**：Player.GrantPrefixBenefits()（tooltip 行见 Main.cs:21405）。
// 与武器词缀不同，这些不走物品乘数，而是直接加玩家属性（防御/魔力/暴击/伤害/移速/近战速度）。
const BENEFIT_KIND = {
  statDefense: 'defense', statManaMax2: 'mana',
  meleeCrit: 'crit', rangedCrit: 'crit', magicCrit: 'crit',
  meleeDamage: 'damage', rangedDamage: 'damage', magicDamage: 'damage', minionDamage: 'damage',
  moveSpeed: 'moveSpeed', meleeSpeed: 'meleeSpeed',
}
/** 展示时乘 100 的（源码里是 0.04 这种比例）。 */
const PERCENT_KIND = new Set(['damage', 'moveSpeed', 'meleeSpeed'])
const playerSrc = readFileSync(join(TR_SRC, 'Terraria', 'Player.cs'), 'utf8')
const gpbStart = playerSrc.indexOf('GrantPrefixBenefits(Item item)')
const gpbEnd = playerSrc.indexOf('private void SpawnHallucination', gpbStart)
if (gpbStart < 0 || gpbEnd < 0) throw new Error('未找到 Player.GrantPrefixBenefits')
for (const m of playerSrc.slice(gpbStart, gpbEnd).matchAll(/if \(item\.prefix == (\d+)\)\s*\{([^}]*)\}/g)) {
  const id = Number(m[1])
  let key = null
  let raw = 0
  for (const a of m[2].matchAll(/(\w+)\s*(\+\+|--|\+=|=)\s*([\d.]*)?f?;/g)) {
    const kind = BENEFIT_KIND[a[1]]
    if (!kind) continue
    key = kind
    raw = a[2] === '++' ? 1 : a[2] === '--' ? -1 : Number(a[3])
  }
  if (key) {
    const value = PERCENT_KIND.has(key) ? Math.round(raw * 100) : raw
    mods[id] = { ...(mods[id] ?? {}), benefit: { key, value } }
  }
}

const payload = {
  meta: {
    count: Object.keys(mods).length,
    source: 'Terraria/Item.cs TryGetPrefixStatMultipliersForItem() @ 1.4.5.8',
    generatedBy: 'tools/gen-prefix-mods.mjs',
    note: '乘数（dmg/kb/spd/mcst…）与加值（crt）；与物品无关。val = 游戏自身的词缀评分（Item.BestPrefixValue 用它取「顶级词缀」）；benefit = 饰品词缀的精确效果（Player.GrantPrefixBenefits）',
  },
  mods,
}
writeFileSync(OUT, JSON.stringify(payload) + '\n')
console.log(`prefix-mods: ${Object.keys(mods).length} prefixes -> ${OUT}`)
