/**
 * 「查找图格」：在世界里定位某几种图格的坐标。
 *
 * 与缩略图共用同一套图格流解码规则（`worldThumb.ts` 里那一段的字段顺序），
 * 但**单独跑一趟**、只记录命中的 `(x, y)`：用户点「查找」时才扫描，不拖慢导入。
 *
 * 性能：一次解码 ≈ 大世界（8400×2400 = 2016 万格）0.15 秒量级（与渲染同量级）；
 * 命中过多（例如找「石块」400 万处）时**只保留前 `limit` 个坐标**，返回 `truncated` 让界面提示。
 */
import type { ParsedWorld } from './worldFile'

/** 命中坐标。 */
export interface TileHit {
  x: number
  y: number
}

/** 查找目标：图格 / 墙 / 液体（液体用 1 水 / 2 岩浆 / 3 蜂蜜 / 4 微光）。 */
export type FindTargetKind = 'tile' | 'wall' | 'liquid'

export interface FindTarget {
  kind: FindTargetKind
  id: number
}

/** 目标的稳定键（用于 `counts` 与 React key）：`tile:12` / `wall:1` / `liquid:1`。 */
export function targetKey(target: FindTarget): string {
  return `${target.kind}:${target.id}`
}

export interface FindTilesResult {
  /** 每个目标的命中数（真实总数，不受 `limit` 影响），键见 `targetKey`。 */
  counts: Map<string, number>
  /** 命中坐标（按扫描顺序，最多 `limit` 条）。 */
  hits: TileHit[]
  /** 命中数超过 `limit` 时为 true（坐标列表被截断）。 */
  truncated: boolean
}

export interface FindTilesOptions {
  /** 最多保留多少条坐标（默认 5000）。 */
  limit?: number
  /** 进度回调（0..1）。 */
  onProgress?: (ratio: number) => void
}

const DEFAULT_LIMIT = 5000

/**
 * 扫描世界，找出所有目标（图格 / 墙 / 液体）的坐标。
 *
 * 一趟解码同时判断三类目标；`targets` 为空时直接返回空结果（调用方不需要特判）。
 */
export async function findMatches(
  data: ArrayBuffer | Uint8Array,
  world: ParsedWorld,
  targets: readonly FindTarget[],
  opts: FindTilesOptions = {},
): Promise<FindTilesResult> {
  const counts = new Map<string, number>()
  const hits: TileHit[] = []
  if (targets.length === 0) return { counts, hits, truncated: false }

  const wantedTiles = new Set(targets.filter((t) => t.kind === 'tile').map((t) => t.id))
  const wantedWalls = new Set(targets.filter((t) => t.kind === 'wall').map((t) => t.id))
  const wantedLiquids = new Set(targets.filter((t) => t.kind === 'liquid').map((t) => t.id))


  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT)
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  const { width: w, height: h, release } = world.info
  const frameImportant = world.frameImportant

  let p = world.tilesAt
  let truncated = false

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (p >= buf.length) throw new Error('图格数据不完整（解析到中途结束）')
      // ---- 字段顺序与 worldThumb.ts 的解码一致（1.4.5.8）----
      const h1 = buf[p++]
      let h3 = 0
      if (h1 & 0x01) {
        const h2 = buf[p++]
        if (h2 & 0x01) {
          h3 = buf[p++]
          if (release >= 269 && h3 & 0x01) p++ // header4
        }
      }

      let tileType = -1
      if (h1 & 0x02) {
        if ((h1 & 0x20) === 0) {
          tileType = buf[p++]
        } else {
          const lo = buf[p++]
          const hi = buf[p++]
          tileType = (hi << 8) | lo
        }
        if (tileType >= frameImportant.length || frameImportant[tileType]) p += 4 // frameX / frameY
        if (h3 & 0x08) p++ // 图格染料
      }

      let wall = 0
      if (h1 & 0x04) {
        wall = buf[p++]
        if (h3 & 0x10) p++ // 墙染料
      }

      let liquid = 0
      const liquidKind = (h1 & 0x18) >> 3
      if (liquidKind !== 0) {
        p++ // 液体量
        liquid = liquidKind
        if (release >= 269 && h3 & 0x80) liquid = 4 // 微光
      }

      if (h3 >= 2 && release >= 222 && h3 & 0x40) p++ // 墙 ID 高字节

      let rle = 0
      const rleKind = (h1 & 192) >> 6
      if (rleKind === 1) {
        rle = buf[p++]
      } else if (rleKind >= 2) {
        rle = (buf[p] | (buf[p + 1] << 8)) << 16 >> 16
        p += 2
      }

      // 一趟判断三类目标：图格 id / 墙 id / 液体种类（RLE 覆盖的每一格都计入）。
      const cells = Math.min(rle + 1, h - y)
      const matchedKeys: string[] = []
      if (tileType >= 0 && wantedTiles.has(tileType)) matchedKeys.push(`tile:${tileType}`)
      if (wall > 0 && wantedWalls.has(wall)) matchedKeys.push(`wall:${wall}`)
      if (liquid > 0 && wantedLiquids.has(liquid)) matchedKeys.push(`liquid:${liquid}`)
      for (const key of matchedKeys) counts.set(key, (counts.get(key) ?? 0) + cells)
      if (matchedKeys.length > 0) {
        if (hits.length < limit) {
          // 一条 RLE 是「同列向下重复」：逐个展开成坐标，但只到 limit 为止。
          for (let k = 0; k < cells && hits.length < limit; k++) {
            hits.push({ x, y: y + k })
          }
        } else {
          truncated = true
        }
      }

      y += rle
    }

    // 每 128 列让出一次主线程（大世界约 66 次），保证进度条能刷新。
    if ((x + 1) % 128 === 0) {
      opts.onProgress?.((x + 1) / w)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  opts.onProgress?.(1)

  return { counts, hits, truncated }
}
