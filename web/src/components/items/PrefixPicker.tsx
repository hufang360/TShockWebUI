import { useState } from 'react'
import { Check, Copy, Star, WandSparkles } from 'lucide-react'
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
import { useI18n } from '@/lib/i18n'
import { formatBenefit } from '@/lib/prefixes'
import { RECIPE_SECTION_TONE } from '@/lib/sectionTones'
import type { Dataset, Item, Prefix } from '@/types'

/** 「词缀」分区标题前的图标：1513（圣骑士锤），与标题的粉紫色同一件东西。 */
const PREFIX_ICON_ID = 1513

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
  /** 当前选中的词缀（用于显示标签）。 */
  prefix: Prefix | null
  /** 饰品不显示「最佳词缀」按钮。 */
  accessory: boolean
  dataset: Dataset
  /** 生成含词缀的物品标签（如 `[i/p1:5]`）。 */
  formatTag: (itemId: number, opts: { prefixId: number }) => string
}

/**
 * 物品词缀选择器（从 `ItemsPage` 详情抽屉抽出，见 docs/TODO.md U6）：
 * 与「用于合成」同一套可折叠分区（`DetailSection`，标题粉紫 = 游戏「神级」物品名色）。
 *
 * 分区内一行放两块：
 * - **左**：融合成一块的下拉 + ⚡（`wand-sparkles`，「最佳词缀」tooltip，一点即套用评分最高的词缀）；
 * - **右**：选中词缀后的标签（如 `[i/p59:1513]`），外观与交互同「相关指令」的条目
 *   （浅底、悬停加深、悬停出复制按钮）；手机放不下时自动落到下一行并占满宽度。
 */
export function PrefixPicker({
  item,
  prefixId,
  onPrefixChange,
  prefixRanks,
  bestPrefixIds,
  prefix,
  accessory,
  dataset,
  formatTag,
}: PrefixPickerProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const tag = prefix ? formatTag(item.id, { prefixId }) : ''
  const copyTag = async () => {
    if (!tag) return
    try {
      await navigator.clipboard.writeText(tag)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  /** 饰品不显示「最佳词缀」按钮：下拉里已带 ⭐ 与效果，足够明显。 */
  const showBest = bestPrefixIds.size > 0 && !accessory

  return (
    <DetailSection
      title={t('prefix.label')}
      tone={RECIPE_SECTION_TONE.prefix}
      iconId={PREFIX_ICON_ID}
      dataset={dataset}
    >
      <div className="flex flex-wrap items-stretch gap-2">
        {/* 下拉 + 最佳词缀按钮融合成一块（同一个 `bg-accent` 胶囊，中间不画分隔线）；
            桌面占半行宽，高度跟着右侧标签条目自动撑满（`items-stretch`，两边一样高） */}
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
                {prefixRanks.map(({ id, val }) => {
                  const pf = dataset.prefixesById.get(id)
                  if (!pf) return null
                  const mods = dataset.prefixModsById.get(id)
                  const isBest = bestPrefixIds.has(id)
                  return (
                    <SelectItem key={id} value={String(id)}>
                      <span className="flex items-center gap-1">
                        {isBest && <Star className="size-3 shrink-0 fill-current text-warning" />}
                        {pf.name}
                        {mods?.benefit ? (
                          <span className="text-muted-foreground">
                            {formatBenefit(mods.benefit, t)}
                          </span>
                        ) : val > 0 ? (
                          <span className="text-muted-foreground tabular-nums">
                            {val.toFixed(3)}
                          </span>
                        ) : null}
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
        {/* 含词缀标签：与「相关指令」条目同一套高度 / 底色，悬停出复制按钮 */}
        {prefix && (
          <div
            data-testid="prefix-tag"
            className={cn(
              'group/tag flex w-full min-w-0 items-center gap-2 rounded-control bg-accent/40 px-3 py-2',
              'transition-colors duration-150 hover:bg-accent sm:w-auto sm:flex-1',
            )}
          >
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{tag}</code>
            <span className="touch-visible flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/tag:opacity-100 group-focus-within/tag:opacity-100">
              <IconAction
                size="icon-xs"
                label={copied ? t('action.copied') : t('action.copy')}
                icon={copied ? Check : Copy}
                onClick={() => void copyTag()}
              />
            </span>
          </div>
        )}
      </div>
    </DetailSection>
  )
}
