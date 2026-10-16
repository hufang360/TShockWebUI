import type { LocalizationBundle } from '@/types'

const BASE = import.meta.env.BASE_URL

/**
 * 解析配方组这类「官方本地化 key」：
 * - `Category.Key`（如 `ItemName.Wood` / `NPCName.Turtle` / `Misc.Macaw`）
 * - `Lang.misc[N]`（旧式 misc）→ `LegacyMisc.N`
 */
export function locText(loc: LocalizationBundle, key: string | undefined | null): string | undefined {
  if (!key) return undefined
  const legacy = /^Lang\.misc\[(\d+)\]$/.exec(key)
  if (legacy) return loc.LegacyMisc?.[legacy[1]]
  const dot = key.indexOf('.')
  if (dot < 0) return undefined
  return loc[key.slice(0, dot)]?.[key.slice(dot + 1)]
}

// 英文物品名是 TShock 指令（按服务器语言解析）的引用名。
// 中文界面下不常驻，点到「插入英文名」时再加载一次并缓存。
let englishLoc: Promise<LocalizationBundle> | null = null

export function loadEnglishLoc(): Promise<LocalizationBundle> {
  if (!englishLoc) {
    englishLoc = fetch(`${BASE}data/loc.en-US.json`, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`加载 loc.en-US.json 失败：HTTP ${res.status}`)
        return res.json() as Promise<LocalizationBundle>
      })
      .catch((err: unknown) => {
        englishLoc = null
        throw err
      })
  }
  return englishLoc
}

/** 取物品的英文显示名（失败回退到内部名）。 */
export async function englishItemName(key: string): Promise<string> {
  try {
    const loc = await loadEnglishLoc()
    return loc.ItemName?.[key] ?? key
  } catch {
    return key
  }
}
