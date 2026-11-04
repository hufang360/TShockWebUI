import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/ui'
import { translate } from '@/lib/i18n'
import type { Lang, LocalizationBundle } from '@/types'
import { cultureOf } from '@/lib/dataset'
import {
  LanguagePackError,
  MAX_PACK_BYTES,
  packEntryCounts,
  parseLanguagePack,
  type LanguagePackFormat,
} from './parse'
import {
  BUILTIN_PACK_ID,
  deleteStoredPack,
  listStoredPacks,
  loadBuiltinPack,
  mergePacks,
  packId,
  putStoredPack,
  readPackPrefs,
  sanitizePackPrefs,
  writePackPrefs,
  type LanguagePackPrefs,
  type StoredLanguagePack,
} from './store'

/**
 * 设置页「语言材质包」的控制器：读 / 存 / 合并 / 导入都在这。
 *
 * 只存本机浏览器：词条进 IndexedDB，启用顺序进 localStorage。
 * `overrides` 是当前界面语言下的**合并覆盖层**（靠上的包优先），
 * 交给 `loadDataset(lang, overrides)` 应用。
 */

export interface LanguagePackSummary {
  id: string
  name: string
  author?: string
  version?: string
  description?: string
  format: LanguagePackFormat
  cultures: string[]
  builtin: boolean
  sourceName: string
  bytes: number
  enabled: boolean
  /** 当前界面语言在这个包里有没有文本。 */
  hasCulture: boolean
  counts: { itemName: number; itemTooltip: number; npcName: number; total: number }
}

export interface LanguagePacksController {
  packs: LanguagePackSummary[]
  /** 读完了存储（首屏数据集要等它，避免先无包再重载）。 */
  ready: boolean
  busy: boolean
  /** IndexedDB 不可用（隐私模式）：本次会话仍可临时应用，但关掉浏览器就没了。 */
  storageAvailable: boolean
  overrides: LocalizationBundle | undefined
  importFile: (file: File) => Promise<void>
  setEnabled: (id: string, on: boolean) => void
  move: (id: string, delta: number) => void
  remove: (id: string) => void
}

const BUILTIN_FALLBACK: Omit<LanguagePackSummary, 'enabled' | 'hasCulture' | 'counts'> = {
  id: BUILTIN_PACK_ID,
  name: '1.4.2 汉化修正',
  author: 'hufang360',
  version: '1.1',
  format: 'csv',
  cultures: ['zh-Hans'],
  builtin: true,
  sourceName: '2447707451.zip',
  bytes: 11356,
}

const EMPTY_COUNTS = { itemName: 0, itemTooltip: 0, npcName: 0, total: 0 }

function summaryOf(pack: StoredLanguagePack, culture: string, enabled: boolean): LanguagePackSummary {
  return {
    id: pack.id,
    name: pack.name,
    author: pack.author,
    version: pack.version,
    description: pack.description,
    format: pack.format,
    cultures: pack.cultures,
    builtin: pack.builtin === true,
    sourceName: pack.sourceName,
    bytes: pack.bytes,
    enabled,
    hasCulture: Boolean(pack.entries[culture]),
    counts: packEntryCounts(pack, culture),
  }
}

/** 没有提供控制器时的空实现（仅测试 / 嵌入用；生产由 App 注入）。 */
export const NO_LANGUAGE_PACKS: LanguagePacksController = {
  packs: [],
  ready: true,
  busy: false,
  storageAvailable: true,
  overrides: undefined,
  importFile: async () => {},
  setEnabled: () => {},
  move: () => {},
  remove: () => {},
}

function errorCode(err: unknown): string {
  if (err instanceof LanguagePackError) return err.code
  return 'unknown'
}

export function useLanguagePacks(lang: Lang): LanguagePacksController {
  const culture = cultureOf(lang)
  const [stored, setStored] = useState<StoredLanguagePack[]>([])
  const [builtin, setBuiltin] = useState<StoredLanguagePack | null>(null)
  const [prefs, setPrefs] = useState<LanguagePackPrefs>(() => readPackPrefs())
  const [storedLoaded, setStoredLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [storageAvailable, setStorageAvailable] = useState(true)
  // 内置包解析失败（文件缺失等）也算「读完了」，否则首屏会一直等。
  const [builtinSettled, setBuiltinSettled] = useState(false)
  const builtinRequested = useRef(false)

  const builtinEnabled = prefs.enabled.includes(BUILTIN_PACK_ID)

  const updatePrefs = useCallback((fn: (prev: LanguagePackPrefs) => LanguagePackPrefs) => {
    setPrefs((prev) => fn(prev))
  }, [])

  // 1) 已导入的包；顺手把偏好里失效的 id 清掉、补上内置包的位置（只做一次）。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await listStoredPacks()
        if (cancelled) return
        setStored(list)
        setPrefs((prev) => sanitizePackPrefs(prev, [BUILTIN_PACK_ID, ...list.map((p) => p.id)]))
      } catch {
        if (!cancelled) setStorageAvailable(false)
      } finally {
        if (!cancelled) setStoredLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 2) 内置包按需拉取（启用时才下载）
  useEffect(() => {
    if (!builtinEnabled || builtin || builtinRequested.current) return
    builtinRequested.current = true
    let cancelled = false
    void loadBuiltinPack()
      .then((pack) => {
        if (!cancelled) setBuiltin(pack)
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(translate(lang, 'langpack.error.builtin'))
          updatePrefs((prev) => ({ ...prev, enabled: prev.enabled.filter((id) => id !== BUILTIN_PACK_ID) }))
        }
      })
      .finally(() => {
        builtinRequested.current = false
        if (!cancelled) setBuiltinSettled(true)
      })
    return () => {
      cancelled = true
    }
  }, [builtinEnabled, builtin, updatePrefs, lang])

  // 偏好变更统一落盘（不在 setState updater 里做副作用）。
  useEffect(() => {
    writePackPrefs(prefs)
  }, [prefs])

  const byId = useMemo(() => {
    const map = new Map<string, StoredLanguagePack>()
    if (builtin) map.set(builtin.id, builtin)
    for (const pack of stored) map.set(pack.id, pack)
    return map
  }, [builtin, stored])

  const packs = useMemo<LanguagePackSummary[]>(() => {
    const list: LanguagePackSummary[] = []
    const seen = new Set<string>()
    for (const id of prefs.order) {
      const pack = byId.get(id)
      if (pack) {
        list.push(summaryOf(pack, culture, prefs.enabled.includes(id)))
      } else if (id === BUILTIN_PACK_ID) {
        // 内置包未下载：也始终显示在列表里（默认不启用，用户可勾选）。
        list.push({
          ...BUILTIN_FALLBACK,
          enabled: prefs.enabled.includes(BUILTIN_PACK_ID),
          hasCulture: BUILTIN_FALLBACK.cultures.includes(culture),
          counts: EMPTY_COUNTS,
        })
      }
      seen.add(id)
    }
    // 兜底：存储里存在但顺序表没有的（极少见）追加到末尾。
    for (const pack of stored) {
      if (seen.has(pack.id)) continue
      list.push(summaryOf(pack, culture, prefs.enabled.includes(pack.id)))
    }
    return list
  }, [prefs, byId, stored, culture])

  const overrides = useMemo(() => {
    const active = prefs.order
      .filter((id) => prefs.enabled.includes(id))
      .map((id) => byId.get(id))
      .filter((p): p is StoredLanguagePack => p != null)
    return mergePacks(active, culture)
  }, [prefs, byId, culture])

  const importFile = useCallback(
    async (file: File) => {
      setBusy(true)
      try {
        if (file.size > MAX_PACK_BYTES) throw new LanguagePackError('too_large')
        const buffer = await file.arrayBuffer()
        const parsed = await parseLanguagePack(buffer, file.name)
        const id = await packId(buffer)
        const pack: StoredLanguagePack = { ...parsed, id }

        // 先落盘再更新内存（落盘失败仍允许本次会话使用）。
        try {
          await putStoredPack(pack)
        } catch {
          setStorageAvailable(false)
        }
        setStored((prev) => [...prev.filter((p) => p.id !== id), pack])
        updatePrefs((prevPrefs) => ({
          order: [...prevPrefs.order.filter((x) => x !== id), id],
          enabled: [...new Set([...prevPrefs.enabled, id])],
        }))
        toast.success(translate(lang, 'langpack.added', { name: pack.name }))
      } catch (err) {
        toast.error(translate(lang, `langpack.error.${errorCode(err)}`))
      } finally {
        setBusy(false)
      }
    },
    [updatePrefs, lang],
  )

  const setEnabled = useCallback(
    (id: string, on: boolean) => {
      updatePrefs((prev) => ({
        ...prev,
        enabled: on ? [...new Set([...prev.enabled, id])] : prev.enabled.filter((x) => x !== id),
      }))
    },
    [updatePrefs],
  )

  const move = useCallback(
    (id: string, delta: number) => {
      updatePrefs((prev) => {
        const from = prev.order.indexOf(id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= prev.order.length) return prev
        const order = [...prev.order]
        const [item] = order.splice(from, 1)
        order.splice(to, 0, item)
        return { ...prev, order }
      })
    },
    [updatePrefs],
  )

  const remove = useCallback(
    (id: string) => {
      if (id === BUILTIN_PACK_ID) return
      setStored((prev) => prev.filter((p) => p.id !== id))
      updatePrefs((prev) => ({
        order: prev.order.filter((x) => x !== id),
        enabled: prev.enabled.filter((x) => x !== id),
      }))
      void deleteStoredPack(id).catch(() => setStorageAvailable(false))
    },
    [updatePrefs],
  )

  const ready = storedLoaded && (!builtinEnabled || builtin != null || builtinSettled)

  return { packs, ready, busy, storageAvailable, overrides, importFile, setEnabled, move, remove }
}
