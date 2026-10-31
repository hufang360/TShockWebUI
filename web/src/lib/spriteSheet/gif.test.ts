import { describe, expect, it } from 'vitest'
import { encodeGif, type GifFrameInput } from './gif'

/** 极简 GIF 解析器（只覆盖本编码器写出的结构），用于验证「导出的确实是可解码的 GIF」。 */
interface ParsedFrame {
  delay: number
  transparent: number | null
  disposal: number
  palette: number[][]
  indices: number[]
}

interface ParsedGif {
  version: string
  width: number
  height: number
  loop: number | null
  frames: ParsedFrame[]
}

function u16(data: number[], at: number): number {
  return data[at] | (data[at + 1] << 8)
}

function readSubBlocks(data: number[], at: number): { bytes: number[]; next: number } {
  const bytes: number[] = []
  let pos = at
  while (data[pos] !== 0) {
    const size = data[pos]
    for (let i = 0; i < size; i += 1) bytes.push(data[pos + 1 + i])
    pos += size + 1
  }
  return { bytes, next: pos + 1 }
}

function lzwDecode(data: number[], minCodeSize: number): number[] {
  const clear = 1 << minCodeSize
  const end = clear + 1
  let codeSize = minCodeSize + 1
  let next = end + 1
  let dict: number[][] = []
  const reset = () => {
    dict = []
    for (let i = 0; i < clear; i += 1) dict.push([i])
    dict.push([])
    dict.push([])
    next = end + 1
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

  while (true) {
    const code = readCode()
    if (code == null) break
    if (code === clear) {
      reset()
      prev = null
      continue
    }
    if (code === end) break
    let entry: number[]
    if (code < dict.length && dict[code].length > 0) entry = dict[code]
    else if (prev) entry = [...prev, prev[0]]
    else break
    out.push(...entry)
    if (prev && next < 4096) {
      dict.push([...prev, entry[0]])
      next += 1
      if (next === 1 << codeSize && codeSize < 12) codeSize += 1
    }
    prev = entry
  }
  return out
}

function parseGif(bytes: Uint8Array): ParsedGif {
  const data = Array.from(bytes)
  const version = String.fromCharCode(...data.slice(0, 6))
  const width = u16(data, 6)
  const height = u16(data, 8)
  const packed = data[10]
  let pos = 13
  if (packed & 0x80) pos += 3 * (1 << ((packed & 7) + 1))

  let loop: number | null = null
  const frames: ParsedFrame[] = []

  while (pos < data.length) {
    const block = data[pos]
    if (block === 0x3b) break
    if (block === 0x21) {
      const label = data[pos + 1]
      pos += 2
      if (label === 0xff) {
        const size = data[pos]
        const id = String.fromCharCode(...data.slice(pos + 1, pos + 1 + size))
        pos += 1 + size
        const sub = readSubBlocks(data, pos)
        if (id === 'NETSCAPE2.0' && sub.bytes[0] === 0x01) {
          loop = sub.bytes[1] | (sub.bytes[2] << 8)
        }
        pos = sub.next
      } else if (label === 0xf9) {
        const size = data[pos]
        const payload = data.slice(pos + 1, pos + 1 + size)
        frames.push({
          disposal: (payload[0] >> 2) & 0x07,
          delay: payload[1] | (payload[2] << 8),
          transparent: payload[0] & 0x01 ? payload[3] : null,
          palette: [],
          indices: [],
        })
        pos += 1 + size + 1
      } else {
        pos = readSubBlocks(data, pos).next
      }
      continue
    }
    if (block === 0x2c) {
      const frame = frames[frames.length - 1]
      const imagePacked = data[pos + 9]
      pos += 10
      const hasLocal = Boolean(imagePacked & 0x80)
      const tableSize = 1 << ((imagePacked & 0x07) + 1)
      if (hasLocal) {
        for (let i = 0; i < tableSize; i += 1) {
          frame.palette.push([data[pos + i * 3], data[pos + i * 3 + 1], data[pos + i * 3 + 2]])
        }
        pos += tableSize * 3
      }
      const minCodeSize = data[pos]
      const sub = readSubBlocks(data, pos + 1)
      frame.indices = lzwDecode(sub.bytes, minCodeSize)
      pos = sub.next
      continue
    }
    throw new Error(`unexpected block 0x${block.toString(16)} at ${pos}`)
  }

  return { version, width, height, loop, frames }
}

function frameOf(width: number, height: number, pixel: (x: number, y: number) => number[]): GifFrameInput {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y)
      const offset = (y * width + x) * 4
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = a
    }
  }
  return { data }
}

describe('encodeGif 结构', () => {
  it('写出 GIF89a 头、尺寸、循环块与每帧延迟 / disposal', () => {
    const frames = [
      frameOf(2, 2, () => [255, 0, 0, 255]),
      frameOf(2, 2, () => [0, 0, 255, 255]),
    ]
    const parsed = parseGif(encodeGif(frames, { width: 2, height: 2, delayMs: 120, loop: 0 }))
    expect(parsed.version).toBe('GIF89a')
    expect(parsed.width).toBe(2)
    expect(parsed.height).toBe(2)
    expect(parsed.loop).toBe(0)
    expect(parsed.frames).toHaveLength(2)
    expect(parsed.frames.every((frame) => frame.delay === 12)).toBe(true)
    expect(parsed.frames.every((frame) => frame.disposal === 2)).toBe(true)
    expect(parsed.frames.every((frame) => frame.transparent == null)).toBe(true)
  })

  it('loop = 1 时不写 NETSCAPE 块（只播一次）', () => {
    const parsed = parseGif(
      encodeGif([frameOf(1, 1, () => [0, 0, 0, 255])], {
        width: 1,
        height: 1,
        delayMs: 50,
        loop: 1,
      }),
    )
    expect(parsed.loop).toBeNull()
  })

  it('透明像素：标记透明索引并保留 alpha=0', () => {
    const frames = [
      frameOf(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0])),
      frameOf(2, 1, () => [0, 255, 0, 255]),
    ]
    const parsed = parseGif(encodeGif(frames, { width: 2, height: 1, delayMs: 100 }))
    const first = parsed.frames[0]
    expect(first.transparent).not.toBeNull()
    expect(first.indices[0]).not.toBe(first.transparent)
    expect(first.indices[1]).toBe(first.transparent)
  })
})

describe('encodeGif 像素还原', () => {
  it('≤255 色时逐像素精确保色（LZW 可解回同样的索引）', () => {
    const colors = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [128, 64, 32, 255],
    ]
    const pixel = (x: number, y: number) => colors[(x + y * 3) % colors.length]
    const frames = [frameOf(3, 2, pixel), frameOf(3, 2, (x, y) => colors[(x + y) % colors.length])]
    const parsed = parseGif(encodeGif(frames, { width: 3, height: 2, delayMs: 100 }))
    expect(parsed.frames).toHaveLength(2)
    parsed.frames.forEach((frame, index) => {
      expect(frame.indices).toHaveLength(6)
      for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 3; x += 1) {
          const expected = index === 0 ? pixel(x, y) : colors[(x + y) % colors.length]
          const rgb = frame.palette[frame.indices[y * 3 + x]]
          expect(rgb).toEqual(expected.slice(0, 3))
        }
      }
    })
  })

  it('超过 255 色时量化后仍能解码（颜色误差有限、同色映射一致）', () => {
    // 20×15 = 300 个不同颜色
    const color = (i: number) => [i % 256, (i * 7) % 256, (i * 13) % 256, 255]
    const frame = frameOf(20, 15, (x, y) => color(y * 20 + x))
    const parsed = parseGif(encodeGif([frame], { width: 20, height: 15, delayMs: 100 }))
    const decoded = parsed.frames[0]
    expect(decoded.indices).toHaveLength(300)
    expect(decoded.palette.length).toBeLessThanOrEqual(256)
    for (let i = 0; i < 300; i += 1) {
      const expected = color(i)
      const rgb = decoded.palette[decoded.indices[i]]
      expect(Math.abs(rgb[0] - expected[0])).toBeLessThanOrEqual(32)
      expect(Math.abs(rgb[1] - expected[1])).toBeLessThanOrEqual(32)
      expect(Math.abs(rgb[2] - expected[2])).toBeLessThanOrEqual(32)
    }
  })

  it('大字典（>4096 条）会中途重发 clear 且仍可解码', () => {
    const width = 64
    const height = 64
    // 噪声：让 LZW 字典反复扩张
    const frame = frameOf(width, height, (x, y) => {
      const n = (x * 73 + y * 151 + ((x * y) % 17) * 29) % 200
      return [n, (n * 3) % 200, (n * 7) % 200, 255]
    })
    const parsed = parseGif(encodeGif([frame], { width, height, delayMs: 100 }))
    expect(parsed.frames[0].indices).toHaveLength(width * height)
  })

  it('尺寸 / 数据长度非法时抛错', () => {
    expect(() => encodeGif([], { width: 2, height: 2, delayMs: 100 })).toThrow()
    expect(() =>
      encodeGif([frameOf(2, 2, () => [0, 0, 0, 255])], { width: 3, height: 2, delayMs: 100 }),
    ).toThrow()
  })
})
