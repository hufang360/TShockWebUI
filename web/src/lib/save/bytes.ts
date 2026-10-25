/**
 * 二进制读取器（.NET `BinaryReader` 语义），给 `.plr` / `.wld` 这类 Terraria 存档用。
 *
 * 只做纯计算、不依赖浏览器 API：解析逻辑因此可以在 Node（单测）与 Worker 里跑。
 */

/** 存档数据不完整 / 结构非法。 */
export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaveFormatError'
  }
}

export class ByteReader {
  readonly buf: Uint8Array
  private readonly view: DataView
  pos = 0

  constructor(buf: Uint8Array) {
    this.buf = buf
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  get length(): number {
    return this.buf.length
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) {
      throw new SaveFormatError('存档数据不完整')
    }
  }

  skip(n: number): void {
    this.need(n)
    this.pos += n
  }

  bytes(n: number): Uint8Array {
    this.need(n)
    const out = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  u8(): number {
    this.need(1)
    return this.buf[this.pos++]
  }

  boolean(): boolean {
    return this.u8() !== 0
  }

  i16(): number {
    this.need(2)
    const v = this.view.getInt16(this.pos, true)
    this.pos += 2
    return v
  }

  u16(): number {
    this.need(2)
    const v = this.view.getUint16(this.pos, true)
    this.pos += 2
    return v
  }

  i32(): number {
    this.need(4)
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }

  /** int64 → number（世界生成器版本等整数，2^53 以内安全）。 */
  i64(): number {
    return Number(this.i64b())
  }

  /** int64 → bigint（时间戳 ticks 超过 2^53，必须用 BigInt 才不丢精度）。 */
  i64b(): bigint {
    this.need(8)
    const v = this.view.getBigInt64(this.pos, true)
    this.pos += 8
    return v
  }

  u64(): number {
    this.need(8)
    const v = this.view.getBigUint64(this.pos, true)
    this.pos += 8
    return Number(v)
  }

  f32(): number {
    this.need(4)
    const v = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }

  f64(): number {
    this.need(8)
    const v = this.view.getFloat64(this.pos, true)
    this.pos += 8
    return v
  }

  /** .NET `BinaryReader.ReadString`：7 位变长长度（字节数）+ UTF-8。 */
  str(): string {
    let length = 0
    let shift = 0
    for (;;) {
      const b = this.u8()
      length |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
      if (shift > 28) throw new SaveFormatError('字符串长度非法')
    }
    const raw = this.bytes(length)
    return new TextDecoder().decode(raw)
  }

  /** 位压缩布尔数组（`ReadBitArray`：uint16 位数 + 位数据，低位在前）。 */
  bits(): boolean[] {
    const n = this.u16()
    if (n < 0 || n > 4096) throw new SaveFormatError('位数组长度异常')
    const out = new Array<boolean>(n)
    let data = 0
    let mask = 128
    for (let i = 0; i < n; i++) {
      if (mask !== 128) {
        mask <<= 1
      } else {
        data = this.u8()
        mask = 1
      }
      out[i] = (data & mask) === mask
    }
    return out
  }

  /** 读 3 字节 RGB。 */
  rgb(): [number, number, number] {
    const b = this.bytes(3)
    return [b[0], b[1], b[2]]
  }
}

/**
 * .NET `DateTime.ToBinary()` → ISO 字符串（UTC，即存档里记录的「墙上时间」）。
 *
 * 游戏用 `DateTime.Now.ToBinary()` 存本地时间；这里按 UTC 解释并原样输出，
 * 前端也按 UTC 展示，于是显示的就是游戏里看到的时间（不做时区换算）。
 *
 * ticks 是 100ns 单位、约 6.2e17，**超过 double 的 53 位**，所以用 BigInt 运算；
 * 落成毫秒后再交给 `Date`（毫秒在 1.7e12 量级，安全）。
 */
export function dotnetBinaryToIso(value: bigint): string | null {
  const ticks = value & 0x3fffffffffffffffn // 低 62 位（高 2 位是 DateTimeKind）
  const epochTicks = 621355968000000000n // 0001-01-01 → 1970-01-01
  if (ticks <= epochTicks) return null
  const ms = Number((ticks - epochTicks) / 10000n)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}
