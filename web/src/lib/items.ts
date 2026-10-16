import type { Item, Lang, ParsedItemTag } from '@/types'

/** 物品搜索：支持 ID / 当前语言名 / 内部名 / 标签（跨语言搜索已按约定降级）。 */
export function searchItems(items: Item[], query: string, limit = 30): Item[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const scored: { item: Item; score: number }[] = []
  const isNumeric = /^\d+$/.test(q)
  const numericId = isNumeric ? Number(q) : -1

  for (const item of items) {
    let score = -1
    if (isNumeric) {
      if (item.id === numericId) score = 0
      else if (String(item.id).startsWith(q)) score = 2
    }
    if (score < 0) {
      const key = item.key.toLowerCase()
      const name = item.name.toLowerCase()
      if (key === q || name === q) score = 1
      else if (key.startsWith(q) || name.startsWith(q)) score = 2
      else if (name.includes(q) || key.includes(q)) score = 3
      else if (item.tags.some((tag) => tag.toLowerCase().includes(q))) score = 4
    }
    if (score >= 0) scored.push({ item, score })
  }

  scored.sort((a, b) => a.score - b.score || a.item.id - b.item.id)
  return scored.slice(0, limit).map((s) => s.item)
}

/** 匹配一个物品标签内部的修饰符（s=数量，p=词缀）。 */
const TAG_RE = /\[i(?:tem)?([^:\]]*):(-?\d{1,4})\]/g

/**
 * 解析文本中的 [i:...] 标签，兼容：
 *   [i:29] [i/s10:29] [i/p81:4956] [i/s21/p81:4956] [i/p81,s21:4956]
 */
export function parseItemTags(text: string): ParsedItemTag[] {
  const found: ParsedItemTag[] = []
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(text)) !== null) {
    const modifiers = m[1] ?? ''
    const itemId = Number(m[2])
    if (!Number.isFinite(itemId) || itemId < 0) continue
    const stackMatch = /s(\d{1,4})/.exec(modifiers)
    const prefixMatch = /p(\d{1,3})/.exec(modifiers)
    found.push({
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      itemId,
      stack: stackMatch ? Number(stackMatch[1]) : undefined,
      prefixId: prefixMatch ? Number(prefixMatch[1]) : undefined,
    })
  }
  return found
}

export interface ItemTagOptions {
  stack?: number
  prefixId?: number
}

/**
 * 生成标准 TShock 物品标签。
 * 注意：这只影响聊天显示，不等于指令的物品参数（设计原则与约束 §6）。
 */
export function formatItemTag(itemId: number, options: ItemTagOptions = {}): string {
  const parts: string[] = []
  if (options.prefixId != null) parts.push(`p${options.prefixId}`)
  if (options.stack != null && options.stack > 1) parts.push(`s${options.stack}`)
  return parts.length > 0 ? `[i/${parts.join('/')}:${itemId}]` : `[i:${itemId}]`
}

export function itemDisplayName(item: Item | undefined, fallbackId: number): string {
  if (!item) return `未知物品 #${fallbackId}`
  return item.name || item.key
}

/**
 * 物品名颜色，复刻 `Main.MouseText_DrawItemTooltip_GetItemNameColor`（按稀有度 rare）。
 * 未命中任何档位的稀有度回退为白色。
 */
/**
 * Terraria Wiki 链接（实测均返回 200）：
 * - 中文：`https://terraria.wiki.gg/zh/wiki/铁镐`（用当前语言的物品名，如「八音盒（Boss 1）」）
 * - 英文：`https://terraria.wiki.gg/wiki/Iron_Pickaxe`（用当前语言的物品名，空格→下划线；
 *   官方英文名带括号/撇号时同样适用，如 `Music_Box_(Boss_1)`）
 *
 * 只用**当前语言**的显示名，因为数据集按语言只加载一份 `loc.<culture>.json`。
 */
export function wikiUrl(name: string, lang: Lang = 'zh'): string {
  const trimmed = name.trim()
  const slug = lang === 'en' ? trimmed.replace(/ /g, '_') : trimmed
  return `https://terraria.wiki.gg/${lang === 'en' ? '' : 'zh/'}wiki/${encodeURIComponent(slug)}`
}

export function rarityColor(rare: number): string {
  if (rare === -13) return '#FFC800' // 大师（255, masterColor*200, 0），近似
  if (rare === -12) return '#FF00FF' // 动态彩虹，取近似
  if (rare === -11) return '#FFAF00'
  if (rare === -1) return '#828282'
  if (rare === 1) return '#9696FF'
  if (rare === 2) return '#96FF96'
  if (rare === 3) return '#FFC896'
  if (rare === 4) return '#FF9696'
  if (rare === 5) return '#FF96FF'
  if (rare === 6) return '#D2A0FF'
  if (rare === 7) return '#96FF0A'
  if (rare === 8) return '#FFFF0A'
  if (rare === 9) return '#05C8FF'
  if (rare === 10) return '#FF2864'
  if (rare >= 11) return '#B428FF'
  return '#FFFFFF'
}
