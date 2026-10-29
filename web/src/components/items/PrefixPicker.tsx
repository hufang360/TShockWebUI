import { useState } from 'react'
import { Check, Copy, Star } from 'lucide-react'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { formatBenefit } from '@/lib/prefixes'
import type { Dataset, Item, Prefix } from '@/types'

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
  bestPrefixNames: string[]
  /** 当前选中的词缀（用于显示标签）。 */
  prefix: Prefix | null
  /** 饰品不显示「最佳词缀」行。 */
  accessory: boolean
  dataset: Dataset
  /** 生成含词缀的物品标签（如 `[i/p1:5]`）。 */
  formatTag: (itemId: number, opts: { prefixId: number }) => string
}

/**
 * 物品词缀选择器（从 `ItemsPage` 详情抽屉抽出，见 docs/TODO.md U6）：
 * 下拉按游戏词缀评分排序，⭐ = 顶级；下方可一键切到最佳词缀。
 */
export function PrefixPicker({
  item,
  prefixId,
  onPrefixChange,
  prefixRanks,
  bestPrefixIds,
  bestPrefixNames,
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

  return (
    <div className="flex w-40 shrink-0 flex-col gap-1.5 rounded-lg bg-accent/50 p-2 text-xs text-muted-foreground">
      <span className="shrink-0">{t('prefix.label')}</span>
      <Select value={String(prefixId)} onValueChange={(v) => onPrefixChange(Number(v))}>
        <SelectTrigger size="sm" aria-label={t('prefix.label')} className="max-w-full">
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
                      <span className="text-muted-foreground tabular-nums">{val.toFixed(3)}</span>
                    ) : null}
                  </span>
                </SelectItem>
              )
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
      {/* 饰品不显示「最佳词缀」行：下拉里已带 ⭐ 与效果，足够明显。 */}
      {bestPrefixIds.size > 0 && !accessory && (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-sm text-left underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t('prefix.bestHint')}
          onClick={() => onPrefixChange([...bestPrefixIds][0]!)}
        >
          {t('prefix.best')}：{bestPrefixNames.join(' / ')}
        </button>
      )}
      {prefix && (
        <div className="flex min-w-0 items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded bg-accent px-1.5 py-0.5 font-pixel text-2xs text-foreground">
            {tag}
          </code>
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={t('prefix.copyTag')}
            title={t('prefix.copyTag')}
            onClick={() => void copyTag()}
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
        </div>
      )}
    </div>
  )
}
