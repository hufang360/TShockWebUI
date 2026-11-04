import { useState } from 'react'
import { Check, Copy, MessageSquare, WandSparkles } from 'lucide-react'
import { DetailSection } from '@/components/DetailSection'
import { IconAction } from '@/components/IconAction'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useChatSend } from '@/hooks/useChatSend'
import { useI18n } from '@/lib/i18n'
import { formatBenefit } from '@/lib/prefixes'
import { RECIPE_SECTION_TONE } from '@/lib/sectionTones'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset, Item, Prefix } from '@/types'

/** 有词缀时标题前的图标：1513（圣骑士锤），与标题的粉紫色同一件东西。 */
const PREFIX_ICON_ID = 1513
/** 没有词缀时标题前的图标：154（骨头）—— 这一档只讲「物品标签」。 */
const TAG_ICON_ID = 154

interface PrefixPickerProps {
  /** 当前物品（用于「含词缀标签」显示）。 */
  item: Item
  /** 当前词缀 id（0 = 无词缀）。 */
  prefixId: number
  onPrefixChange: (id: number) => void
  /** 该物品可滚动的词缀，已按游戏评分从高到低排序。 */
  prefixRanks: readonly { id: number; val: number }[]
  /** 评分最高的词缀 id（可能并列）。 */
  bestPrefixIds: Set<number>
  /** 当前选中的词缀（用于显示标签与广播文字）。 */
  prefix: Prefix | null
  /** 饰品不显示「最佳词缀」按钮。 */
  accessory: boolean
  /** 堆叠数量（1 = 无；从带 `sN` 的标签打开详情时才有）。 */
  stack?: number
  dataset: Dataset
  /** 生成含修饰符的物品标签（如 `[i/p59,s2:1513]`）。 */
  formatTag: (itemId: number, opts: { prefixId?: number; stack?: number }) => string
  /** 网页发言（「广播到游戏内」按钮用）；未提供时不渲染该按钮。 */
  transport?: BackendTransport | null
  /** 已登录才允许广播（网页发言要 token）。 */
  authenticated?: boolean
}

/**
 * 物品详情里的「词缀 / 物品标签」分区（从 `ItemsPage` 详情抽屉抽出，见 docs/TODO.md U6）：
 * 与「作为材料」同一套可折叠分区（`DetailSection`，标题粉紫 = 游戏「神级」物品名色）。
 *
 * 标题有**两态**（图标与文字一起换）：**能有词缀**（有下拉可选项）或已挂词缀 → 1513 +「词缀」；
 * 压根不能有词缀（盔甲等）→ 154 +「物品标签」。
 *
 * 一行两块，各占一半并排：
 * - **左**：融合成一块的下拉 + ⚡（`wand-sparkles`，「最佳词缀」tooltip，一点即套用评分最高的词缀）；
 *   下拉条目里带**词缀 ID**（`神级  59 · 1.455`），评分最高的那条用星星的琥珀色 + 加粗标出
 *   （原来条目左侧的 ⭐ 已去掉：图标占位置，颜色本身足够区分）；
 * - **右**：当前组合的标签（如 `[i/p59,s2:1513]`），悬停出复制与「广播到游戏内」两个按钮。
 *
 * tag 框**永远显示**（裸 `[i:ID]` 也能复制 / 广播）；没有可滚词缀时不画下拉（如盔甲）。
 */
export function PrefixPicker({
  item,
  prefixId,
  onPrefixChange,
  prefixRanks,
  bestPrefixIds,
  prefix,
  accessory,
  stack,
  dataset,
  formatTag,
  transport,
  authenticated = false,
}: PrefixPickerProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const { send, sending } = useChatSend({ transport: transport ?? null, toastOnError: true })
  const effectiveStack = stack != null && stack > 1 ? stack : undefined
  /** 当前是否挂着词缀。 */
  const hasPrefix = prefixId > 0 && prefix != null
  /** 这件物品**能**滚词缀（有下拉可选项）—— 即使当前选的是「无词缀」也算。 */
  const showSelect = prefixRanks.length > 0
  /**
   * 标题两态（图标 + 文字一起换）：
   * - 「词缀」= **这件物品可以有词缀**（哪怕当前没选，如铁斧默认无词缀）或已经挂了词缀；
   * - 「物品标签」= 它压根不能有词缀（盔甲等），这一档只讲标签。
   */
  const prefixSection = showSelect || hasPrefix
  const tag = formatTag(item.id, { prefixId: prefixId || undefined, stack: effectiveStack })
  /** 广播文字：`[i/p60,s2:1569]恶魔 吸血鬼刀(1569) x2`（词缀 / 数量有就带上）。 */
  const broadcastText = `${tag}${prefix ? `${prefix.name} ` : ''}${item.name}(${item.id})${
    effectiveStack ? ` x${effectiveStack}` : ''
  }`

  const copyTag = async () => {
    try {
      await navigator.clipboard.writeText(tag)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  /** 饰品不显示「最佳词缀」按钮：下拉里已带效果，足够明显。 */
  const showBest = bestPrefixIds.size > 0 && !accessory

  return (
    <DetailSection
      title={prefixSection ? t('prefix.label') : t('prefix.tagLabel')}
      tone={RECIPE_SECTION_TONE.prefix}
      iconId={prefixSection ? PREFIX_ICON_ID : TAG_ICON_ID}
      dataset={dataset}
    >
      <div className="flex flex-wrap items-stretch gap-2">
        {/* 下拉 + 最佳词缀按钮融合成一块（同一个 `bg-accent` 胶囊，中间不画分隔线）；
            桌面占半行宽，高度跟着右侧标签条目自动撑满（`items-stretch`，两边一样高） */}
        {showSelect && (
          <div
            data-testid="prefix-group"
            className="flex w-full min-w-0 items-center gap-0.5 rounded-control bg-accent p-0.5 sm:w-1/2"
          >
            <Select value={String(prefixId)} onValueChange={(v) => onPrefixChange(Number(v))}>
              <SelectTrigger
                size="sm"
                aria-label={t('prefix.label')}
                className="min-w-0 flex-1 bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[min(20rem,50vh)]">
                <SelectGroup>
                  <SelectItem value="0">{t('prefix.none')}</SelectItem>
                  {prefixRanks.map(({ id: rankId, val }) => {
                    const pf = dataset.prefixesById.get(rankId)
                    if (!pf) return null
                    const mods = dataset.prefixModsById.get(rankId)
                    const isBest = bestPrefixIds.has(rankId)
                    const effect = mods?.benefit
                      ? formatBenefit(mods.benefit, t)
                      : val > 0
                        ? val.toFixed(3)
                        : ''
                    return (
                      <SelectItem key={rankId} value={String(rankId)}>
                        {/* 评分最高的词缀用 ⭐ 的琥珀色 + 加粗（不再画星星图标） */}
                        <span className="flex items-center gap-1.5">
                          {/* 只有词缀名上色（评分最高的那条用 ⭐ 的琥珀色 + 加粗）；ID 与评分始终灰 */}
                          <span className={cn(isBest && 'font-semibold text-warning')}>
                            {pf.name}
                          </span>
                          <span className="font-pixel text-2xs text-muted-foreground">
                            {rankId}
                            {effect ? ` · ${effect}` : ''}
                          </span>
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>
            {showBest && (
              <IconAction
                size="icon-xs"
                label={t('prefix.best')}
                icon={WandSparkles}
                onClick={() => onPrefixChange([...bestPrefixIds][0]!)}
              />
            )}
          </div>
        )}
        {/* 标签条目：与「相关指令」同一套高度 / 底色，悬停出广播与复制按钮。
            裸 `[i:ID]`（无词缀无数量）也显示：聊天里直接插物品就得靠它。 */}
        <div
          data-testid="prefix-tag"
          className={cn(
            'group/tag flex w-full min-w-0 items-center gap-2 rounded-control bg-accent/40 px-3 py-2',
            'transition-colors duration-150 hover:bg-accent sm:w-auto sm:flex-1',
          )}
        >
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{tag}</code>
          <span className="touch-visible flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/tag:opacity-100 group-focus-within/tag:opacity-100">
            {transport && authenticated && (
              <IconAction
                size="icon-xs"
                label={t('prefix.broadcast')}
                icon={MessageSquare}
                disabled={sending}
                onClick={() => void send(broadcastText)}
              />
            )}
            <IconAction
              size="icon-xs"
              label={copied ? t('action.copied') : t('action.copy')}
              icon={copied ? Check : Copy}
              onClick={() => void copyTag()}
            />
          </span>
        </div>
      </div>
    </DetailSection>
  )
}
