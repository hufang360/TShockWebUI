#!/usr/bin/env node
/**
 * gen-item-groups.mjs —— 把 GameDump 导出的「创意菜单分组」整理为 data/item-groups.json。
 *
 * 数据来源（全部来自游戏运行时，不手工编造）：
 *   - 物品分组 / 组内顺序：ContentSamples.CreativeHelper.GetItemGroup
 *                         ContentSamples.ItemCreativeSortingId（ByCreativeSortingId 排序用）
 *   - 创意菜单页签：Terraria.GameContent.Creative.ItemFilters
 *     （与 UICreativeInfiniteItemsDisplay 构造时使用的过滤器列表完全一致）
 *
 * 输入：RAW（GameDump 第 4 个输出）
 * 输出：data/item-groups.json
 *
 * 说明：一个物品可同时属于多个页签（如既是武器又是材料），这是游戏 EntranceFilterer 的行为；
 *       分组 g / 组内顺序 o 用于「选中页签后按游戏自身顺序展示」。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = process.env.RAW || process.argv[2] || '/tmp/item-groups-raw.json'
const OUT = process.env.OUT || process.argv[3] || join(HERE, '..', 'data', 'item-groups.json')

// 游戏本地化 key → 前端 i18n 键后缀（dex.tab.<id>）。
const TAB_IDS = {
  'CreativePowers.TabWeapons': 'weapons',
  'CreativePowers.TabArmor': 'armor',
  'CreativePowers.TabVanity': 'vanity',
  'CreativePowers.TabBlocks': 'blocks',
  'CreativePowers.TabFurniture': 'furniture',
  'CreativePowers.TabAccessories': 'accessories',
  'CreativePowers.TabAccessoriesMisc': 'accessoriesMisc',
  'CreativePowers.TabConsumables': 'consumables',
  'CreativePowers.TabTools': 'tools',
  'CreativePowers.TabMaterials': 'materials',
  'CreativePowers.TabMisc': 'misc',
}

const raw = JSON.parse(readFileSync(RAW, 'utf8'))

const tabs = raw.tabs.map((t) => {
  const id = TAB_IDS[t.key]
  if (!id) throw new Error(`未知的创意菜单页签 key：${t.key}`)
  return { id, label: t.key }
})

const items = {}
let missing = 0
for (const [id, v] of Object.entries(raw.items)) {
  if (!v || !Array.isArray(v.t)) { missing++; continue }
  items[id] = { g: v.g, gv: v.gv, o: v.o, t: v.t }
}

const payload = {
  meta: {
    gameVersion: raw.gameVersion,
    itemCount: raw.itemCount,
    tabCount: tabs.length,
    source:
      'Terraria.GameContent.Creative.ItemFilters（创意菜单页签） + ' +
      'ContentSamples.CreativeHelper.GetItemGroup / ContentSamples.ItemCreativeSortingId（分组与组内顺序）',
    generatedBy: 'tools/gamedump/Program.cs DumpItemGroups + tools/gen-item-groups.mjs',
    note: '物品可属于多个页签；gv/o 用于按游戏 ByCreativeSortingId 顺序展示',
  },
  tabs,
  items,
}

writeFileSync(OUT, JSON.stringify(payload) + '\n')
console.log(`item-groups: ${Object.keys(items).length} items, ${tabs.length} tabs -> ${OUT}`)
if (missing) console.log(`  跳过缺少页签数据的物品：${missing}`)
