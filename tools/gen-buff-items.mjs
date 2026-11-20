#!/usr/bin/env node
/**
 * gen-buff-items.mjs —— 生成 data/buff-items.json（Buff → 能获得它的物品，供「数据 ID → Buff」详情展示）。
 *
 * 两个来源，都取自游戏自身数据，不手工枚举：
 *   1. 使用物品直接获得：GameDump 的 `Item.buffType`（已整理在 data/item-stats.json 的 stats.buffType）。
 *      药水 / 食物 / 宠物召唤物 / 召唤法杖 / 武器灌注药剂都在这条里。
 *   2. 坐骑：物品的 `Item.mountType` → `Mount.cs` 里该坐骑的 buff
 *      （`mounts[i] = mountData;` 后面的 `mountData.buff = X;` 或 `SetAsMinecart(mountData, X, …)`）。
 *      坐骑 buff 不在 Item.buffType 里，只能这样对上。
 *
 * 输出：{ meta, items: { [buffId]: itemId[] } }，物品按 id 升序；没有来源物品的 buff 不落盘。
 * 为什么不在运行期算：Mount.cs 的对应关系不是数据表，必须解析源码，只能构建期做一次。
 *
 * 运行：TR_SRC=../tr-code-1458 node tools/gen-buff-items.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TR_SRC = process.env.TR_SRC || join(HERE, '..', '..', 'tr-code-1458')
const OUT = process.env.OUT || join(HERE, '..', 'data', 'buff-items.json')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const readText = (p) => readFileSync(p, 'utf8')

/** Mount.cs：mountType → 该坐骑的 buff id。 */
function parseMountBuffs() {
  const src = readText(join(TR_SRC, 'Terraria', 'Mount.cs'))
  const map = new Map()
  let current = null
  for (const line of src.split('\n')) {
    const starts = /mounts\[(\d+)\] = mountData;/.exec(line)
    if (starts) {
      current = Number(starts[1])
      continue
    }
    if (current == null) continue
    // 普通坐骑直接写 buff；矿车系列统一走 SetAsMinecart(挂载点, buff, 贴图)。
    const buff = /mountData\.buff = (\d+);/.exec(line) || /SetAsMinecart\(mountData, (\d+),/.exec(line)
    if (!buff) continue
    map.set(current, Number(buff[1]))
    current = null
  }
  return map
}

const stats = readJson(join(HERE, '..', 'data', 'item-stats.json'))
const items = readJson(join(HERE, '..', 'data', 'items.json')).items
const buffs = readJson(join(HERE, '..', 'data', 'buffs.json')).buffs
const mountBuffByType = parseMountBuffs()

const knownItem = new Set(items.map((it) => it.id))
const knownBuff = new Set(buffs.map((b) => b.id))
const byBuff = new Map()
const add = (buffId, itemId) => {
  if (!knownBuff.has(buffId)) {
    console.warn(`[buff-items] 跳过未知 buff ${buffId}（来自物品 ${itemId}）`)
    return
  }
  if (!knownItem.has(itemId)) return
  const list = byBuff.get(buffId)
  if (list) list.push(itemId)
  else byBuff.set(buffId, [itemId])
}

const mountTypesWithItems = new Set()
for (const it of items) {
  const s = stats.items[String(it.id)]?.stats ?? {}
  if (typeof s.buffType === 'number' && s.buffType > 0) add(s.buffType, it.id)
  if (typeof s.mountType === 'number' && s.mountType >= 0) {
    mountTypesWithItems.add(s.mountType)
    const buff = mountBuffByType.get(s.mountType)
    if (buff != null) add(buff, it.id)
  }
}

// 每个 buff 内按物品 id 升序：稳定、可预期（与物品图鉴的 ID 顺序一致）。
const entries = {}
const sortedIds = [...byBuff.keys()].sort((a, b) => a - b)
let pairCount = 0
for (const buffId of sortedIds) {
  const list = [...new Set(byBuff.get(buffId))].sort((a, b) => a - b)
  entries[buffId] = list
  pairCount += list.length
}

const mountBuffNoItem = [...mountBuffByType.entries()]
  .filter(([type]) => !mountTypesWithItems.has(type))
  .map(([type, buff]) => `${buff}(${buffs.find((b) => b.id === buff)?.key ?? '?'} @ mountType ${type})`)
if (mountBuffNoItem.length > 0) {
  // 没有对应物品的坐骑（占位 / 未实装）：只提示，不阻断生成。
  console.warn(`[buff-items] 坐骑 buff 找不到物品：${mountBuffNoItem.join(', ')}`)
}

const payload = {
  meta: {
    gameVersion: stats.meta?.gameVersion ?? 'unknown',
    buffCount: buffs.length,
    withItems: sortedIds.length,
    pairCount,
    source: 'Item.buffType + Item.mountType→Mount.cs @ OTAPI ' + (stats.meta?.gameVersion ?? 'unknown'),
    generatedBy: 'tools/gen-buff-items.mjs',
    note: '每个 buff 列出全部来源物品（升序）；没有来源物品的 buff 不出现在 items 里',
  },
  items: entries,
}
writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n')
console.log(`[buff-items] ${sortedIds.length}/${buffs.length} buffs, ${pairCount} pairs -> ${OUT}`)
