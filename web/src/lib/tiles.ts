/**
 * 图格显示名与「按名字找图格」。
 *
 * 名字口径**照抄游戏地图图例**（`Lang.BuildMapAtlas()` 的 `_mapLegendCache`）：
 * 1. `MapObject` 键（树 / 铁 / 罐子 / 门…）→ `loc.MapObject` 的本地化名；
 * 2. 否则看有没有「图例物品」（`data/tile-names.json` 的 `items`）→ 该物品的本地化名；
 * 3. 再否则用「代表物品」（`data/tiles.json` 的 `item`，能力上等价：游戏里放置它的物品）；
 * 4. 都没有才回退常量名（`Heart` / `Pots`…）。
 *
 * 这条链让「生命水晶」（图格 12，没有代表物品，但 `Lang.cs` 把它指到物品 29）能显示中文名。
 */
import type { Dataset, TileWallEntry } from '@/types'

/** 解析单个图格的显示名（`dataset.tileNameById` 就是按这个规则预先算好的）。 */
export function resolveTileName(
  tile: TileWallEntry | undefined,
  dataset: Pick<Dataset, 'tileNames' | 'loc' | 'itemsById'>,
): string {
  if (!tile) return ''
  const names = dataset.tileNames
  const objectKey = names?.objects?.[String(tile.id)]
  if (objectKey) {
    const localized = dataset.loc?.MapObject?.[objectKey]
    if (localized) return localized
  }
  const legendItem = names?.items?.[String(tile.id)]
  if (legendItem != null) {
    const item = dataset.itemsById.get(legendItem)
    if (item?.name) return item.name
  }
  if (tile.item != null) {
    const item = dataset.itemsById.get(tile.item)
    if (item?.name) return item.name
  }
  return tile.key
}

/** 查找候选：图格 / 墙 / 液体（`kind` 与 `lib/save/worldFind.ts` 的 `FindTargetKind` 一致）。 */
export interface TileSearchHit {
  kind: 'tile' | 'wall' | 'liquid'
  id: number
  /** 显示名（已本地化）。 */
  name: string
  /** 内部常量名（`Heart` / `Stone`…），用于搜英文；液体为 `water` 等。 */
  key: string
}

/** 液体种类（与世界存档里的 `liquid` 值一致）。 */
export const WORLD_LIQUIDS = [
  { id: 1, key: 'water', nameKey: 'wld.analysis.water' },
  { id: 2, key: 'lava', nameKey: 'wld.analysis.lava' },
  { id: 3, key: 'honey', nameKey: 'wld.analysis.honey' },
  { id: 4, key: 'shimmer', nameKey: 'wld.analysis.shimmer' },
] as const

/**
 * 按关键词搜图格：匹配**显示名 / 常量名 / id / 代表物品名**（大小写不敏感）。
 *
 * 只搜「能在世界里出现的图格」：`tiles.json` 里 id ≥ 0 且不是墙表。
 * 空关键词返回空（避免一次列出 754 条）。
 */
/** 图格候选（`kind` 固定为 `tile`；`searchTargets` 会给统一列表用）。 */
export type TileHitCandidate = Omit<TileSearchHit, 'kind'>

export function searchTiles(dataset: Dataset | null, query: string, limit = 30): TileHitCandidate[] {
  if (!dataset) return []
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: TileHitCandidate[] = []
  // 精确 id 优先（用户可能直接输 12）
  /** 统一用 dataset 预计算好的名字（与页面 / 地图分析 / 导出完全一致）。 */
  const nameOf = (id: number, fallback: () => string) =>
    dataset.tileNameById?.get(id) ?? fallback()

  if (/^\d+$/.test(q)) {
    const tile = dataset.tilesById.get(Number(q))
    if (tile) {
      hits.push({ id: tile.id, name: nameOf(tile.id, () => resolveTileName(tile, dataset)), key: tile.key })
    }
  }
  for (const tile of dataset.tiles.entries) {
    if (hits.length >= limit) break
    if (hits.some((h) => h.id === tile.id)) continue
    const name = nameOf(tile.id, () => resolveTileName(tile, dataset))
    const itemName = tile.item != null ? (dataset.itemsById.get(tile.item)?.name ?? '') : ''
    if (
      name.toLowerCase().includes(q) ||
      tile.key.toLowerCase().includes(q) ||
      itemName.toLowerCase().includes(q) ||
      String(tile.id) === q
    ) {
      hits.push({ id: tile.id, name, key: tile.key })
    }
  }
  return hits.slice(0, limit)
}

/** 墙的显示名：代表物品名 → 常量名（墙没有地图图例名）。 */
export function wallDisplayName(dataset: Dataset | null, id: number): string {
  const wall = dataset?.wallsById.get(id)
  if (!wall) return `#${id}`
  if (wall.item != null) {
    const item = dataset?.itemsById.get(wall.item)
    if (item?.name) return item.name
  }
  return wall.key
}

/**
 * 统一搜索：图格 + 墙 + 液体。
 *
 * - 图格：显示名 / 常量名 / id / 代表物品名（与 `searchTiles` 相同）；
 * - 墙：显示名 / 常量名 / id；
 * - 液体：只有 4 种（水 / 岩浆 / 蜂蜜 / 微光），按名字匹配。
 *
 * 顺序：液体 → 图格 → 墙（用户更常找的是图格，液体命中少所以放前面也不吵）。
 */
export function searchTargets(
  dataset: Dataset | null,
  query: string,
  t: (key: string) => string,
  limit = 12,
): TileSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: TileSearchHit[] = []

  for (const liquid of WORLD_LIQUIDS) {
    const name = t(liquid.nameKey)
    if (name.toLowerCase().includes(q) || liquid.key.includes(q)) {
      hits.push({ kind: 'liquid', id: liquid.id, name, key: liquid.key })
    }
  }

  for (const hit of searchTiles(dataset, query, limit)) {
    hits.push({ kind: 'tile', ...hit })
    if (hits.length >= limit) return hits.slice(0, limit)
  }

  if (dataset) {
    const q2 = q
    for (const wall of dataset.walls.entries) {
      if (hits.length >= limit) break
      const name = wallDisplayName(dataset, wall.id)
      if (name.toLowerCase().includes(q2) || wall.key.toLowerCase().includes(q2)) {
        hits.push({ kind: 'wall', id: wall.id, name, key: wall.key })
      }
    }
  }

  return hits.slice(0, limit)
}
