/**
 * 最小 ZIP **读取器**（支持 store / deflate，不支持 zip64 / 加密）。
 *
 * 用途：导入 Terraria 语言材质包（创意工坊 zip）。项目里已有只写 store 的 `lib/zipWrite.ts`，
 * 读取这边优先用浏览器原生 `DecompressionStream('deflate-raw')`，避免引入第三方依赖
 * （zip 里的文件基本都是 deflate，见 docs/计划-语言材质包.md §2.2）。
 */

export interface ZipEntry {
  /** 包内路径（UTF-8，`/` 分隔）。 */
  name: string
  /** 解压后的内容。 */
  bytes: Uint8Array
}

export interface ZipLimits {
  /** 条目数上限。 */
  maxEntries?: number
  /** 单个文件解压后的大小上限（字节）。 */
  maxFileBytes?: number
  /** 全部文件解压后的总大小上限（字节）。 */
  maxTotalBytes?: number
}

const DEFAULT_LIMITS: Required<ZipLimits> = {
  maxEntries: 2000,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
}

export type ZipErrorCode = 'truncated' | 'zip64' | 'encrypted' | 'unsupported_method' | 'corrupt' | 'too_large' | 'too_many'

export class ZipError extends Error {
  code: ZipErrorCode
  constructor(code: ZipErrorCode, message = '') {
    super(message || code)
    this.name = 'ZipError'
    this.code = code
  }
}

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const MAX_COMMENT = 0xffff

/** 浏览器原生 deflate 解压；不可用时抛错（由 UI 提示浏览器过旧）。 */
async function inflateRawDefault(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('unsupported_method', 'DecompressionStream unavailable')
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export interface ReadZipOptions extends ZipLimits {
  /** 测试 / 非浏览器环境可注入（Node 下用 `node:zlib.inflateRawSync`）。 */
  inflateRaw?: (data: Uint8Array) => Promise<Uint8Array>
}

/**
 * 读取 zip 的全部文件（目录条目跳过）。
 *
 * 只按中央目录取数据（不信任本地头里的长度），并校验本地头签名；
 * 超限直接抛 `too_large` / `too_many`，避免 zip bomb。
 */
export async function readZip(buffer: ArrayBuffer, options: ReadZipOptions = {}): Promise<ZipEntry[]> {
  const limits = { ...DEFAULT_LIMITS, ...options }
  const inflate = options.inflateRaw ?? inflateRawDefault
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  // 1) 找 EOCD（签名在文件尾 22 + 注释，最多 65557 字节内）。
  let eocd = -1
  const scanStart = Math.max(0, bytes.length - (22 + MAX_COMMENT))
  for (let i = bytes.length - 22; i >= scanStart; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('truncated')
  const count = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipError('zip64')
  if (count > limits.maxEntries) throw new ZipError('too_many')

  // 2) 遍历中央目录。
  const out: ZipEntry[] = []
  let total = 0
  let actualTotal = 0
  let offset = centralOffset
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIG) {
      throw new ZipError('corrupt')
    }
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const nameEnd = offset + 46 + nameLen
    if (nameEnd > bytes.length) throw new ZipError('truncated')
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, nameEnd)).replace(/\\/g, '/')
    offset = nameEnd + extraLen + commentLen

    if (flags & 0x1) throw new ZipError('encrypted')
    if (name.endsWith('/')) continue
    if (uncompressedSize > limits.maxFileBytes) throw new ZipError('too_large')
    total += uncompressedSize
    if (total > limits.maxTotalBytes) throw new ZipError('too_large')

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ZipError('corrupt')
    }
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) throw new ZipError('truncated')
    const raw = bytes.subarray(dataStart, dataEnd)

    let data: Uint8Array
    if (method === 0) data = raw
    else if (method === 8) data = await inflate(raw)
    else throw new ZipError('unsupported_method')

    if (uncompressedSize > 0 && data.length !== uncompressedSize) throw new ZipError('corrupt')
    // 以**真实**解压后大小再卡一次（中心目录的尺寸不可信，防 zip bomb）。
    if (data.length > limits.maxFileBytes) throw new ZipError('too_large')
    actualTotal += data.length
    if (actualTotal > limits.maxTotalBytes) throw new ZipError('too_large')
    out.push({ name, bytes: data })
  }
  return out
}
