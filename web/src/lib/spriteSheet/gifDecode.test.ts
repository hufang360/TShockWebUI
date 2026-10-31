import { describe, expect, it } from 'vitest'
import { encodeGif, type GifFrameInput } from './gif'
import { decodeGif } from './gifDecode'

function frame(width: number, height: number, pixel: (x: number, y: number) => number[]): GifFrameInput {
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

describe('decodeGif（与自写编码器往返）', () => {
  it('两帧不透明图：尺寸 / 帧数 / 像素 / 延迟 / 循环都对', () => {
    const red = frame(2, 2, () => [255, 0, 0, 255])
    const green = frame(2, 2, () => [0, 255, 0, 255])
    const decoded = decodeGif(encodeGif([red, green], { width: 2, height: 2, delayMs: 120, loop: 0 }))

    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.loop).toBe(0)
    expect(decoded.frames).toHaveLength(2)
    expect(decoded.frames[0].delayMs).toBe(120)
    // 第一帧红
    expect([...decoded.frames[0].data.slice(0, 4)]).toEqual([255, 0, 0, 255])
    // 最后一像素仍是红
    expect([...decoded.frames[0].data.slice(12, 16)]).toEqual([255, 0, 0, 255])
    // 第二帧绿（disposal=2，第一帧不应残留）
    expect([...decoded.frames[1].data.slice(0, 4)]).toEqual([0, 255, 0, 255])
  })

  it('透明帧 + disposal=2：上一帧的像素被清掉', () => {
    const full = frame(2, 1, () => [255, 0, 0, 255])
    const rightOnly = frame(2, 1, (x) => (x === 0 ? [0, 0, 255, 255] : [0, 0, 0, 0]))
    const decoded = decodeGif(encodeGif([full, rightOnly], { width: 2, height: 1, delayMs: 100 }))
    expect([...decoded.frames[1].data.slice(0, 4)]).toEqual([0, 0, 255, 255])
    expect(decoded.frames[1].data[7]).toBe(0) // 第二像素 alpha = 0
  })

  it('没有循环扩展时 loop 为 null', () => {
    const decoded = decodeGif(
      encodeGif([frame(1, 1, () => [0, 0, 0, 255])], { width: 1, height: 1, delayMs: 50, loop: 1 }),
    )
    expect(decoded.loop).toBeNull()
  })

  it('非 GIF 字节抛错', () => {
    expect(() => decodeGif(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })
})
