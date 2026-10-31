/**
 * 极简 **GIF 解码器**（纯函数，配合 `gif.ts` 的编码器工作，也可解析常见 GIF89a）。
 *
 * 用途：精灵图 →「GIF」tab 把一张动图分拆成一帧帧 PNG（本地处理，不上传）。
 *
 * 支持：全局 / 局部色表、透明索引、interlace、disposal 0–3 的合成（还原背景 / 还原上一帧）、
 * NETSCAPE 循环次数。不支持：罕见损坏文件（抛错）。
 */

export interface DecodedGifFrame {
  /** 合成后的整幅 RGBA（逻辑屏幕尺寸）。 */
  data: Uint8ClampedArray
  /** 该帧延迟（毫秒）。 */
  delayMs: number
}

export interface DecodedGif {
  width: number
  height: number
  frames: DecodedGifFrame[]
  /** NETSCAPE 循环次数；`null` = 没有循环扩展。 */
  loop: number | null
}

const u16 = (data: Uint8Array, at: number) => data[at] | (data[at + 1] << 8)

export function decodeGif(bytes: Uint8Array): DecodedGif {
  if (bytes.length < 13 || String.fromCharCode(...bytes.slice(0, 3)) !== 'GIF') {
    throw new Error('not a gif')
  }
  const width = u16(bytes, 6)
  const height = u16(bytes, 8)
  if (width < 1 || height < 1) throw new Error('invalid gif size')

  const packed = bytes[10]
  let pos = 13
  let globalTable: number[][] | null = null
  if (packed & 0x80) {
    const size = 1 << ((packed & 0x07) + 1)
    globalTable = readColorTable(bytes, pos, size)
    pos += size * 3
  }

  const frames: DecodedGifFrame[] = []
  let loop: number | null = null
  /** 画布（整幅，透明底）。 */
  const canvas = new Uint8ClampedArray(width * height * 4)
  /** 上一帧的恢复快照（disposal = 3 用）。 */
  let restore: Uint8ClampedArray | null = null
  let prevRect: { x: number; y: number; w: number; h: number } | null = null
  let prevDisposal = 0

  let pendingDelay = 0
  let pendingTransparent: number | null = null
  let pendingDisposal = 0

  while (pos < bytes.length) {
    const block = bytes[pos]
    if (block === 0x3b) break

    if (block === 0x21) {
      const label = bytes[pos + 1]
      pos += 2
      if (label === 0xf9) {
        const size = bytes[pos]
        const flags = bytes[pos + 1]
        pendingDelay = u16(bytes, pos + 2) * 10
        pendingTransparent = flags & 0x01 ? bytes[pos + 4] : null
        pendingDisposal = (flags >> 2) & 0x07
        pos += 1 + size + 1 // size + payload + terminator
      } else if (label === 0xff) {
        const size = bytes[pos]
        const id = String.fromCharCode(...bytes.slice(pos + 1, pos + 1 + size))
        pos += 1 + size
        const sub = readSubBlocks(bytes, pos)
        if (id === 'NETSCAPE2.0' && sub.bytes[0] === 0x01) {
          loop = sub.bytes[1] | (sub.bytes[2] << 8)
        }
        pos = sub.next
      } else {
        pos = skipSubBlocks(bytes, pos)
      }
      continue
    }

    if (block === 0x2c) {
      const left = u16(bytes, pos + 1)
      const top = u16(bytes, pos + 3)
      const w = u16(bytes, pos + 5)
      const h = u16(bytes, pos + 7)
      const imagePacked = bytes[pos + 9]
      const interlaced = (imagePacked & 0x40) !== 0
      const hasLocal = (imagePacked & 0x80) !== 0
      pos += 10
      let table = globalTable
      if (hasLocal) {
        const size = 1 << ((imagePacked & 0x07) + 1)
        table = readColorTable(bytes, pos, size)
        pos += size * 3
      }
      if (!table) throw new Error('missing color table')

      const minCodeSize = bytes[pos]
      const sub = readSubBlocks(bytes, pos + 1)
      pos = sub.next
      const indices = lzwDecode(sub.bytes, minCodeSize, w * h)

      // 先处理上一帧的 disposal（2 = 还原背景，3 = 还原上一帧）
      if (prevRect && prevDisposal === 2) clearRect(canvas, width, prevRect)
      if (prevRect && prevDisposal === 3 && restore) canvas.set(restore)

      // 当前帧 disposal = 3 时，先记住「画之前」的画面
      restore = pendingDisposal === 3 ? canvas.slice() : null

      drawFrame(canvas, width, height, { x: left, y: top, w, h }, indices, table, pendingTransparent, interlaced)

      frames.push({ data: canvas.slice(), delayMs: pendingDelay })
      prevRect = { x: left, y: top, w, h }
      prevDisposal = pendingDisposal
      pendingDelay = 0
      pendingTransparent = null
      pendingDisposal = 0
      continue
    }

    throw new Error(`unexpected gif block 0x${block.toString(16)}`)
  }

  return { width, height, frames, loop }
}

function readColorTable(bytes: Uint8Array, at: number, size: number): number[][] {
  const table: number[][] = []
  for (let i = 0; i < size; i += 1) {
    table.push([bytes[at + i * 3], bytes[at + i * 3 + 1], bytes[at + i * 3 + 2]])
  }
  return table
}

function readSubBlocks(bytes: Uint8Array, at: number): { bytes: Uint8Array; next: number } {
  const chunks: Uint8Array[] = []
  let pos = at
  let total = 0
  while (pos < bytes.length && bytes[pos] !== 0) {
    const size = bytes[pos]
    chunks.push(bytes.subarray(pos + 1, pos + 1 + size))
    total += size
    pos += size + 1
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return { bytes: out, next: pos + 1 }
}

function skipSubBlocks(bytes: Uint8Array, at: number): number {
  return readSubBlocks(bytes, at).next
}

/** GIF 的 interlace 行序（4 遍）。 */
const INTERLACE_PASSES: Array<[number, number]> = [
  [0, 8],
  [4, 8],
  [2, 4],
  [1, 2],
]

function drawFrame(
  canvas: Uint8ClampedArray,
  screenWidth: number,
  screenHeight: number,
  rect: { x: number; y: number; w: number; h: number },
  indices: number[],
  table: number[][],
  transparent: number | null,
  interlaced: boolean,
) {
  const rows: number[] = []
  if (interlaced) {
    for (const [start, step] of INTERLACE_PASSES) {
      for (let y = start; y < rect.h; y += step) rows.push(y)
    }
  } else {
    for (let y = 0; y < rect.h; y += 1) rows.push(y)
  }

  let source = 0
  for (const row of rows) {
    for (let x = 0; x < rect.w; x += 1) {
      const index = indices[source]
      source += 1
      if (index === transparent) continue
      const color = table[index] ?? [0, 0, 0]
      const px = rect.x + x
      const py = rect.y + row
      if (px < 0 || py < 0 || px >= screenWidth || py >= screenHeight) continue
      const offset = (py * screenWidth + px) * 4
      canvas[offset] = color[0]
      canvas[offset + 1] = color[1]
      canvas[offset + 2] = color[2]
      canvas[offset + 3] = 255
    }
  }
}

function clearRect(
  canvas: Uint8ClampedArray,
  screenWidth: number,
  rect: { x: number; y: number; w: number; h: number },
) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    if (y < 0) continue
    const start = (y * screenWidth + rect.x) * 4
    canvas.fill(0, start, start + rect.w * 4)
  }
}

/** GIF 的 LZW 解码（变长码；字典满 4096 时等 clear 重置）。 */
function lzwDecode(data: Uint8Array, minCodeSize: number, maxPixels: number): number[] {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  let dict: number[][] = []
  const reset = () => {
    dict = []
    for (let i = 0; i < clearCode; i += 1) dict.push([i])
    dict.push([])
    dict.push([])
    nextCode = endCode + 1
    codeSize = minCodeSize + 1
  }
  reset()

  const out: number[] = []
  let bitPos = 0
  let prev: number[] | null = null
  const readCode = (): number | null => {
    if (bitPos + codeSize > data.length * 8) return null
    let code = 0
    for (let i = 0; i < codeSize; i += 1) {
      const bit = (data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1
      code |= bit << i
    }
    bitPos += codeSize
    return code
  }

  while (out.length < maxPixels) {
    const code = readCode()
    if (code == null) break
    if (code === clearCode) {
      reset()
      prev = null
      continue
    }
    if (code === endCode) break
    let entry: number[]
    if (code < dict.length && dict[code].length > 0) entry = dict[code]
    else if (prev) entry = [...prev, prev[0]]
    else break
    out.push(...entry)
    if (prev && nextCode < 4096) {
      dict.push([...prev, entry[0]])
      nextCode += 1
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1
    }
    prev = entry
  }
  return out.length > maxPixels ? out.slice(0, maxPixels) : out
}
