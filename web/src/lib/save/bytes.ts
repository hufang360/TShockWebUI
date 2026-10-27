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

  /**
   * 位压缩布尔数组（`ReadBitArray`：uint16 位数 + 位数据，低位在前）。
   *
   * 世界文件的「图格是否帧化」表就是它，长度 = `TileID.Count`（1.4.5.8 是 754 位）。
   */
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
 * .NET `DateTime.ToBinary()` → ISO 字符串，**按 Kind 位区分语义**（高 2 位：1 = UTC / 2 = 本地 / 0 = 未指定）。
 *
 * 两种存档的写法不一样，混为一谈就会显示成差一个时区的错误时间（实测踩过）：
 * - **世界「创建时间」**：`WorldFile.SaveHeader` 写 `Main.ActiveWorldFileData.CreationTime.ToBinary()`，
 *   那是 `DateTime.Now` → Kind = **本地**，ticks 就是**本地墙上时间**。输出不带时区后缀（`…T00:28:35.450`），
 *   界面原样显示，**不做换算**。
 * - **世界「最后游玩」**：`WorldFile.SaveHeader` 写 `DateTime.UtcNow.ToBinary()` → Kind = **UTC**。
 *   输出带 `Z`，界面换算成本地时区（与文件 mtime 对得上：`2.wld` 的 UTC 12:25 = 本地 20:25）。
 * - **角色「最后保存」**（`.plr`）：`Player.SavePlayer` 写 `DateTime.UtcNow` → 同样带 `Z`，由 `formatSaveTime` 换算。
 *
 * ticks 是 100ns 单位、约 6.2e17，**超过 double 的 53 位**，所以用 BigInt 运算。
 */
export function dotnetBinaryToIso(value: bigint): string | null {
  const kind = Number(value >> 62n) // 0 未指定 / 1 UTC / 2 本地
  const ticks = value & 0x3fffffffffffffffn // 低 62 位
  const epochTicks = 621355968000000000n // 0001-01-01 → 1970-01-01
  if (ticks <= epochTicks) return null
  const ms = Number((ticks - epochTicks) / 10000n)
  if (!Number.isFinite(ms)) return null
  // UTC（或未指定）→ 带 Z；本地墙上时间 → 不带时区，按字面显示
  return kind === 1 ? new Date(ms).toISOString() : wallClockOf(ticks)
}

/**
 * ticks（自 0001-01-01 的 100ns）→ `YYYY-MM-DDTHH:MM:SS.mmm`（**不带时区**，不经过 `Date` 的时区换算）。
 *
 * 为什么要自己算：`new Date(ms)` 会按运行环境时区解释，而这里要的是「文件里写的那串数字」。
 */
function wallClockOf(ticks: bigint): string {
  const rest = ticks - 621355968000000000n // 自 1970-01-01 起的 ticks
  const totalMs = rest / 10000n
  const ms = Number(totalMs % 1000n)
  const totalSec = totalMs / 1000n
  const days = Number(totalSec / 86400n)
  let sod = Number(totalSec % 86400n)
  const hh = Math.floor(sod / 3600)
  sod -= hh * 3600
  const mi = Math.floor(sod / 60)
  const ss = sod - mi * 60
  const { y, m, d } = civilFromDays(days)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p2(m)}-${p2(d)}T${p2(hh)}:${p2(mi)}:${p2(ss)}.${String(ms).padStart(3, '0')}`
}

/** 自 1970-01-01 起的天数 → 公历年月日（Howard Hinnant 的 civil_from_days，避免任何时区参与）。 */
function civilFromDays(days: number): { y: number; m: number; d: number } {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return { y: y + (m <= 2 ? 1 : 0), m, d }
}
