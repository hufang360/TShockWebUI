/**
 * `.wld` 图格替换（W3 的**安全子集**）：把世界里所有 `from` 图格换成 `to`。
 *
 * 为什么只做"全部替换"而不是"点某一格改"：
 * 图格段是 RLE（同列向下重复），改**单个**格子通常要把一条 RLE 拆成多条，段长度就变了，
 * 于是要重压整段、平移后续段、重写指针表与 footer —— 那是唯一能造成"世界打不开"的操作。
 * 而"把世界里所有 A 换成 B"**不改变任何 RLE 的分组**（一条 run 本来就只有一种图格），
 * 只改 run 里的 id 字节，**文件长度、段指针、footer 全部不变**，风险最低。
 *
 * 为了连"长度"都不变，还要求：
 * 1. `from` / `to` 的 **id 字节宽度相同**（都 < 256 用 1 字节、都 ≥ 256 用 2 字节），
 *    否则条目会变长/变短；宽度不同属于"要重压"的情况，这里直接拒绝。
 * 2. `from` / `to` 的 **`frameImportant` 相同**（都带 4 字节 frame 或都不带），
 *    否则条目长度也会变；并且换 id 时**保留原 frame 数据**（计划 §3 的 C 级约定）。
 * 3. 不允许换成"空气"（`to < 0`）：清空图格要重算 header 位，属于重压范围。
 *
 * 已知限制（故意不处理，写进 UI 提示）：同为 frame-important 但**形状不同**的两个图格
 * （例如 2×2 的箱子 ↔ 3×2 的箱子）换 id 后 frame 仍是旧的，游戏里可能显示错位/变成"坏帧"。
 */
import type { ParsedWorld } from './worldFile'

/** 替换前的守卫结果：`null` = 允许替换。 */
export interface TileReplaceProblem {
  code: 'same' | 'invalid' | 'air' | 'widthMismatch' | 'frameMismatch'
  /** 给界面直接用的一句话（中文；界面再决定是否翻译）。 */
  message: string
}

/** 判断 id 在文件里是否用 2 字节存（`header1` 的 bit5 = 1 表示 2 字节）。 */
const needsWideId = (id: number): boolean => id >= 256

/**
 * 检查「把 `from` 换成 `to`」是否落在安全子集里。
 *
 * @param validIds 可选：合法图格 id 集合（来自 `data/tiles.json`），给了就顺带校验 id 存在
 */
export function checkTileReplace(
  world: ParsedWorld,
  from: number,
  to: number,
  validIds?: ReadonlySet<number>,
): TileReplaceProblem | null {
  if (from === to) return { code: 'same', message: '前后是同一种图格' }
  if (to < 0) return { code: 'air', message: '不能替换成空气（那要重算图格头，属于重压范围）' }
  if (from < 0) return { code: 'invalid', message: '源图格不能是空气' }
  if (validIds && (!validIds.has(from) || !validIds.has(to))) {
    return { code: 'invalid', message: '图格 id 不存在' }
  }
  if (needsWideId(from) !== needsWideId(to)) {
    return {
      code: 'widthMismatch',
      message: '这两个图格的 id 字节宽度不同（一个 <256、一个 ≥256），替换会改变文件长度，不做',
    }
  }
  const frameImportant = world.frameImportant
  const fromFramed = from >= frameImportant.length || frameImportant[from] === true
  const toFramed = to >= frameImportant.length || frameImportant[to] === true
  if (fromFramed !== toFramed) {
    return {
      code: 'frameMismatch',
      message: '一个有 frame 数据、一个没有（例如方块 ↔ 家具），替换会改变文件长度，不做',
    }
  }
  return null
}

/** 替换结果：新字节（长度与入参相同）、替换了多少格、动了多少条 RLE 条目。 */
export interface TileReplaceResult {
  bytes: Uint8Array
  /** 被替换的**格子数**（RLE 覆盖的每一格都算）。 */
  replacedCells: number
  /** 实际改写的字节数（1 字节 id → 1，2 字节 id → 2）。 */
  changedBytes: number
}

/**
 * 把所有 `from` 图格换成 `to`（**不改文件长度**）。
 *
 * 调用前必须先用 `checkTileReplace` 通过；这里再校验一次（防误用）。
 */
export function replaceTileType(
  data: ArrayBuffer | Uint8Array,
  world: ParsedWorld,
  from: number,
  to: number,
): TileReplaceResult {
  const problem = checkTileReplace(world, from, to)
  if (problem) throw new Error(problem.message)

  const source = data instanceof Uint8Array ? data : new Uint8Array(data)
  const out = source.slice()
  const { width: w, height: h, release } = world.info
  const frameImportant = world.frameImportant
  const wide = needsWideId(to)

  let p = world.tilesAt
  let replacedCells = 0
  let changedBytes = 0

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      // ---- 字段顺序与 worldThumb.ts / worldFind.ts / worldTileAt.ts 一致（1.4.5.8）----
      const h1 = out[p++]
      let h3 = 0
      if (h1 & 0x01) {
        const h2 = out[p++]
        if (h2 & 0x01) {
          h3 = out[p++]
          if (release >= 269 && h3 & 0x01) p++ // header4
        }
      }

      let typeAt = -1
      let tileType = -1
      if (h1 & 0x02) {
        if ((h1 & 0x20) === 0) {
          typeAt = p
          tileType = out[p++]
        } else {
          typeAt = p
          const lo = out[p++]
          const hi = out[p++]
          tileType = (hi << 8) | lo
        }
        if (tileType >= frameImportant.length || frameImportant[tileType]) p += 4 // frameX / frameY
        if (h3 & 0x08) p++ // 图格染料
      }

      if (h1 & 0x04) {
        p++ // 墙
        if (h3 & 0x10) p++ // 墙染料
      }
      const liquidKind = (h1 & 0x18) >> 3
      if (liquidKind !== 0) p++ // 液体量
      if (h3 >= 2 && release >= 222 && h3 & 0x40) p++ // 墙 id 高字节

      let rle = 0
      const rleKind = (h1 & 192) >> 6
      if (rleKind === 1) {
        rle = out[p++]
      } else if (rleKind >= 2) {
        rle = ((out[p] | (out[p + 1] << 8)) << 16) >> 16
        p += 2
      }

      if (tileType === from && typeAt >= 0) {
        if (wide) {
          out[typeAt] = to & 0xff
          out[typeAt + 1] = (to >> 8) & 0xff
          changedBytes += 2
        } else {
          out[typeAt] = to & 0xff
          changedBytes += 1
        }
        // RLE 覆盖的每一格都算（末尾超出世界高度的部分不算）
        replacedCells += Math.min(rle + 1, h - y)
      }

      y += rle
    }
  }

  return { bytes: out, replacedCells, changedBytes }
}
