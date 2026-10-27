/**
 * `.wld` 写回：**头部字段就地改 / 世界名·种子重排段指针**。
 *
 * 与 `.plr` 的差别（见 `docs/计划-wld编辑.md` §2）：
 * - `.wld` 没有加密，直接改字节；
 * - 但头部段里有两个**变长字符串**（世界名、种子），长度一变，后面所有段都要平移，
 *   而且文件头的**段指针表**（记录每段结束位置）必须跟着重写；
 * - **footer 里重复存了世界名 + worldId**，加载时逐字节比较，改了名字不跟着改 → 游戏报 `BadFooter` 打不开世界。
 *
 * 策略：
 * 1. 只改定长字段 → 就地打补丁（段不动、指针不动、footer 不动、`Revision` 也不动）；
 * 2. 要改名字 / 种子 → 重建头部段（拼接字符串）→ 平移后续段 → 重写指针表 → 重写 footer → `Revision++`。
 */
import type { WorldTrack } from './worldFile'
import { encodeChestsSection, encodeSignsSection, type ChestWrite, type SignWrite } from './worldSections'

/** 用户要做的一组世界改动（只放要改的字段）。 */
export interface WorldEdits {
  name?: string
  seed?: string
  gameMode?: number
  spawn?: { x: number; y: number }
  /** 当日时间（0–54000，4:30 起算）。 */
  time?: number
  dayTime?: boolean
  /** 月相 0–8。 */
  moonPhase?: number
  bloodMoon?: boolean
  eclipse?: boolean
  hardmode?: boolean
  /** Boss / 事件位（键与 `WorldInfo.bossesDowned` 一致）。 */
  bosses?: Record<string, boolean>
  /** 箱子段（完整列表，数量不变）：只改名字 / 内容。长度可能变化 → 会重排段指针。 */
  chests?: ChestWrite[]
  /** 招牌段（完整列表，数量不变）：只改文本。长度可能变化 → 会重排段指针。 */
  signs?: SignWrite[]
}

/** .NET `BinaryWriter.Write(string)`：7 位变长长度 + UTF-8。 */
export function encodeDotNetString(value: string): Uint8Array {
  const utf8 = new TextEncoder().encode(value)
  const prefix: number[] = []
  let n = utf8.length
  for (;;) {
    const b = n & 0x7f
    n >>= 7
    if (n > 0) prefix.push(b | 0x80)
    else {
      prefix.push(b)
      break
    }
  }
  const out = new Uint8Array(prefix.length + utf8.length)
  out.set(prefix, 0)
  out.set(utf8, prefix.length)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * 应用世界改动，返回**新的** `.wld` 字节（不改入参）。
 *
 * `track` 必须来自同一份字节的 `parseWorld(data, track)`；缺偏移直接抛错，绝不猜位置。
 */
export function applyWorldEdits(
  data: ArrayBuffer | Uint8Array,
  track: WorldTrack,
  edits: WorldEdits,
): Uint8Array {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data)
  const need = (pos: number | undefined, name: string): number => {
    if (pos == null) throw new Error(`${name}：这份存档没有这个字段，无法编辑`)
    return pos
  }

  /** 在给定字节上就地改定长字段（偏移都是**绝对**偏移，所以只对整份文件副本用）。 */
  const patchFixed = (target: Uint8Array) => {
    const dv = view(target)
    if (edits.gameMode != null) {
      const pos = need(track.gameMode, '难度')
      if (track.gameModeIsInt === false) target[pos] = edits.gameMode ? 1 : 0
      else dv.setInt32(pos, edits.gameMode, true)
    }
    if (edits.spawn) {
      const pos = need(track.spawn, '出生点')
      dv.setInt32(pos, edits.spawn.x, true)
      dv.setInt32(pos + 4, edits.spawn.y, true)
    }
    if (edits.time != null) dv.setFloat64(need(track.time, '时间'), edits.time, true)
    if (edits.dayTime != null) target[need(track.dayTime, '白天/夜晚')] = edits.dayTime ? 1 : 0
    if (edits.moonPhase != null) dv.setInt32(need(track.moonPhase, '月相'), edits.moonPhase, true)
    if (edits.bloodMoon != null) target[need(track.bloodMoon, '血月')] = edits.bloodMoon ? 1 : 0
    if (edits.eclipse != null) target[need(track.eclipse, '日食')] = edits.eclipse ? 1 : 0
    if (edits.hardmode != null) target[need(track.hardmode, '困难模式')] = edits.hardmode ? 1 : 0
    for (const [key, on] of Object.entries(edits.bosses ?? {})) {
      target[need(track.bosses[key], key)] = on ? 1 : 0
    }
  }

  const rename = edits.name != null
  const reseed = edits.seed != null
  const rewriteChests = edits.chests != null
  const rewriteSigns = edits.signs != null

  // ---- 情况 1：不动任何变长字段 → 就地补丁，结构完全不变 ----
  if (!rename && !reseed && !rewriteChests && !rewriteSigns) {
    const out = src.slice()
    patchFixed(out)
    return out
  }

  // ---- 情况 2：有变长字段要改（名字 / 种子 / 箱子段 / 招牌段）→ 按段重建 + 重排指针 ----
  if (reseed && !track.seed) {
    throw new Error('种子：这份存档的种子不是字符串（release 179 存的是整数），无法编辑')
  }
  // footer 起点必须可用：拿不到就直接报错，绝不用 0 / 长度去"猜"（猜错就是截断毁档）。
  if (!(track.footerAt > track.headerEnd && track.footerAt <= src.length)) {
    throw new Error('段指针异常：定位不到文件尾（footer），已停止改写')
  }

  // 先在完整副本上改定长字段（偏移都是绝对偏移，所以只对整份文件副本用）。
  const staged = src.slice()
  patchFixed(staged)

  /**
   * 按「段」拼装：第 i 段 = `[pointers[i-1], pointers[i])`，第 0 段从 0 开始。
   * 这样头部（第 1 段）、箱子（第 3 段）、招牌（第 4 段）谁变长都只需要替换对应的那一块，
   * 其余段原样拷贝，最后按新长度前缀和重算指针表即可。
   */
  const sectionSpan = (index: number): { from: number; to: number } => {
    const from = index === 0 ? 0 : (track.pointers[index - 1] ?? 0)
    const to = track.pointers[index] ?? track.footerAt
    return { from, to }
  }

  /** 重建后的段（按段下标）；没重建的段直接拷贝原字节。 */
  const replaced = new Map<number, Uint8Array>()

  // 第 1 段：头部（世界名 / 种子）
  if (rename || reseed) {
    let header: Uint8Array = staged.slice(track.headerAt, track.headerEnd)
    const replacements: { span: { pos: number; size: number }; bytes: Uint8Array }[] = []
    if (edits.name != null) replacements.push({ span: track.name, bytes: encodeDotNetString(edits.name) })
    if (edits.seed != null && track.seed) {
      replacements.push({ span: track.seed, bytes: encodeDotNetString(edits.seed) })
    }
    // 从后往前替换，前面的绝对偏移才不会失效。
    for (const rep of replacements.sort((a, b) => b.span.pos - a.span.pos)) {
      const at = rep.span.pos - track.headerAt
      header = concat([header.subarray(0, at), rep.bytes, header.subarray(at + rep.span.size)])
    }
    replaced.set(1, header)
  }

  // 第 3 段：箱子；第 4 段：招牌
  if (edits.chests) replaced.set(3, encodeChestsSection(edits.chests, track.release))
  if (edits.signs) replaced.set(4, encodeSignsSection(edits.signs))

  // 段数够不够（老存档段数少时不允许动那些段）
  for (const index of replaced.keys()) {
    if (track.pointers.length <= index) {
      throw new Error(`这份存档没有第 ${index} 段，无法改写`)
    }
  }

  const pieces: Uint8Array[] = []
  const newPointers: number[] = []
  let size = 0
  for (let index = 0; index < track.pointers.length; index++) {
    const { from, to } = sectionSpan(index)
    const piece = replaced.get(index) ?? staged.slice(from, to)
    pieces.push(piece)
    size += piece.length
    newPointers[index] = size
  }
  // `0` 是「该版本没有这一段」的占位（见 `footerStartOf`），保持 0 不动。
  for (let index = 0; index < newPointers.length; index++) {
    if (track.pointers[index] === 0) newPointers[index] = 0
  }
  // footer：改了名字就重建（名字 + worldId 都要与头部一致），否则整段原样保留。
  pieces.push(rename ? buildFooter(edits.name as string, track.worldId) : staged.slice(track.footerAt))

  const out = concat(pieces)
  const dv = view(out)
  // 重写段指针表（位于文件头，远在 headerAt 之前，不受平移影响）。
  newPointers.forEach((p, i) => dv.setInt32(track.pointersAt + i * 4, p, true))
  // Revision++（游戏自己保存世界时也这么做，云存档冲突检测会用）。
  dv.setUint32(track.revisionAt, (dv.getUint32(track.revisionAt, true) + 1) >>> 0, true)
  return out
}

/** footer = `bool true` + 世界名 + `int32 worldId`（加载时两者都会与头部比较）。 */
function buildFooter(name: string, worldId: number): Uint8Array {
  const nameBytes = encodeDotNetString(name)
  const out = new Uint8Array(1 + nameBytes.length + 4)
  out[0] = 1
  out.set(nameBytes, 1)
  new DataView(out.buffer).setInt32(1 + nameBytes.length, worldId, true)
  return out
}
