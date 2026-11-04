import { readJson, StorageKeys, writeJson } from '@/lib/storage'
import type { LocalizationBundle } from '@/types'
import {
  parseLanguagePack,
  type ParsedLanguagePack,
} from './parse'

/**
 * 语言材质包的本地保存：
 * - 解析后的词条放 **IndexedDB**（一个 Potralia 包约 1.2MB，localStorage 放不下）；
 * - 启用状态 / 优先级顺序放 localStorage（纯界面偏好）。
 *
 * 只存当前浏览器，不上传服务器（设计原则与约束 §4.6）。
 */

export const BUILTIN_PACK_ID = 'builtin:2447707451'
/** 内置包：作者自制的「1.4.2 汉化修正」（随前端产物下发，不写 IndexedDB）。 */
export const BUILTIN_PACK_URL = 'data/langpacks/2447707451.zip'

export interface StoredLanguagePack extends ParsedLanguagePack {
  id: string
  builtin?: boolean
}

export interface LanguagePackPrefs {
  /** 列表顺序（靠上的优先级高）。 */
  order: string[]
  enabled: string[]
}

const DB_NAME = 'tswui'
const DB_VERSION = 1
const STORE_NAME = 'languagePacks'

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!indexedDbAvailable()) return Promise.reject(new Error('indexedDB unavailable'))
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
      req.onblocked = () => reject(new Error('indexedDB blocked'))
    }).catch((err: unknown) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'))
  })
}

export async function listStoredPacks(): Promise<StoredLanguagePack[]> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const all = await requestToPromise(tx.objectStore(STORE_NAME).getAll() as IDBRequest<StoredLanguagePack[]>)
  return all.sort((a, b) => a.importedAt - b.importedAt)
}

export async function putStoredPack(pack: StoredLanguagePack): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  await requestToPromise(tx.objectStore(STORE_NAME).put(pack))
}

export async function deleteStoredPack(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  await requestToPromise(tx.objectStore(STORE_NAME).delete(id))
}

/** 内容哈希（去重 / 稳定 id）。没有 SubtleCrypto 时退化为长度 + 简易校验和。 */
export async function packId(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
  }
  const bytes = new Uint8Array(buffer)
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < bytes.length; i += 1) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0
    h2 = Math.imul(h2 + bytes[i], 0x85ebca6b) >>> 0
  }
  return `f${bytes.length.toString(16)}${h1.toString(16)}${h2.toString(16)}`
}

export function readPackPrefs(): LanguagePackPrefs {
  const raw = readJson<Partial<LanguagePackPrefs>>(StorageKeys.languagePacks, {})
  const order = Array.isArray(raw.order) ? raw.order.filter((x): x is string => typeof x === 'string') : []
  const enabled = Array.isArray(raw.enabled) ? raw.enabled.filter((x): x is string => typeof x === 'string') : []
  return { order, enabled }
}

export function writePackPrefs(prefs: LanguagePackPrefs): void {
  writeJson(StorageKeys.languagePacks, prefs)
}

/** 丢掉已经不存在的包；内置包还没有顺序时排在第一位。 */
export function sanitizePackPrefs(prefs: LanguagePackPrefs, ids: string[]): LanguagePackPrefs {
  const known = new Set(ids)
  const order = prefs.order.filter((id) => known.has(id))
  for (const id of ids) if (!order.includes(id)) order.push(id)
  const enabled = prefs.enabled.filter((id) => known.has(id))
  return { order, enabled }
}

let builtinPromise: Promise<StoredLanguagePack> | null = null

/** 内置包按需 fetch + 解析（不写 IndexedDB）。 */
export function loadBuiltinPack(): Promise<StoredLanguagePack> {
  if (!builtinPromise) {
    const url = `${import.meta.env.BASE_URL}${BUILTIN_PACK_URL}`
    builtinPromise = fetch(url, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`内置材质包加载失败：HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buffer) => parseLanguagePack(buffer, '2447707451.zip', { now: 0 }))
      .then((pack) => ({ ...pack, id: BUILTIN_PACK_ID, builtin: true }))
      .catch((err: unknown) => {
        builtinPromise = null
        throw err
      })
  }
  return builtinPromise
}

/**
 * 按优先级合并多个包的词条（只取 `culture` 这一份）。
 * 同一个 `(分类, key)` **先到先得**，即列表靠上的包胜出。
 */
export function mergePacks(packs: StoredLanguagePack[], culture: string): LocalizationBundle | undefined {
  const merged: LocalizationBundle = {}
  const unsafe = new Set(['__proto__', 'prototype', 'constructor'])
  let any = false
  for (const pack of packs) {
    const entries = pack.entries[culture]
    if (!entries) continue
    for (const [category, table] of Object.entries(entries)) {
      const target = (merged[category] ||= {})
      for (const [key, value] of Object.entries(table)) {
        if (unsafe.has(key) || Object.prototype.hasOwnProperty.call(target, key)) continue
        target[key] = value
        any = true
      }
    }
  }
  return any ? merged : undefined
}
