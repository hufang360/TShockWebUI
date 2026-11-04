import type { CSSProperties } from 'react'
import { useMemo } from 'react'
import { Info, Star } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { useItemDetail } from '@/lib/itemDetailContext'
import { useItemFavorites } from '@/lib/itemFavoritesContext'
import { rarityColor } from '@/lib/items'
import { closeItemTooltip } from '@/lib/itemTooltipBus'
import { parseRichText } from '@/lib/richtext'
import { prefixDeltaLines } from '@/lib/prefixes'
import type { Atlas, Item, ItemStatEntry, Prefix, PrefixMods } from '@/types'

const EMPTY_LINES: string[] = []

/** 速度档位（`LegacyTooltip.6`–`.13`）：复刻 gen-item-stats.mjs。 */
function speedTier(useAnimation: number): number {
  return useAnimation <= 8 ? 0 : useAnimation <= 20 ? 1 : useAnimation <= 25 ? 2
    : useAnimation <= 30 ? 3 : useAnimation <= 35 ? 4 : useAnimation <= 45 ? 5
      : useAnimation <= 55 ? 6 : 7
}

/** 击退档位（`LegacyTooltip.14`–`.22`）：复刻 gen-item-stats.mjs。 */
function kbTier(knockBack: number): number {
  return knockBack === 0 ? 0 : knockBack <= 1.5 ? 1 : knockBack <= 3 ? 2
    : knockBack <= 4 ? 3 : knockBack <= 6 ? 4 : knockBack <= 7 ? 5
      : knockBack <= 9 ? 6 : knockBack <= 11 ? 7 : 8
}

/** 按词缀修正重算属性行（伤害 / 暴击 / 速度 / 击退）。 */
function applyPrefix(
  lines: string[],
  stats: Record<string, number | boolean> | undefined,
  mods: PrefixMods,
  speedWords: string[],
  kbWords: string[],
): string[] {
  if (lines.length === 0) return lines
  const speedSet = new Set(speedWords)
  const kbSet = new Set(kbWords)
  const baseDmg = Number(/^\d+/.exec(lines[0])?.[0] ?? NaN)
  const newDmg = Number.isFinite(baseDmg) ? Math.round(baseDmg * (mods.dmg ?? 1)) : null
  const baseCrit = /^\d+%/.test(lines[1] ?? '') ? Number(/^\d+/.exec(lines[1])![0]) : null
  const newCrit = baseCrit != null ? baseCrit + (mods.crt ?? 0) : null
  const anim = typeof stats?.useAnimation === 'number' ? stats.useAnimation : 0
  const kb = typeof stats?.knockBack === 'number' ? stats.knockBack : 0
  const newAnim = anim > 0 ? Math.round(anim * (mods.spd ?? 1)) : anim
  const newKb = kb * (mods.kb ?? 1)
  return lines.map((line, idx) => {
    if (idx === 0 && newDmg != null && newDmg !== baseDmg) return line.replace(/^\d+/, String(newDmg))
    if (idx === 1 && newCrit != null && newCrit !== baseCrit) return line.replace(/^\d+/, String(newCrit))
    if (speedSet.has(line)) return speedWords[speedTier(newAnim)]
    if (kbSet.has(line)) return kbWords[kbTier(newKb)]
    return line
  })
}

/**
 * 词缀会改变物品稀有度（`Item.Prefix()`）：value ≥ 1.2 → rare+2，≥ 1.05 → +1，
 * ≤ 0.8 → -2，≤ 0.95 → -1（然后按游戏规则夹到 [-1, 11]）。名称颜色随 rare 变。
 */
function prefixedRare(baseRare: number, val: number | undefined): number {
  if (typeof val !== 'number') return baseRare
  let r = baseRare
  if (val >= 1.2) r += 2
  else if (val >= 1.05) r += 1
  else if (val <= 0.8) r -= 2
  else if (val <= 0.95) r -= 1
  if (r > -11) {
    if (r < -1) r = -1
    if (r > 11) r = 11
  }
  return r
}

/**
 * 游戏同款物品提示（**全项目唯一的一套样式**：图标 28px / 名称 15px semibold / 属性行 14px / 页脚 12px）。
 *
 * 事实来源：`Terraria.Main.MouseText_DrawItemTooltip_GetLinesInfo`（属性行文本由 tools/gen-item-stats.mjs 生成）；
 * 底色为半透明黑 `bg-black/85`（**不加模糊**），左下角固定显示 `ID · key`。
 */
interface ItemTooltipContentProps {
  item: Item
  atlas?: Atlas
  stat?: ItemStatEntry
  prefix?: string | null
  /** 词缀数值修正（有则在提示里重算伤害/暴击/速度/击退）。 */
  prefixMods?: PrefixMods
  stack?: number
  /** 覆盖显示名（默认 item.name）。 */
  name?: string
  /** tooltip：深色浮层（默认）；panel：浅色内联区域（详情页可复用）。 */
  variant?: 'tooltip' | 'panel'
  /** 隐藏顶部「图标 + 名称」行（只留属性行 + ID · key 时用）。 */
  hideHeader?: boolean
  /** 额外类名（如抽屉/详情里改为通栏：`w-full max-w-none`）。 */
  className?: string
  style?: CSSProperties
  /**
   * 不显示右上角的「物品详情」入口。**物品详情抽屉里的那份 tips 要传 true**——
   * 它本来就指向自己，点了再开一层没有意义。
   */
  hideDetailLink?: boolean
}

export function ItemTooltipContent({
  item,
  atlas,
  stat,
  prefix,
  prefixMods,
  stack,
  name,
  variant = 'tooltip',
  hideHeader = false,
  className,
  style,
  hideDetailLink = false,
}: ItemTooltipContentProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  const favorites = useItemFavorites()
  const detail = useItemDetail()
  const favorited = favorites ? favorites.isFavorited(item.id) : false
  // tip 行在载入数据集时已按当前界面语言解析好（有语言材质包时按合并后的文本重算过）。
  const baseLines = stat?.tip ?? EMPTY_LINES
  // 速度 / 击退档位词取自数据集（可能被材质包改写），与提示行同一来源；缺表时回退 i18n。
  const words = useMemo(() => {
    const lt = dataset?.loc.LegacyTooltip
    return {
      speed: Array.from({ length: 8 }, (_, i) => lt?.[String(6 + i)] ?? t(`prefix.speed.${i}`)),
      kb: Array.from({ length: 9 }, (_, i) => lt?.[String(14 + i)] ?? t(`prefix.kb.${i}`)),
    }
  }, [dataset?.loc, t])
  // 选了词缀就用修正重算属性行（伤害/暴击/速度/击退），并补上「变化行」（红/绿）。
  const lines = useMemo(
    () =>
      prefix && prefixMods
        ? applyPrefix(baseLines, stat?.stats, prefixMods, words.speed, words.kb)
        : baseLines,
    [baseLines, stat?.stats, prefix, prefixMods, words],
  )
  /** 词缀相对未附词缀物品的变化行（+15%伤害 / -10%速度 …），颜色复刻游戏。 */
  const deltaLines = useMemo(
    () => (prefix && prefixMods ? prefixDeltaLines(stat?.stats, prefixMods, t) : []),
    [prefix, prefixMods, stat?.stats, t],
  )
  const rare = prefixedRare(
    typeof stat?.stats?.rare === 'number' ? stat.stats.rare : 0,
    prefixMods?.val,
  )
  const showStack = stack != null && stack > 1
  // 游戏 tooltip 的伤害/暴击/击退/蓝耗按当前角色属性重算，图鉴只给物品基础值；
  // 对含这些行的物品补一句说明，避免误以为图鉴数值有误（见 docs/功能-合成表与物品提示.md §7）。
  const showBaseNote =
    (typeof stat?.stats?.damage === 'number' && stat.stats.damage > 0) ||
    (typeof stat?.stats?.mana === 'number' && stat.stats.mana > 0)

  if (variant === 'panel') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ItemIcon item={item} atlas={atlas} size={28} tooltip={false} />
          <span className="text-[15px] font-semibold" style={{ color: rarityColor(rare) }}>
            {prefix ? <span className="text-amber-300">{prefix} </span> : null}
            {name ?? item.name}
          </span>
          {showStack ? (
            <span className="font-pixel text-sm text-muted-foreground">x{stack}</span>
          ) : null}
        </div>
        {(lines.length > 0 || deltaLines.length > 0) && (
          <div className="flex flex-col gap-0.5 text-sm leading-5 text-foreground/80">
            {lines.map((line, i) => (
              <p key={i}>
                <TipLine
                  text={line}
                  itemsById={dataset?.itemsById}
                  prefixesById={dataset?.prefixesById}
                  atlas={atlas}
                />
              </p>
            ))}
            {deltaLines.map((d, i) => (
              <p key={`d${i}`} style={{ color: d.tone === 'down' ? '#be7878' : '#78be78' }}>
                {d.text}
              </p>
            ))}
          </div>
        )}
        {showBaseNote && (
          <p className="text-xs text-muted-foreground">{t('tooltip.baseStatsNote')}</p>
        )}
        <IdKeyFooter item={item} className="text-muted-foreground" />
      </div>
    )
  }

  // 右上角的两个图标按钮：这是游戏同款物品提示（固定深色底、模仿游戏观感），**不能用 `IconAction`**：
  // 语义色令牌在这个深色底上不成立（`text-muted-foreground` 会看不见），所以颜色照游戏原样写死。
  // 尺寸对齐 `icon-xs` 的桌面值（24px），形状与聚焦环仍走项目令牌。
  const iconBtnClass = cn(
    'grid size-6 shrink-0 cursor-pointer place-items-center rounded-control transition-colors',
    'text-zinc-500 hover:bg-white/10',
    'focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none',
  )
  const favoriteButton = favorites ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        favorites.toggle(item.id)
      }}
      aria-label={favorited ? t('tooltip.unfavorite') : t('tooltip.favorite')}
      aria-pressed={favorited}
      title={favorited ? t('tooltip.unfavorite') : t('tooltip.favorite')}
      className={cn(iconBtnClass, 'hover:text-amber-300')}
    >
      <Star className={cn('size-4', favorited && 'fill-current text-warning')} />
    </button>
  ) : null
  /** 「物品详情」入口（替代原先藏在底部的「合成表」文字链接）：悬停出 Tooltip，点一下开详情。 */
  const detailButton = detail && !hideDetailLink ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              // 提示可能挂在可点击的格子上：别把点击冒泡成「选中格子」。
              e.stopPropagation()
              // 先收起提示：它是 z-[100]，会浮在随后打开的抽屉（z-50）上面。
              closeItemTooltip()
              detail.open(item.id)
            }}
            aria-label={t('dex.detail')}
            className={cn(iconBtnClass, 'hover:text-zinc-100')}
          >
            <Info className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        {/* 提示本体是 z-[100] 的自研浮层，内层 Tooltip 必须再高一层才看得见（与 `ItemTooltip` 同一类例外） */}
        <TooltipContent className="z-[110]">{t('dex.detail')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null
  /** 右上角操作区：⭐ 收藏 + ⓘ 物品详情。 */
  const tipActions =
    favoriteButton || detailButton ? (
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {favoriteButton}
        {detailButton}
      </span>
    ) : null

  return (
    <div
      data-testid="item-tooltip"
      className={cn(
        // 半透明黑（**不加模糊**：与游戏一样是纯半透明，紧跟在物品旁边时不会把背景完全挖掉）
        'max-w-96 rounded-control border border-white/15 bg-black/85 px-3 py-2.5 text-[15px] font-medium text-zinc-100 shadow-xl select-text',
        className,
      )}
      style={style}
    >
      {!hideHeader && (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <ItemIcon item={item} atlas={atlas} size={28} tooltip={false} />
          {prefix ? <span className="text-amber-300">{prefix}</span> : null}
          <span className="text-[15px] leading-6 font-semibold" style={{ color: rarityColor(rare) }}>
            {name ?? item.name}
          </span>
          {showStack ? <span className="font-pixel text-sm font-bold text-zinc-300">x{stack}</span> : null}
          {tipActions}
        </div>
      )}
      {hideHeader && tipActions && <div className="mb-1 flex items-center">{tipActions}</div>}
      {(lines.length > 0 || deltaLines.length > 0) && (
        <div
          className={cn(
            'flex flex-col gap-0.5 text-sm leading-5 text-zinc-300',
            !hideHeader && 'mt-1.5 border-t border-white/10 pt-1.5',
          )}
        >
          {lines.map((line, i) => (
            <p key={i}>
              <TipLine
                text={line}
                itemsById={dataset?.itemsById}
                prefixesById={dataset?.prefixesById}
                atlas={atlas}
              />
            </p>
          ))}
          {deltaLines.map((d, i) => (
            <p key={`d${i}`} style={{ color: d.tone === 'down' ? '#be7878' : '#78be78' }}>
              {d.text}
            </p>
          ))}
        </div>
      )}
      {showBaseNote && (
        <p className="mt-1 text-xs text-zinc-400/90">{t('tooltip.baseStatsNote')}</p>
      )}
      <IdKeyFooter item={item} className="text-zinc-400/90" />
    </div>
  )
}

/** 单行物品提示：解析材质包可能带来的 `[c/]` 颜色与 `[i:]` 物品标签（游戏同款）。 */
function TipLine({
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
  const tokens = useMemo(() => parseRichText(text), [text])
  // 无标签时直接输出原文；有标签但最后只剩一段文本时也要输出**去掉标签的**文本（不能回退成原文）。
  if (tokens.length === 1 && tokens[0].kind === 'text' && tokens[0].text === text) return <>{text}</>
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'color') {
          // tooltip 底色恒为深色，颜色按原值渲染（不用 `ts-chat-color` 的浅色主题压暗）。
          return (
            <span key={index} style={{ color: token.color }}>
              {token.text}
            </span>
          )
        }
        if (token.kind === 'item') {
          const target = itemsById?.get(token.itemId)
          if (!target) return <span key={index}>{token.raw}</span>
          const prefix = token.prefixId != null ? prefixesById?.get(token.prefixId)?.name : undefined
          return (
            <span key={index} className="mx-0.5 inline-flex items-center align-middle">
              <ItemIcon
                item={target}
                atlas={atlas}
                size={18}
                stack={token.stack}
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

/** 所有物品提示的左下角都显示「ID · key」（打开详情的入口在右上角 ⓘ）。 */
function IdKeyFooter({ item, className }: { item: Item; className?: string }) {
  return (
    <p
      className={cn(
        'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-pixel text-xs tracking-wide',
        className,
      )}
    >
      <span className="break-all">
        {item.id} · {item.key}
      </span>
    </p>
  )
}
