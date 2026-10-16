import { type CSSProperties } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { parseRichText } from '@/lib/richtext'
import type { Atlas, Item, Prefix } from '@/types'

/**
 * 把一行文本渲染为 Terraria 富文本：
 * - `[c/RRGGBB:text]` → 彩色文本（颜色标签；浅色主题下自动压暗以保证对比度）。
 * - `[i:ID]` / `[i/sN:ID]` 等 → 物品图标（需提供 itemsById + atlas；否则按原文显示；`sN` 会在图标右下角显示数量）。
 * - 其余按纯文本。
 *
 * 结果面板、首页卡片、服务器动态（聊天里也可能带 `[i:..]`）共用。
 */
export function RichText({
  text,
  itemsById,
  prefixesById,
  atlas,
}: {
  text: string
  itemsById?: Map<number, Item>
  prefixesById?: Map<number, Prefix>
  atlas?: Atlas
}) {
  const tokens = parseRichText(text)
  if (tokens.length === 1 && tokens[0].kind === 'text') return <>{text}</>
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'color') {
          return (
            <span
              key={index}
              className="ts-chat-color"
              style={{ '--ts-color': token.color } as CSSProperties}
            >
              {token.text}
            </span>
          )
        }
        if (token.kind === 'item') {
          if (!itemsById || !atlas) return <span key={index}>{token.raw}</span>
          const item = itemsById.get(token.itemId)
          const prefix =
            token.prefixId != null ? prefixesById?.get(token.prefixId)?.name : undefined
          return (
            <span key={index} className="mx-0.5 inline-flex items-center align-middle">
              {/* 24px 方框 = 游戏聊天里 [i:..] 的占位尺寸（32 × 0.75，ItemTagHandler.cs:52），
                  配 text-sm/leading-6（14px/24px）与游戏聊天行高比例一致；
                  数量字号上限 11px（默认公式在 24px 方框下会算到 13px，在正文行里偏大，
                  金币等小图标仍会得到更小的 9px）。
                  悬停提示用 `lg`：图标 28px、正文 14px（默认 md 是 18px / 12px，在结果面板里偏小）。 */}
              <ItemIcon
                item={item}
                atlas={atlas}
                size={24}
                stack={token.stack}
                maxStackSize={11}
                prefix={prefix}
              />
            </span>
          )
        }
        return <span key={index}>{token.text}</span>
      })}
    </>
  )
}
