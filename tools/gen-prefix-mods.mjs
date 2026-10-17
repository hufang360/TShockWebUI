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

const payload = {
  meta: {
    count: Object.keys(mods).length,
    source: 'Terraria/Item.cs TryGetPrefixStatMultipliersForItem() @ 1.4.5.8',
    generatedBy: 'tools/gen-prefix-mods.mjs',
    note: '乘数（dmg/kb/spd/mcst…）与加值（crt）；与物品无关',
  },
  mods,
}
writeFileSync(OUT, JSON.stringify(payload) + '\n')
console.log(`prefix-mods: ${Object.keys(mods).length} prefixes -> ${OUT}`)
