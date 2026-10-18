import type {
  Atlas,
  Buff,
  CommandDef,
  Dataset,
  DatasetMeta,
  Item,
  ItemStatsBaseData,
  ItemStatsData,
  ItemTipsData,
  ItemGroupsData,
  ItemDropsData,
  ItemDropEntry,
  ShimmerData,
  PrefixModsData,
  PrefixSetsData,
  Lang,
  LocalizationBundle,
  Npc,
  Prefix,
  RecipesData,
  TileWallData,
} from '@/types'
import { ATLAS_JSON_FETCH } from './atlas'
import { readJson, removeKey, StorageKeys, writeJson } from './storage'
import { extraParamSetsFor } from './commandMeta'
import type { RuntimeCommand } from './transport'

const BASE = import.meta.env.BASE_URL

/** 界面语言 → 官方本地化 culture 名。 */
export function cultureOf(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'zh-Hans'
}

async function fetchJson<T>(file: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}data/${file}`, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    throw new Error(`加载 ${file} 失败：HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

function buildCommandIndex(commands: CommandDef[]): Map<string, CommandDef> {
  const index = new Map<string, CommandDef>()
  for (const cmd of commands) {
    index.set(cmd.name.toLowerCase(), cmd)
    for (const alias of cmd.aliases) {
      index.set(alias.toLowerCase(), cmd)
    }
  }
  return index
}

/**
 * 把手工维护的额外参数形态（多级子命令，见 `lib/commandMeta.ts`）合并进指令：
 * 按 `syntax` 覆盖同名形态（幂等），并重建补全索引。
 * `loadDataset`（核心指令）与 `withRuntimeCommands`（插件运行时指令）都会调它。
 */
function withCommandMeta(base: Dataset): Dataset {
  let changed = false
  const commands = base.commands.map((cmd) => {
    const extra = extraParamSetsFor(cmd.name)
    if (extra.length === 0) return cmd
    const bySyntax = new Map((cmd.paramSets ?? []).map((s) => [s.syntax, s]))
    for (const s of extra) bySyntax.set(s.syntax, s)
    changed = true
    return { ...cmd, paramSets: [...bySyntax.values()] }
  })
  if (!changed) return base
  return { ...base, commands, commandsByToken: buildCommandIndex(commands) }
}

/**
 * 载入指定语言的数据集。
 *
 * 语言相关数据一律只在运行期取当前语言那一份：
 * - `loc.<culture>.json`：官方本地化（物品名 / 词缀名 / 配方组名），游戏原生两级格式；
 * - `item-tips.<culture>.json`：物品提示行。
 * 与语言无关的 `items.json` / `item-stats.json` / `recipes.json` 只加载一次。
 */
export async function loadDataset(lang: Lang = 'zh'): Promise<Dataset> {
  const culture = cultureOf(lang)
  const [itemsFile, prefixesFile, npcsFile, buffsFile, commandsFile, meta, atlas, recipes, stats, tips, groups, shimmer, prefixMods, prefixSets, loc, tiles, walls, drops] = await Promise.all([
    fetchJson<{ items: Omit<Item, 'name'>[] }>('items.json'),
    fetchJson<{ prefixes: Omit<Prefix, 'name'>[] }>('prefixes.json'),
    fetchJson<{ npcs: Omit<Npc, 'name'>[] }>('npcs.json'),
    fetchJson<{ buffs: Omit<Buff, 'name'>[] }>('buffs.json'),
    fetchJson<{ commands: CommandDef[] }>('commands.json'),
    fetchJson<DatasetMeta>('meta.json'),
    fetchJson<Atlas>('items-atlas.json', ATLAS_JSON_FETCH),
    fetchJson<RecipesData>('recipes.json'),
    fetchJson<ItemStatsBaseData>('item-stats.json'),
    fetchJson<ItemTipsData>(`item-tips.${culture}.json`),
    fetchJson<ItemGroupsData>('item-groups.json'),
    fetchJson<ShimmerData>('shimmer.json'),
    fetchJson<PrefixModsData>('prefix-mods.json'),
    fetchJson<PrefixSetsData>('prefix-sets.json'),
    fetchJson<LocalizationBundle>(`loc.${culture}.json`),
    fetchJson<TileWallData>('tiles.json'),
    fetchJson<TileWallData>('walls.json'),
    fetchJson<ItemDropsData>('item-drops.json'),
  ])

  // 名字从官方本地化解析（不再落在 items.json / prefixes.json 里）。
  const itemName = loc.ItemName ?? {}
  const prefixName = loc.Prefix ?? {}
  const npcName = loc.NPCName ?? {}
  const buffName = loc.BuffName ?? {}
  const items: Item[] = itemsFile.items.map((it) => ({ ...it, name: itemName[it.key] ?? it.key }))
  const prefixes: Prefix[] = prefixesFile.prefixes.map((pf) => ({ ...pf, name: prefixName[pf.key] ?? pf.key }))
  // NPC / buff：没有本地化名的（如内部占位）保留内部名作为回退，不清空。
  const npcs: Npc[] = npcsFile.npcs.map((n) => ({ ...n, name: npcName[n.key] ?? n.key }))
  const buffs: Buff[] = buffsFile.buffs.map((b) => ({ ...b, name: buffName[b.key] ?? b.key }))

  // item-stats（语言无关）与 item-tips（当前语言）合并成前端单一模型。
  const itemStats: ItemStatsData = { meta: stats.meta, items: {} }
  for (const [id, entry] of Object.entries(stats.items)) {
    itemStats.items[id] = entry.stats ? { stats: entry.stats } : {}
  }
  for (const [id, tip] of Object.entries(tips.items)) {
    itemStats.items[id] = { ...(itemStats.items[id] ?? {}), tip }
  }

  // 微光转换：正向 + 反向索引
  const shimmerToById = new Map<number, number>()
  const shimmerFromById = new Map<number, number[]>()
  for (const [id, to] of Object.entries(shimmer.items)) {
    const from = Number(id)
    shimmerToById.set(from, to)
    const list = shimmerFromById.get(to)
    if (list) list.push(from)
    else shimmerFromById.set(to, [from])
  }

  const prefixModsById = new Map<number, (typeof prefixMods.mods)[string]>()
  for (const [id, mod] of Object.entries(prefixMods.mods)) prefixModsById.set(Number(id), mod)

  const rollablePrefixesById = new Map<number, number[]>()
  for (const [id, idx] of Object.entries(prefixSets.items)) {
    const set = prefixSets.sets[idx]
    if (set) rollablePrefixesById.set(Number(id), set)
  }

  const itemDropsById = new Map<number, ItemDropEntry[]>()
  for (const [id, list] of Object.entries(drops.items)) itemDropsById.set(Number(id), list)

  return withCommandMeta({
    meta,
    items,
    prefixes,
    commands: commandsFile.commands,
    npcs,
    /** `data/tiles.json`：图格 ID 表 */
    tiles,
    /** `data/walls.json`：墙 ID 表 */
    walls,
    /** tiles.id -> tile */
    tilesById: new Map(tiles.entries.map((t) => [t.id, t])),
    /** walls.id -> wall */
    wallsById: new Map(walls.entries.map((w) => [w.id, w])),
    buffs,
    atlas,
    recipes,
    itemStats,
    itemGroups: groups,
    shimmer,
    shimmerToById,
    shimmerFromById,
    prefixMods,
    prefixModsById,
    prefixSets,
    rollablePrefixesById,
    itemDrops: drops,
    itemDropsById,
    loc,
    itemsById: new Map(items.map((it) => [it.id, it])),
    prefixesById: new Map(prefixes.map((p) => [p.id, p])),
    npcsById: new Map(npcs.map((n) => [n.id, n])),
    buffsById: new Map(buffs.map((b) => [b.id, b])),
    commandsByToken: buildCommandIndex(commandsFile.commands),
  })
}

/**
 * 把信使插件返回的**运行时**指令目录（含插件指令）合并进数据集：
 * 只补充本地静态数据里没有的指令（本地数据有更完整的 paramSets），
 * 因此 `/fish`、`/pm` 等插件指令也能出现在补全里。
 * 返回新对象；没有新增时原样返回。
 */
export function withRuntimeCommands(base: Dataset, runtime: RuntimeCommand[]): Dataset {
  if (!runtime || runtime.length === 0) return base
  const existing = new Set(base.commandsByToken.keys())
  const added: CommandDef[] = []
  for (const c of runtime) {
    const name = (c.name ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (existing.has(key)) continue
    // 别名与本已存在的指令冲突时只丢掉该别名，不丢掉整条指令。
    const aliases = (c.aliases ?? []).filter((a) => a && !existing.has(a.toLowerCase()))
    added.push({
      name,
      aliases,
      permission: c.permissions?.[0] ?? null,
      help: c.help ?? '',
      allowServer: c.allowServer,
      doLog: c.doLog ?? true,
    })
    existing.add(key)
    for (const a of aliases) existing.add(a.toLowerCase())
  }
  if (added.length === 0) return base
  const commands = [...base.commands, ...added]
  return withCommandMeta({ ...base, commands, commandsByToken: buildCommandIndex(commands) })
}

/**
 * 数据版本与本地缓存不一致时清理物品相关缓存（设计原则与约束 §4.6）。
 * 返回 true 表示发生了清理。
 */
export function reconcileDataVersion(meta: DatasetMeta): boolean {
  const cached = readJson<{ schemaVersion?: number; gameVersion?: string }>(
    StorageKeys.meta,
    {},
  )
  const changed = Boolean(cached.gameVersion && cached.gameVersion !== meta.gameVersion)
  if (changed) {
    removeKey(StorageKeys.itemsRecent)
  }
  writeJson(StorageKeys.meta, { schemaVersion: 1, gameVersion: meta.gameVersion })
  return changed
}
