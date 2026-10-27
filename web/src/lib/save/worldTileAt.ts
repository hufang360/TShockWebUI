/**
 * 「这一格是什么」：从某列列首解码到目标行，取图格 / 墙 / 液体。
 *
 * 为什么不是重扫世界：`renderWorldThumbnail` 打开 `recordColumnOffsets` 后，会记下**每列的字节偏移**
 * （`world.width + 1` 个 int32）。悬停时从 `columnOffsets[x]` 开始按 RLE 往下走到 `y` 即可，
 * 最多解 `height` 个条目（大世界 2400 个），开销可以忽略。
 *
 * 字段顺序必须与 `worldThumb.ts` / `worldFind.ts` 完全一致（三处同一份规范，见 `docs/技术事实.md`）。
 */
import type { ParsedWorld } from './worldFile'

/** 一格的解码结果（`tile < 0` = 空气；`wall = 0` / `liquid = 0` = 没有）。 */
export interface TileAtResult {
  tile: number
  wall: number
  /** 1 水 / 2 岩浆 / 3 蜂蜜 / 4 微光。 */
  liquid: number
  /** 液体量 0–255（渲染取色用阈值，统计不看它）。 */
  liquidAmount: number
}

/**
 * 取 `(x, y)` 这一格的内容。
 *
 * @param columnOffsets `renderWorldThumbnail(..., { recordColumnOffsets: true })` 给出的列偏移表
 * @returns 坐标越界或数据不完整时 `null`（界面据此不显示提示）
 */
export function tileAt(
  data: ArrayBuffer | Uint8Array,
  world: ParsedWorld,
  columnOffsets: Int32Array,
  x: number,
  y: number,
): TileAtResult | null {
  const { width: w, height: h, release } = world.info
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  if (x < 0 || y < 0 || x >= w || y >= h) return null
  if (columnOffsets.length < w + 1) return null
  const frameImportant = world.frameImportant
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)

  let p = columnOffsets[x]
  const end = columnOffsets[x + 1] ?? buf.length
  let row = 0
  while (row < h && p < end && p < buf.length) {
    const h1 = buf[p++]
    let h3 = 0
    if (h1 & 0x01) {
      const h2 = buf[p++]
      if (h2 & 0x01) {
        h3 = buf[p++]
        if (release >= 269 && h3 & 0x01) p++ // header4
      }
    }

    let tile = -1
    if (h1 & 0x02) {
      if ((h1 & 0x20) === 0) {
        tile = buf[p++]
      } else {
        const lo = buf[p++]
        const hi = buf[p++]
        tile = (hi << 8) | lo
      }
      if (tile >= frameImportant.length || frameImportant[tile]) p += 4 // frameX / frameY
      if (h3 & 0x08) p++ // 图格染料
    }

    let wall = 0
    if (h1 & 0x04) {
      wall = buf[p++]
      if (h3 & 0x10) p++ // 墙染料
    }

    let liquid = 0
    let liquidAmount = 0
    const liquidKind = (h1 & 0x18) >> 3
    if (liquidKind !== 0) {
      liquidAmount = buf[p++]
      liquid = liquidKind
      if (release >= 269 && h3 & 0x80) liquid = 4 // 微光
    }

    if (h3 >= 2 && release >= 222 && h3 & 0x40) p++ // 墙 ID 高字节

    let rle = 0
    const rleKind = (h1 & 192) >> 6
    if (rleKind === 1) {
      rle = buf[p++]
    } else if (rleKind >= 2) {
      rle = ((buf[p] | (buf[p + 1] << 8)) << 16) >> 16
      p += 2
    }

    // 这一条 RLE 覆盖 `row … row + rle`（同列向下重复）。
    if (y <= row + rle) return { tile, wall, liquid, liquidAmount }
    row += rle + 1
  }
  return null
}
