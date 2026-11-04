import type { LocalizationBundle } from '@/types'
import { readZip, type ReadZipOptions, ZipError } from './zip'

/**
 * 解析 Terraria 语言材质包（创意工坊 zip）。
 *
 * 支持两种本地化格式（实测，见 docs/计划-语言材质包.md §2.1）：
 * - JSON（1.4.4+）：`{"ItemName":{"Ruby":"红玉"},"ItemTooltip":{...}}`；
 * - CSV（1.4.2）：`key,translation`，扁平的 `ItemName.Ruby,红玉`（带 BOM）。
 *
 * 只读 `pack.json` 与 `Content/Localization/<culture>/*.{json,csv}`，
 * 其余文件（图标 / `.DepotDownloader` / 伪装成 Items 的仿冒文件）一律忽略。
 */

/** 允许覆盖的分类（其余分类（如 Bestiary 文本）本项目不展示，直接丢弃）。 */
export const LANGUAGE_PACK_CATEGORIES = [
  'ItemName',
  'Prefix',
  'NPCName',
  'BuffName',
  'MapObject',
  'Misc',
  'LegacyMisc',
  'ItemTooltip',
  'CommonItemTooltip',
  'LegacyTooltip',
  'GameUI',
  'LegacyInterface',
  'PaintingArtist',
  'BuffDescription',
] as const

const CATEGORY_SET = new Set<string>(LANGUAGE_PACK_CATEGORIES)
/** 不可信 JSON 里的原型键：不写入结果。 */
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export type LanguagePackFormat = 'json' | 'csv'

export interface LanguagePackMeta {
  name: string
  author?: string
  description?: string
  /** `pack.json` 的 `major.minor`（包自身版本，不是游戏版本）。 */
  version?: string
  steamId?: number
  format: LanguagePackFormat
  /** 包里实际存在的语言目录（如 `zh-Hans`）。 */
  cultures: string[]
  sourceName: string
  bytes: number
  importedAt: number
}

export interface ParsedLanguagePack extends LanguagePackMeta {
  /** culture → `{分类: {key: value}}`（只含白名单分类）。 */
  entries: Record<string, LocalizationBundle>
}

export type LanguagePackErrorCode =
  | 'not_zip'
  | 'no_pack'
  | 'bad_pack'
  | 'no_localization'
  | 'empty'
  | 'too_large'
  | 'unsupported_zip'

export class LanguagePackError extends Error {
  code: LanguagePackErrorCode
  constructor(code: LanguagePackErrorCode, message = '') {
    super(message || code)
    this.name = 'LanguagePackError'
    this.code = code
  }
}

/** 上传包大小上限（zip 字节数）。 */
export const MAX_PACK_BYTES = 20 * 1024 * 1024

export interface ParseOptions extends ReadZipOptions {
  /** 覆盖 `importedAt`（内置包用固定值，方便展示）。 */
  now?: number
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/** 标准 CSV（支持双引号转义、CRLF）。返回二维数组。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const src = stripBom(text)
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      quoted = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function addEntry(entries: LocalizationBundle, category: string, key: string, value: string): void {
  if (!CATEGORY_SET.has(category) || !key || UNSAFE_KEYS.has(key)) return
  if (typeof value !== 'string') return
  ;(entries[category] ||= {})[key] = value
}

function parseLocalizationJson(text: string): LocalizationBundle {
  let data: unknown
  try {
    data = JSON.parse(stripBom(text))
  } catch {
    return {}
  }
  const out: LocalizationBundle = {}
  if (!data || typeof data !== 'object') return out
  for (const [category, table] of Object.entries(data as Record<string, unknown>)) {
    if (!CATEGORY_SET.has(category) || !table || typeof table !== 'object') continue
    for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
      if (typeof value === 'string') addEntry(out, category, key, value)
    }
  }
  return out
}

function parseLocalizationCsv(text: string): LocalizationBundle {
  const out: LocalizationBundle = {}
  const rows = parseCsv(text)
  for (const row of rows) {
    if (row.length < 2) continue
    const key = row[0].trim()
    if (!key || key.toLowerCase() === 'key') continue
    const dot = key.indexOf('.')
    if (dot <= 0) continue
    addEntry(out, key.slice(0, dot), key.slice(dot + 1), row.slice(1).join(','))
  }
  return out
}

interface PackJson {
  Name?: unknown
  Author?: unknown
  Description?: unknown
  Version?: { major?: unknown; minor?: unknown }
}

interface WorkshopJson {
  SteamEntryId?: unknown
}

const dirname = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** 解析一个语言材质包；失败抛 `LanguagePackError`（UI 按 code 给提示）。 */
export async function parseLanguagePack(
  buffer: ArrayBuffer,
  sourceName: string,
  options: ParseOptions = {},
): Promise<ParsedLanguagePack> {
  if (buffer.byteLength > MAX_PACK_BYTES) throw new LanguagePackError('too_large')

  let files
  try {
    files = await readZip(buffer, options)
  } catch (err) {
    if (err instanceof ZipError) {
      const code: LanguagePackErrorCode =
        err.code === 'too_large' || err.code === 'too_many' ? 'too_large'
          : err.code === 'zip64' || err.code === 'encrypted' || err.code === 'unsupported_method'
            ? 'unsupported_zip'
            : 'not_zip'
      throw new LanguagePackError(code, err.message)
    }
    throw new LanguagePackError('not_zip')
  }

  // 1) 找层级最浅的 pack.json，它的目录就是包根（兼容创意工坊的 depot 包装层）。
  const packFiles = files
    .filter((f) => basename(f.name).toLowerCase() === 'pack.json')
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)
  const packFile = packFiles[0]
  if (!packFile) throw new LanguagePackError('no_pack')

  let packJson: PackJson
  try {
    packJson = JSON.parse(stripBom(new TextDecoder().decode(packFile.bytes))) as PackJson
  } catch {
    throw new LanguagePackError('bad_pack')
  }
  if (!packJson || typeof packJson !== 'object') throw new LanguagePackError('bad_pack')
  const name = typeof packJson.Name === 'string' && packJson.Name.trim()
    ? packJson.Name.trim()
    : basename(dirname(packFile.name).replace(/\/$/, '')) || '语言材质包'

  const root = dirname(packFile.name)
  const workshopFile = files.find((f) => f.name === `${root}workshop.json`)
  let steamId: number | undefined
  if (workshopFile) {
    try {
      const workshop = JSON.parse(stripBom(new TextDecoder().decode(workshopFile.bytes))) as WorkshopJson
      const id = Number(workshop.SteamEntryId)
      if (Number.isFinite(id) && id > 0) steamId = id
    } catch {
      /* 可缺 */
    }
  }

  // 2) 只认 Content/Localization/<culture>/<file>.{json,csv}。
  const locRe = /^Content\/Localization\/([^/]+)\/([^/]+)\.(json|csv)$/i
  const entries: Record<string, LocalizationBundle> = {}
  let format: LanguagePackFormat = 'json'
  for (const file of files) {
    if (!file.name.startsWith(root)) continue
    const rel = file.name.slice(root.length)
    const match = locRe.exec(rel)
    if (!match) continue
    const [, culture, , ext] = match
    const text = new TextDecoder().decode(file.bytes)
    const parsed = ext.toLowerCase() === 'csv' ? parseLocalizationCsv(text) : parseLocalizationJson(text)
    if (ext.toLowerCase() === 'csv') format = 'csv'
    if (Object.keys(parsed).length === 0) continue
    const target = (entries[culture] ||= {})
    for (const [category, table] of Object.entries(parsed)) {
      Object.assign((target[category] ||= {}), table)
    }
  }

  const cultures = Object.keys(entries).filter((c) => Object.keys(entries[c]).length > 0)
  if (cultures.length === 0) throw new LanguagePackError('no_localization')

  const version = packJson.Version && typeof packJson.Version === 'object'
    ? [packJson.Version.major, packJson.Version.minor].filter((v) => typeof v === 'number').join('.')
    : undefined

  const meta: LanguagePackMeta = {
    name,
    author: typeof packJson.Author === 'string' && packJson.Author.trim() ? packJson.Author.trim() : undefined,
    description: typeof packJson.Description === 'string' && packJson.Description.trim() ? packJson.Description.trim() : undefined,
    version: version || undefined,
    steamId,
    format,
    cultures,
    sourceName,
    bytes: buffer.byteLength,
    importedAt: options.now ?? Date.now(),
  }

  return { ...meta, entries }
}

/** 某语言下各分类的词条数（UI 展示用）。 */
export function packEntryCounts(
  pack: ParsedLanguagePack,
  culture: string,
): { itemName: number; itemTooltip: number; npcName: number; total: number } {
  const entries = pack.entries[culture] ?? {}
  const count = (category: string) => Object.keys(entries[category] ?? {}).length
  const total = Object.values(entries).reduce((sum, table) => sum + Object.keys(table).length, 0)
  return {
    itemName: count('ItemName'),
    itemTooltip: count('ItemTooltip'),
    npcName: count('NPCName'),
    total,
  }
}
