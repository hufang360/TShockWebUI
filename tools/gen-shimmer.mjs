#!/usr/bin/env node
/**
 * gen-shimmer.mjs —— 从 GameDump 导出的 items-raw.json 提取「微光转换」映射。
 *
 * 来源：`ItemID.Sets.ShimmerTransformToItem`（源物品 → 目标物品；-1 = 无转换）。
 * 输入：RAW（GameDump 第 3 个输出 items-raw.json）
 * 输出：data/shimmer.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = process.env.RAW || process.argv[2] || '/tmp/items-raw.json'
const OUT = process.env.OUT || process.argv[3] || join(HERE, '..', 'data', 'shimmer.json')

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
const items = {}
for (const [id, v] of Object.entries(raw.items)) {
  const to = v?.shimmerTo
  // 只收录有效、且不是自身的映射。
  if (typeof to === 'number' && to > 0 && to !== Number(id)) items[id] = to
}

const payload = {
  meta: {
    gameVersion: raw.gameVersion,
    itemCount: raw.itemCount,
    count: Object.keys(items).length,
    source: 'ItemID.Sets.ShimmerTransformToItem @ OTAPI ' + raw.gameVersion,
    generatedBy: 'tools/gamedump/Program.cs DumpItems + tools/gen-shimmer.mjs',
    note: '源物品 id → 微光转换目标物品 id',
  },
  items,
}

writeFileSync(OUT, JSON.stringify(payload) + '\n')
console.log(`shimmer: ${Object.keys(items).length} mappings -> ${OUT}`)
