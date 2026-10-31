/**
 * 极简 **GIF89a 编码器**（零依赖，纯函数）。
 *
 * 用途：精灵图分割把多张切片串成动画帧，导出 `.gif`。全程在前端内存里做，不上传任何数据。
 *
 * 结构：`GIF89a` 头 + 逻辑屏幕描述符（**不用全局色表**）→ 可选 NETSCAPE 循环块 →
 * 每帧一个图形控制扩展（延迟 / 透明 / disposal=2）+ 图像描述符（**每帧局部色表**）+ LZW 数据。
 *
 * 颜色：
 * - 每帧独立量化（局部色表），像素画常见 ≤255 色时**原样保色**，超过才做中位切分（median cut）；
 * - 有透明像素时预留一个透明色索引（`alpha < 128` 视为透明，GIF 只支持 1-bit 透明）；
 * - 透明帧一律 `disposal = 2`（还原背景），避免上一帧透出来。
 */

export interface GifFrameInput {
  /** RGBA，长度必须等于 `width × height × 4`。 */
  data: Uint8ClampedArray
}

export interface GifOptions {
  width: number
  height: number
  /** 每帧延迟（毫秒）。GIF 精度 1/100 秒，内部最小 10ms。 */
  delayMs: number
  /** `0` = 无限循环；`1` = 只播一次（不写 NETSCAPE 块）。默认无限。 */
  loop?: number
  /** alpha 低于该值视为透明。默认 128。 */
  alphaThreshold?: number
}

const MAX_COLORS = 256
const DEFAULT_ALPHA_THRESHOLD = 128

interface ColorCount {
  r: number
  g: number
  b: number
  n: number
}

interface Quantized {
  /** 每项 `[r, g, b]`。 */
  palette: number[][]
  indices: Uint8Array
  /** 透明色索引；`null` = 该帧不透明。 */
  transparent: number | null
}

/**
 * 编码为 GIF 字节。帧尺寸必须一致（调用方先把帧合成到同一画布）。
 * 数据非法（空帧 / 长度不符 / 尺寸为 0）时抛错。
 */
export function encodeGif(frames: GifFrameInput[], options: GifOptions): Uint8Array {
  const width = Math.round(options.width)
  const height = Math.round(options.height)
  if (width < 1 || height < 1) throw new Error('invalid gif size')
  if (frames.length === 0) throw new Error('no frames')
  const expected = width * height * 4
  for (const frame of frames) {
    if (frame.data.length !== expected) throw new Error('frame size mismatch')
  }

  const alphaThreshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD
  const delay = Math.max(1, Math.min(1000, Math.round((options.delayMs || 0) / 10) || 1))
  const loop = options.loop ?? 0
  const out: number[] = []

  // Header + 逻辑屏幕描述符（无全局色表）
  pushAscii(out, 'GIF89a')
  pushU16(out, width)
  pushU16(out, height)
  out.push(0x00, 0x00, 0x00)

  // NETSCAPE2.0 循环块（loop = 1 时不写 = 只播一次）
  if (loop !== 1) {
    out.push(0x21, 0xff, 0x0b)
    pushAscii(out, 'NETSCAPE2.0')
    out.push(0x03, 0x01)
    pushU16(out, Math.max(0, Math.round(loop)))
    out.push(0x00)
  }

  for (const frame of frames) {
    const quantized = quantize(frame.data, width, height, alphaThreshold)
    const tableBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, quantized.palette.length))))
    const tableSize = 1 << tableBits

    // 图形控制扩展：disposal = 2（还原背景）、透明标记、延迟
    out.push(0x21, 0xf9, 0x04)
    out.push((2 << 2) | (quantized.transparent != null ? 1 : 0))
    pushU16(out, delay)
    out.push(quantized.transparent ?? 0, 0x00)

    // 图像描述符：整屏、使用局部色表
    out.push(0x2c)
    pushU16(out, 0)
    pushU16(out, 0)
    pushU16(out, width)
    pushU16(out, height)
    out.push(0x80 | (tableBits - 1))

    // 局部色表（补 0 到 2 的幂）
    for (let i = 0; i < tableSize; i += 1) {
      const color = quantized.palette[i] ?? [0, 0, 0]
      out.push(color[0] & 0xff, color[1] & 0xff, color[2] & 0xff)
    }

    // LZW
    const minCodeSize = Math.max(2, tableBits)
    out.push(minCodeSize)
    const compressed = lzwEncode(quantized.indices, minCodeSize)
    for (let i = 0; i < compressed.length; i += 255) {
      const chunk = compressed.slice(i, i + 255)
      out.push(chunk.length)
      for (const byte of chunk) out.push(byte)
    }
    out.push(0x00)
  }

  // Trailer
  out.push(0x3b)
  return Uint8Array.from(out)
}

function pushAscii(out: number[], text: string) {
  for (let i = 0; i < text.length; i += 1) out.push(text.charCodeAt(i) & 0xff)
}

function pushU16(out: number[], value: number) {
  out.push(value & 0xff, (value >> 8) & 0xff)
}

/** 量化一帧：像素画常见 ≤255 色时精确保色；超出走中位切分。 */
function quantize(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number,
): Quantized {
  const pixelCount = width * height
  const counts = new Map<number, number>()
  let hasTransparent = false
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4
    if (rgba[offset + 3] < alphaThreshold) {
      hasTransparent = true
      continue
    }
    const key = (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const maxOpaque = MAX_COLORS - (hasTransparent ? 1 : 0)
  const colors: ColorCount[] = []
  for (const [key, n] of counts) {
    colors.push({ r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff, n })
  }

  let palette: number[][]
  if (colors.length <= maxOpaque) {
    palette = colors.map((c) => [c.r, c.g, c.b])
  } else {
    palette = medianCut(colors, Math.max(1, maxOpaque))
  }

  let transparent: number | null = null
  if (hasTransparent) {
    transparent = palette.length
    palette = [...palette, [0, 0, 0]]
  }

  // 最近的色表项（按打包 RGB 缓存，避免同一颜色反复搜索）
  const opaqueCount = transparent ?? palette.length
  const cache = new Map<number, number>()
  const indices = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4
    if (rgba[offset + 3] < alphaThreshold) {
      indices[i] = transparent ?? 0
      continue
    }
    const key = (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2]
    const cached = cache.get(key)
    if (cached !== undefined) {
      indices[i] = cached
      continue
    }
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    const r = rgba[offset]
    const g = rgba[offset + 1]
    const b = rgba[offset + 2]
    for (let p = 0; p < opaqueCount; p += 1) {
      const [pr, pg, pb] = palette[p]
      const dr = r - pr
      const dg = g - pg
      const db = b - pb
      const distance = dr * dr + dg * dg + db * db
      if (distance < bestDistance) {
        bestDistance = distance
        best = p
        if (distance === 0) break
      }
    }
    cache.set(key, best)
    indices[i] = best
  }

  return { palette, indices, transparent }
}

/** 中位切分：按最大跨度通道反复对半切，直到达到色数上限或无法再切。 */
function medianCut(colors: ColorCount[], maxColors: number): number[][] {
  const buckets: ColorCount[][] = [colors]
  while (buckets.length < maxColors) {
    let target = -1
    let targetRange = 0
    let targetChannel: 'r' | 'g' | 'b' = 'r'
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i]
      if (bucket.length < 2) continue
      const channel = widestChannel(bucket)
      const range =
        Math.max(...bucket.map((c) => c[channel])) - Math.min(...bucket.map((c) => c[channel]))
      if (range > targetRange) {
        targetRange = range
        target = i
        targetChannel = channel
      }
    }
    if (target < 0 || targetRange === 0) break
    const bucket = [...buckets[target]].sort((a, b) => a[targetChannel] - b[targetChannel])
    const total = bucket.reduce((sum, c) => sum + c.n, 0)
    let acc = 0
    let split = 1
    for (let i = 0; i < bucket.length - 1; i += 1) {
      acc += bucket[i].n
      if (acc * 2 >= total) {
        split = i + 1
        break
      }
    }
    split = Math.max(1, Math.min(bucket.length - 1, split))
    buckets.splice(target, 1, bucket.slice(0, split), bucket.slice(split))
  }

  return buckets.map((bucket) => {
    const total = bucket.reduce((sum, c) => sum + c.n, 0) || 1
    const r = Math.round(bucket.reduce((sum, c) => sum + c.r * c.n, 0) / total)
    const g = Math.round(bucket.reduce((sum, c) => sum + c.g * c.n, 0) / total)
    const b = Math.round(bucket.reduce((sum, c) => sum + c.b * c.n, 0) / total)
    return [r, g, b]
  })
}

function widestChannel(bucket: ColorCount[]): 'r' | 'g' | 'b' {
  const ranges = (['r', 'g', 'b'] as const).map((channel) => {
    let min = 255
    let max = 0
    for (const color of bucket) {
      if (color[channel] < min) min = color[channel]
      if (color[channel] > max) max = color[channel]
    }
    return { channel, range: max - min }
  })
  ranges.sort((a, b) => b.range - a.range)
  return ranges[0].channel
}

/**
 * GIF 的 LZW（变长码，最低 3 位起）。返回**未分块**的压缩数据，
 * 由调用方按 ≤255 字节切块写入。
 */
function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  let dictionary = new Map<number, number>()
  const out: number[] = []
  let bitBuffer = 0
  let bitCount = 0

  const emit = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }

  emit(clearCode)
  if (indices.length === 0) {
    emit(endCode)
    if (bitCount > 0) out.push(bitBuffer & 0xff)
    return out
  }

  let current = indices[0]
  for (let i = 1; i < indices.length; i += 1) {
    const next = indices[i]
    const key = (current << 8) | next
    const found = dictionary.get(key)
    if (found !== undefined) {
      current = found
      continue
    }
    emit(current)
    dictionary.set(key, nextCode)
    nextCode += 1
    if (nextCode === 4096) {
      // 字典满：发 clear 并重置（双方都在 12 位码宽）
      emit(clearCode)
      dictionary = new Map()
      nextCode = endCode + 1
      codeSize = minCodeSize + 1
    } else if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
      // 注意 +1：编码器的字典总比解码器**先一条**（解码器要读到下一码才补上上一条），
      // 所以码宽要在解码器也追上之后才增长，否则两边位宽错开一格、整段数据解不出来。
      codeSize += 1
    }
    current = next
  }

  emit(current)
  emit(endCode)
  if (bitCount > 0) out.push(bitBuffer & 0xff)
  return out
}
