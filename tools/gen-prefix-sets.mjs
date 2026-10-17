#!/usr/bin/env node
/**
 * gen-prefix-sets.mjs —— 整理「每件物品可滚词缀」原始数据。
 *
 * 来源：GameDump 调用游戏自身的 `Item.GetRollablePrefixes()`（武器/饰品各不相同，盔甲返回 null）。
 * 输入：RAW（GameDump 第 5 个输出）
 * 输出：data/prefix-sets.json = { meta, sets: [[prefixId...]], items: { itemId: setIndex } }
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = process.env.RAW || process.argv[2] || '/tmp/prefix-sets-raw.json'
const OUT = process.env.OUT || process.argv[3] || join(HERE, '..', 'data', 'prefix-sets.json')

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
const items = {}
for (const [id, idx] of Object.entries(raw.items)) items[id] = idx

const payload = {
  meta: {
    gameVersion: raw.gameVersion,
    setCount: raw.setCount,
    itemCount: raw.itemCount,
    source: 'Item.GetRollablePrefixes() @ OTAPI ' + raw.gameVersion,
    generatedBy: 'tools/gamedump/Program.cs DumpPrefixSets + tools/gen-prefix-sets.mjs',
    note: 'sets 为去重后的可滚词缀数组；items 为物品 id → sets 下标（无词缀的物品不收录，如盔甲）',
  },
  sets: raw.sets,
  items,
}
writeFileSync(OUT, JSON.stringify(payload) + '\n')
console.log(`prefix-sets: ${Object.keys(items).length} items, ${raw.setCount} sets -> ${OUT}`)
