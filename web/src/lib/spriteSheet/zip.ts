/**
 * 最小 ZIP 写入器（**store-only**，不压缩）。
 *
 * 用途：精灵图分割「导出全部」把多张 PNG 打成一个压缩包。
 * PNG 本身已是压缩数据，再套 deflate 只会浪费时间与 CPU，也避免为此引入第三方依赖；
 * 这里只写本地文件头 / 中央目录 / EOCD，文件名按 UTF-8 标记（flag 0x0800）。
 */

export interface ZipEntry {
  /** 包内文件名（用 `/` 分隔；不支持目录条目，目录由文件名隐含）。 */
  name: string
  data: Uint8Array
}

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const VERSION = 20
const METHOD_STORE = 0

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  crcTable = table
  return table
}

/** 标准 CRC-32（IEEE 802.3，与 ZIP 一致）。 */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** `Date` → DOS 日期 / 时间（1980 起，秒精度 2s）。 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time:
      (Math.floor(date.getSeconds() / 2) & 0x1f) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getHours() & 0x1f) << 11),
    date:
      (date.getDate() & 0x1f) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      ((year - 1980) << 9),
  }
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** 生成 ZIP 字节。空条目列表也合法（只有 EOCD）。 */
export function buildZip(entries: ZipEntry[], date: Date = new Date()): Uint8Array {
  const { time, date: dosDate } = dosDateTime(date)
  const encoder = utf8
  const prepared = entries.map((entry) => {
    const name = encoder(entry.name)
    return { name, data: entry.data, crc: crc32(entry.data) }
  })

  const localSize = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0)
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0)
  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let offset = 0

  const writeLocal = (entry: (typeof prepared)[number]) => {
    view.setUint32(offset, LOCAL_SIG, true)
    view.setUint16(offset + 4, VERSION, true)
    view.setUint16(offset + 6, 0x0800, true) // UTF-8 文件名
    view.setUint16(offset + 8, METHOD_STORE, true)
    view.setUint16(offset + 10, time, true)
    view.setUint16(offset + 12, dosDate, true)
    view.setUint32(offset + 14, entry.crc, true)
    view.setUint32(offset + 18, entry.data.length, true)
    view.setUint32(offset + 22, entry.data.length, true)
    view.setUint16(offset + 26, entry.name.length, true)
    view.setUint16(offset + 28, 0, true)
    offset += 30
    out.set(entry.name, offset)
    offset += entry.name.length
    out.set(entry.data, offset)
    offset += entry.data.length
  }

  const localOffsets: number[] = []
  for (const entry of prepared) {
    localOffsets.push(offset)
    writeLocal(entry)
  }

  const centralStart = offset
  prepared.forEach((entry, index) => {
    view.setUint32(offset, CENTRAL_SIG, true)
    view.setUint16(offset + 4, VERSION, true) // version made by
    view.setUint16(offset + 6, VERSION, true) // version needed
    view.setUint16(offset + 8, 0x0800, true)
    view.setUint16(offset + 10, METHOD_STORE, true)
    view.setUint16(offset + 12, time, true)
    view.setUint16(offset + 14, dosDate, true)
    view.setUint32(offset + 16, entry.crc, true)
    view.setUint32(offset + 20, entry.data.length, true)
    view.setUint32(offset + 24, entry.data.length, true)
    view.setUint16(offset + 28, entry.name.length, true)
    view.setUint16(offset + 30, 0, true) // extra
    view.setUint16(offset + 32, 0, true) // comment
    view.setUint16(offset + 34, 0, true) // disk start
    view.setUint16(offset + 36, 0, true) // internal attrs
    view.setUint32(offset + 38, 0, true) // external attrs
    view.setUint32(offset + 42, localOffsets[index], true)
    offset += 46
    out.set(entry.name, offset)
    offset += entry.name.length
  })

  view.setUint32(offset, EOCD_SIG, true)
  view.setUint16(offset + 4, 0, true)
  view.setUint16(offset + 6, 0, true)
  view.setUint16(offset + 8, prepared.length, true)
  view.setUint16(offset + 10, prepared.length, true)
  view.setUint32(offset + 12, offset - centralStart, true)
  view.setUint32(offset + 16, centralStart, true)
  view.setUint16(offset + 20, 0, true)

  return out
}
