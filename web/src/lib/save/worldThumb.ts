/**
 * 世界缩略图渲染（纯前端）：把 `.wld` 的图格段按块降采样成一张位图。
 *
 * 采样规则与 TEdit 的小地图一致：世界按 `res` 图格一块分块，
 * 每块取「优先级最高」的颜色 —— **图格 > 液体（≥64/255）> 墙 > 深度背景**。
 * 图格流是 RLE（同列向下重复），所以必须按 `for x { for y }` 顺序解。
 *
 * **清晰度**：`res` 由「像素预算」决定而不是固定宽度 ——
 * 只要缩放比允许，默认就按 **1 图格 = 1 像素**渲染（小 / 中世界），
 * 大世界（8400×2400）受 8M 像素预算限制落到 **2 图格/像素**（4200×1200）。
 * 这样屏幕上是「原图缩小」，导出图片也能放大看清方块，而不是一张糊掉的小图。
 *
 * 事实来源见 `docs/技术事实.md`「世界文件（.wld）」；颜色表在
 * `worldColors.generated.ts`（由 `tools/gen-world-colors.mjs` 生成）。
 */
import type { ParsedWorld } from './worldFile'
import { TILE_COLORS, WALL_COLORS, ZONE_COLORS } from './worldColors.generated'

/** 分层键：地表 / 地下 / 洞穴 / 地狱（按存储的世界分层，不是生物群系）。 */
export type WorldZoneKey = 'surface' | 'underground' | 'cavern' | 'underworld'

/** 一层的统计。 */
export interface WorldZoneStats {
  key: WorldZoneKey
  /** 该层的格数（含空气）。 */
  total: number
  air: number
  tiles: Map<number, number>
  liquid: { water: number; lava: number; honey: number; shimmer: number }
}

/** 图格 / 墙体 / 液体统计（一次解码顺手累加，不额外遍历 2000 万格）。 */
export interface WorldTileStats {
  /** 图格 id → 出现的格数（不含空气）。 */
  tiles: Map<number, number>
  /** 墙 id → 出现的格数。 */
  walls: Map<number, number>
  /** 没有图格（含只有墙 / 只有液体）的格数。 */
  air: number
  liquid: { water: number; lava: number; honey: number; shimmer: number }
  /** 总格数 = 宽 × 高。 */
  total: number
  /** 分层统计（地表 / 地下 / 洞穴 / 地狱），顺序固定。 */
  zones: WorldZoneStats[]
  /** 各层的 y 边界（`[地表起, 地下起, 洞穴起, 地狱起]`，单位：图格行）。 */
  zoneBounds: number[]
}

/**
 * 分层边界（图格行）：`[地表起=0, 地下起, 洞穴起, 地狱起]`。
 *
 * - 地下起 = `worldSurface`（`info.groundLevel`）；
 * - 洞穴起 = `rockLayer`（`info.rockLevel`）；
 * - 地狱起 = `height - 200`（游戏常量：`Main.maxTilesY - 200` 起是地狱）。
 *
 * 三个值都夹在 `[0, height]` 内并保证单调，避免异常存档导致分层错乱。
 */
function zoneBoundsOf(info: ParsedWorld['info'], height: number): number[] {
  const clamp = (v: number) => Math.max(0, Math.min(height, Math.floor(v)))
  const underground = clamp(info.groundLevel)
  const cavern = Math.max(underground, clamp(info.rockLevel))
  const underworld = Math.max(cavern, clamp(height - 200))
  return [0, underground, cavern, underworld]
}

/** 渲染结果：RGBA 像素（可直接 `putImageData`，也可用 canvas 编码成 PNG）+ 统计。 */
export interface WorldThumb {
  width: number
  height: number
  /** 显式标成 `ArrayBuffer`：`ImageData` 只吃非共享缓冲。 */
  pixels: Uint8ClampedArray<ArrayBuffer>
  /** 图格 / 墙 / 液体统计（与位图同一次解码得到，供「地图分析」用）。 */
  stats: WorldTileStats
  /**
   * 每列在图格流里的起始字节偏移（长度 `world.width + 1`，最后一项是流结束位置）。
   *
   * 只在 `recordColumnOffsets` 打开时给出（成本：`width` 个 int32，8400 列 ≈ 34 KB）。
   * 用途：悬停某格时从**该列列首**解码到目标行（最多 2400 格），不必重扫整张世界。
   */
  columnOffsets?: Int32Array
}

export interface ThumbOptions {
  /**
   * 输出像素总量上限（默认 8M）：超过就提高 `res`（每块覆盖更多图格）。
   * 8M ≈ 4200×1200，兼顾清晰度与内存（位图 32 MB）、并避开 iOS 的画布面积上限。
   */
  maxPixels?: number
  /** 输出单边上限（默认 8192，纯保险）。 */
  maxSide?: number
  /** 进度回调（0..1），用于页面显示「正在渲染…」的进度。 */
  onProgress?: (ratio: number) => void
  /** 每处理多少列让出一次主线程（默认 128；测试里可设很大以同步跑完）。 */
  yieldEvery?: number
  /** 记录每列的图格流起始偏移（供「悬停看这一格是什么」用，见 `worldTileAt.ts`）。 */
  recordColumnOffsets?: boolean
  /**
   * 强制指定 `res`（每像素覆盖多少图格）。传 `1` 就是**1 图格 = 1 像素**的高清图，
   * 忽略 `maxPixels` / `maxSide` 的自动降级 —— 调用方要自己确认内存（大世界 ≈ 20M px ≈ 160 MB）。
   */
  res?: number
}

/** 默认像素预算：8M（≈4200×1200）。 */
export const DEFAULT_MAX_THUMB_PIXELS = 8_000_000
const DEFAULT_MAX_SIDE = 8192

// 液体颜色（TEdit `docs/settings.xml` 的 GlobalColors Lava / Water / Honey / Shimmer）。
const LIQUID_WATER = 0x000cff
const LIQUID_LAVA = 0xff1e00
const LIQUID_HONEY = 0xffac00
const LIQUID_SHIMMER = 0x9b70e9
/** 颜色表里没有的图格 / 墙（1.4.5 新增的几个）的兜底色。 */
const UNKNOWN_COLOR = 0x808080

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function tileColor(id: number): number {
  return id >= 0 && id < TILE_COLORS.length && TILE_COLORS[id] !== 0 ? TILE_COLORS[id] : UNKNOWN_COLOR
}

/**
 * 墙 ID → 颜色；0 表示「不画这一层」。
 *
 * 颜色表里没有颜色的墙（玻璃 / 各种栅栏 / 回响墙 / 彩纸墙…）本来就是**透明**的：
 * 按灰色实心画会把玻璃房画成石头房，所以这里返回 0 让调用方跳过（相当于只有背景）。
 * 表外的 ID（模组墙）同样跳过。
 */
function wallColor(id: number): number {
  return id > 0 && id < WALL_COLORS.length ? WALL_COLORS[id] : 0
}

function liquidColor(kind: number): number {
  switch (kind) {
    case 2:
      return LIQUID_LAVA
    case 3:
      return LIQUID_HONEY
    case 4:
      return LIQUID_SHIMMER
    default:
      return LIQUID_WATER
  }
}

/** 深度分区背景色：`y < 80` 太空 / 最下 192 行地狱 / 岩石层以下 / 地表以下 / 天空。 */
function zoneColor(world: ParsedWorld['info'], y: number): number {
  if (y < 80) return ZONE_COLORS.space
  if (y > world.height - 192) return ZONE_COLORS.hell
  if (y > world.rockLevel) return ZONE_COLORS.rock
  if (y > world.groundLevel) return ZONE_COLORS.earth
  return ZONE_COLORS.sky
}

/**
 * 渲染世界缩略图。
 *
 * @param data 原始 `.wld` 字节（与 `parseWorld` 用的是同一份）
 * @param world `parseWorld` 的结果
 */
export async function renderWorldThumbnail(
  data: ArrayBuffer | Uint8Array,
  world: ParsedWorld,
  opts: ThumbOptions = {},
): Promise<WorldThumb> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  const { width: w, height: h, release } = world.info
  const frameImportant = world.frameImportant

  const maxPixels = opts.maxPixels && opts.maxPixels > 0 ? opts.maxPixels : DEFAULT_MAX_THUMB_PIXELS
  const maxSide = opts.maxSide && opts.maxSide > 0 ? opts.maxSide : DEFAULT_MAX_SIDE
  const res =
    opts.res != null && opts.res >= 1
      ? Math.floor(opts.res)
      : Math.max(
          1,
          Math.ceil(Math.sqrt((w * h) / maxPixels)), // 面积预算
          Math.ceil(w / maxSide),
          Math.ceil(h / maxSide),
        )
  const tw = Math.ceil(w / res)
  const th = Math.ceil(h / res)

  const colors = new Uint32Array(tw * th)
  const prior = new Uint8Array(tw * th) // 0 未定 / 1 墙 / 2 液体 / 3 图格

  // 先铺深度背景色（按行所在分区）。
  for (let py = 0; py < th; py++) {
    const bg = zoneColor(world.info, py * res)
    colors.fill(bg, py * tw, py * tw + tw)
  }

  // 顺路统计（与位图同一次解码）：图格 / 墙 / 液体格数 + 分层。
  const zoneBounds = zoneBoundsOf(world.info, h)
  const newZone = (key: WorldZoneKey): WorldZoneStats => ({
    key,
    total: 0,
    air: 0,
    tiles: new Map(),
    liquid: { water: 0, lava: 0, honey: 0, shimmer: 0 },
  })
  const stats: WorldTileStats = {
    tiles: new Map(),
    walls: new Map(),
    air: 0,
    liquid: { water: 0, lava: 0, honey: 0, shimmer: 0 },
    total: w * h,
    zoneBounds,
    zones: (['surface', 'underground', 'cavern', 'underworld'] as WorldZoneKey[]).map(newZone),
  }
  /** y 落在第几层（0 地表 / 1 地下 / 2 洞穴 / 3 地狱）。 */
  const zoneAt = (y: number): number => {
    if (y >= zoneBounds[3]) return 3
    if (y >= zoneBounds[2]) return 2
    if (y >= zoneBounds[1]) return 1
    return 0
  }

  let p = world.tilesAt
  const yieldEvery = opts.yieldEvery ?? 128
  const columnOffsets = opts.recordColumnOffsets ? new Int32Array(w + 1) : undefined

  for (let x = 0; x < w; x++) {
    if (columnOffsets) columnOffsets[x] = p
    const px = (x / res) | 0
    for (let y = 0; y < h; y++) {
      // ---- 解一个图格（内联，避免每格创建对象：大世界 2000 万格）----
      if (p >= buf.length) throw new Error('图格数据不完整（解析到中途结束）')
      const h1 = buf[p++]
      let h2 = 0
      let h3 = 0
      if (h1 & 0x01) {
        h2 = buf[p++]
        if (h2 & 0x01) {
          h3 = buf[p++]
          if (release >= 269 && h3 & 0x01) p++ // header4：隐形 / 满亮度
        }
      }

      let tileType = -1
      let wall = 0
      let liquid = 0
      let liquidAmt = 0

      if (h1 & 0x02) {
        if ((h1 & 0x20) === 0) {
          tileType = buf[p++]
        } else {
          const lo = buf[p++]
          const hi = buf[p++]
          tileType = (hi << 8) | lo
        }
        // frame-important 的图格带 U、V 各 int16。
        if (tileType >= frameImportant.length || frameImportant[tileType]) p += 4
        if (h3 & 0x08) p++ // 图格染料
      }

      if (h1 & 0x04) {
        wall = buf[p++]
        if (h3 & 0x10) p++ // 墙染料
      }

      const liquidKind = (h1 & 0x18) >> 3
      if (liquidKind !== 0) {
        liquidAmt = buf[p++]
        liquid = liquidKind
        if (release >= 269 && h3 & 0x80) liquid = 4 // 微光
      }

      // 墙 ID 高字节（1.4.0 起支持 > 255 的墙 ID）。
      if (h3 >= 2 && release >= 222 && h3 & 0x40) p++

      let rle = 0
      const rleKind = (h1 & 192) >> 6
      if (rleKind === 1) {
        rle = buf[p++]
      } else if (rleKind >= 2) {
        rle = (buf[p] | (buf[p + 1] << 8)) << 16 >> 16 // little-endian int16（有符号）
        p += 2
      }

      // ---- 统计（RLE 重复的每一格都算；末尾超出世界高度的部分不算）----
      const cells = Math.min(rle + 1, h - y)
      if (tileType >= 0) stats.tiles.set(tileType, (stats.tiles.get(tileType) ?? 0) + cells)
      else stats.air += cells
      if (wall > 0) stats.walls.set(wall, (stats.walls.get(wall) ?? 0) + cells)
      if (liquid === 1) stats.liquid.water += cells
      else if (liquid === 2) stats.liquid.lava += cells
      else if (liquid === 3) stats.liquid.honey += cells
      else if (liquid === 4) stats.liquid.shimmer += cells

      // 分层累加：一条 RLE 可能跨过层边界，按边界切开分别计入。
      let zy = y
      let left = cells
      let zi = zoneAt(y)
      while (left > 0 && zi < stats.zones.length) {
        const zoneEnd = zi === stats.zones.length - 1 ? h : zoneBounds[zi + 1]
        const zoneLen = zoneEnd - zy
        // 空层（边界重合，如「洞穴起 == 地狱起」）直接跳过，不能强塞 1 格。
        if (zoneLen <= 0) {
          zi++
          continue
        }
        const take = Math.min(left, zoneLen)
        const zone = stats.zones[zi]
        zone.total += take
        if (tileType >= 0) zone.tiles.set(tileType, (zone.tiles.get(tileType) ?? 0) + take)
        else zone.air += take
        if (liquid === 1) zone.liquid.water += take
        else if (liquid === 2) zone.liquid.lava += take
        else if (liquid === 3) zone.liquid.honey += take
        else if (liquid === 4) zone.liquid.shimmer += take
        zy += take
        left -= take
        zi++
      }

      // ---- 写入像素（按优先级，同优先级先出现者胜出）----
      let color = 0
      let prio = 0
      if (tileType >= 0) {
        prio = 3
        color = tileColor(tileType)
      } else if (liquid > 0 && liquidAmt >= 64) {
        prio = 2
        color = liquidColor(liquid)
      } else if (wall > 0) {
        // 透明墙（玻璃 / 栅栏…）返回 0：不画，保留深度背景。
        const wallC = wallColor(wall)
        if (wallC !== 0) {
          prio = 1
          color = wallC
        }
      }
      if (prio > 0) {
        for (let k = 0; k <= rle; k++) {
          const yy = y + k
          if (yy >= h) break
          const idx = ((yy / res) | 0) * tw + px
          if (prio > prior[idx]) {
            colors[idx] = color
            prior[idx] = prio
          }
        }
      }
      y += rle
    }

    if ((x + 1) % yieldEvery === 0) {
      opts.onProgress?.((x + 1) / w)
      await yieldToUi()
    }
  }
  opts.onProgress?.(1)

  // 0xRRGGBB → RGBA
  const pixels = new Uint8ClampedArray(tw * th * 4)
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i]
    pixels[i * 4] = (c >> 16) & 0xff
    pixels[i * 4 + 1] = (c >> 8) & 0xff
    pixels[i * 4 + 2] = c & 0xff
    pixels[i * 4 + 3] = 255
  }
  if (columnOffsets) columnOffsets[w] = p
  return { width: tw, height: th, pixels, stats, ...(columnOffsets ? { columnOffsets } : {}) }
}
