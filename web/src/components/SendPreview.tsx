import { RichText } from '@/components/RichText'
import { useI18n } from '@/lib/i18n'
import { parseItemTags } from '@/lib/items'
import type { Atlas, Dataset, Item, Prefix } from '@/types'

/**
 * 输入框上方的「**发送内容预览**」。
 *
 * 为什么要有：`[i:29]` 这种标签在输入框里只是一串字符，发出去才变成图标；聊天又会被插件加前缀。
 * 所以这里按**实际会发出去的样子**渲染一行：
 *
 * - 指令：`/give [图标] hf 2`（标签渲染成物品图标，其余原样）；
 * - 聊天：`[WebUI] 玩家名: 你好 [图标]`（前缀 + 名字 + 内容）。
 *
 * 只在**有价值**的时候出现：指令里没有标签就不显示（预览和输入框会一模一样，纯噪声）；
 * 聊天一直显示（前缀与名字在别处看不到）。文字本身仍可编辑，这里只是照出来的影子。
 */
export function SendPreview({
  dataset,
  text,
  mode,
  username,
  chatPrefix,
}: {
  dataset: Dataset
  text: string
  mode: 'command' | 'chat'
  /** 当前登录玩家名（聊天预览要显示「谁说的」）。 */
  username?: string | null
  /** 插件实际使用的前缀（默认 `[WebUI]`；发过一次言后会用它学到真实值）。 */
  chatPrefix: string
}) {
  const { t } = useI18n()
  const trimmed = text.replace(/\s+$/, '')
  if (!trimmed.trim()) return null

  const hasTags = parseItemTags(text).length > 0
  // 指令：没有标签就没什么可预览的（和输入框完全一样）。
  if (mode === 'command' && !hasTags) return null

  const items = {
    itemsById: dataset.itemsById,
    prefixesById: dataset.prefixesById,
    atlas: dataset.atlas,
  } satisfies { itemsById: Map<number, Item>; prefixesById: Map<number, Prefix>; atlas?: Atlas }

  return (
    <div
      data-testid="send-preview"
      className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground"
      // 悬停看原始文本（没渲染的标签长什么样）。
      title={mode === 'chat' ? `${chatPrefix} ${username ?? ''}: ${trimmed}`.trim() : trimmed}
    >
      {mode === 'chat' ? (
        <>
          <span className="shrink-0 font-pixel text-muted-foreground/80">{chatPrefix}</span>
          <span className="shrink-0 text-foreground/70">
            {t('preview.chatBy', { name: username ?? t('preview.anonymous') })}
          </span>
        </>
      ) : null}
      <span className="min-w-0 truncate">
        <RichText text={trimmed} {...items} />
      </span>
    </div>
  )
}
