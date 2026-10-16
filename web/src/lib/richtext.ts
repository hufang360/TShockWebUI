/**
 * Terraria 富文本解析（颜色 / 物品标签）。
 *
 * 事实来源（反编译 1.4.5.8，已核对）：
 * - `Terraria.UI.Chat.ChatManager.Regexes.Format`：
 *   `(?<!\\)\[(?<tag>[a-zA-Z]{1,10})(\/(?<options>[^:]+))?:(?<text>.+?)(?<!\\)\]`（Singleline）
 * - `Terraria.GameContent.UI.Chat.ColorTagHandler`：options 按十六进制解析为 RRGGBB。
 *
 * 与 Terraria 行为一致：
 * - 标签只作用于自身 `text`，**不向后延续**（后续文本回到默认色）。
 * - 未知标签 / 非法选项 → 丢弃标签外壳，按内部文本渲染。
 * - 支持 `\]` 转义；`\[` 前有反斜杠时不匹配。
 */

export type RichToken =
  | { kind: 'text'; text: string }
  | { kind: 'color'; color: string; text: string }
  | { kind: 'item'; raw: string; itemId: number; stack?: number; prefixId?: number }

const TAG_RE = /(?<!\\)\[([a-zA-Z]{1,10})(?:\/([^:]+))?:(.+?)(?<!\\)\]/gs
const HEX_RE = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** 3 位缩写展开为 6 位，统一成 `#RRGGBB`。 */
function normalizeHex(hex: string): string {
  const h = hex.toUpperCase()
  const full = h.length === 3 ? `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : h
  return `#${full}`
}

/** 解析一行文本为富文本片段序列。 */
export function parseRichText(text: string): RichToken[] {
  const tokens: RichToken[] = []
  let last = 0
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', text: text.slice(last, m.index) })
    const tag = m[1].toLowerCase()
    const options = m[2] ?? ''
    const inner = m[3].replace(/\\\]/g, ']')

    if (tag === 'i' || tag === 'item') {
      const itemId = Number(inner)
      if (Number.isFinite(itemId) && itemId >= 0) {
        const stack = /s(\d{1,4})/.exec(options)
        const prefix = /p(\d{1,3})/.exec(options)
        tokens.push({
          kind: 'item',
          raw: m[0],
          itemId,
          stack: stack ? Number(stack[1]) : undefined,
          prefixId: prefix ? Number(prefix[1]) : undefined,
        })
      } else {
        tokens.push({ kind: 'text', text: inner })
      }
    } else if ((tag === 'c' || tag === 'color') && HEX_RE.test(options)) {
      tokens.push({ kind: 'color', color: normalizeHex(options), text: inner })
    } else {
      tokens.push({ kind: 'text', text: inner })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}

/** 一行文本是否包含可解析的富文本标签。 */
export function hasRichTags(text: string): boolean {
  TAG_RE.lastIndex = 0
  return TAG_RE.test(text)
}
