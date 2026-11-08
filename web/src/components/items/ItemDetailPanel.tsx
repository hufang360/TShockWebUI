import { useCallback, useState } from 'react'
import { ChevronLeft, ExternalLink, X } from 'lucide-react'
import { CommandLine } from '@/components/CommandLine'
import { IconAction } from '@/components/IconAction'
import { ItemDropsPanel } from '@/components/ItemDropsPanel'
import { ItemIcon } from '@/components/ItemIcon'
import { ItemTooltipContent } from '@/components/ItemTooltipContent'
import { PrefixPicker } from '@/components/items/PrefixPicker'
import { RecipePanel } from '@/components/RecipePanel'
import { Button, DialogHeader, DialogTitle, DrawerHeader, DrawerTitle } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { formatItemTag, wikiUrl } from '@/lib/items'
import { rankPrefixes } from '@/lib/prefixes'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset, Item } from '@/types'
import { cn } from '@/lib/cn'

/** 合成表 / 掉落列表的只读显示选项；编辑入口在页面工具栏的「图鉴设置」Popover。 */
export interface ItemDetailRecipeOptions {
  /** 显示物品名称（默认不勾选 = 仅图标）。 */
  showItemNames: boolean
  /** 固定两列（默认不勾选 = 自适应多列）。 */
  twoColumn: boolean
}

export interface ItemDetailPanelProps {
  item: Item
  dataset: Dataset
  /** 叠层深度（0 = 根）；> 0 时左上角出现「返回」。 */
  depth: number
  /** 当前登录玩家名（`/give` 指令用）；未登录为 null。 */
  username?: string | null
  prefixId: number
  onPrefixChange: (prefixId: number) => void
  /** 堆叠数量（1 / undefined = 无；从带 `sN` 的标签进来时才有）。 */
  stack?: number
  recipe: ItemDetailRecipeOptions
  transport?: BackendTransport | null
  authenticated?: boolean
  /** 左上角「返回」：只关当前这一层，回到上一层。 */
  onBack: () => void
  /** 关掉整个详情（所有层）。 */
  onCloseAll: () => void
  /**
   * 外壳：`drawer`（物品图鉴的可堆叠抽屉）/ `dialog`（其它页面就地弹框）。
   * 只影响标题栏与关闭按钮的位置，内容完全一致。
   */
  chrome: 'drawer' | 'dialog'
  /** 外壳组件带上的测试 id（`dex-detail`）。 */
  testId?: string
}

/**
 * 物品详情的内容（标题栏 + 中间滚动区 + 底部操作区）。
 *
 * 同一份内容被两个外壳复用：物品图鉴里的**可堆叠抽屉**（`ItemDetailDrawer`）和
 * 其它页面的**弹框**（`ItemDetailDialog`）。所以这里不直接写 `Drawer*` / `Dialog*` 的固定外壳，
 * 而是按 `chrome` 选 —— 也避免两处各写一遍 tips / 词缀 / 合成表 / 指令。
 */
export function ItemDetailPanel({
  item,
  dataset,
  depth,
  username = null,
  prefixId,
  onPrefixChange,
  stack,
  recipe,
  transport,
  authenticated = false,
  onBack,
  onCloseAll,
  chrome,
  testId = 'dex-detail-actions',
}: ItemDetailPanelProps) {
  const { t, lang } = useI18n()
  const [copied, setCopied] = useState<'id' | 'name' | null>(null)
  const isDialog = chrome === 'dialog'
  const Title = isDialog ? DialogTitle : DrawerTitle

  const stat = dataset.itemStats.items[String(item.id)]
  /** 预览的词缀（0 = 无词缀）。 */
  const prefix = prefixId ? dataset.prefixesById.get(prefixId) ?? null : null
  const prefixMods = prefixId ? dataset.prefixModsById.get(prefixId) : undefined
  /** 预览的堆叠（1 / undefined = 无）。 */
  const stackSize = stack != null && stack > 1 ? stack : undefined
  /** 可滚词缀按游戏评分（`prefix-mods.json` 的 `val`）从高到低排序（无效词缀已剔除）。 */
  const prefixRanks = rankPrefixes(
    dataset.rollablePrefixesById.get(item.id) ?? [],
    dataset.prefixModsById,
    stat?.stats,
  )
  /** 评分并列最高的词缀 id（可能多个，如饰品顶级词缀）。 */
  const bestVal = prefixRanks[0]?.val
  const bestPrefixIds = new Set(
    bestVal == null ? [] : prefixRanks.filter((p) => p.val === bestVal).map((p) => p.id),
  )
  /** 当前物品是否有合成 / 用途 / 微光转换信息（没有时显示空态插画）。 */
  const hasRecipeInfo =
    (dataset.recipes.byResult[String(item.id)]?.length ?? 0) > 0 ||
    (dataset.recipes.byIngredient[String(item.id)]?.length ?? 0) > 0 ||
    dataset.shimmerToById.has(item.id) ||
    (dataset.shimmerFromById.get(item.id)?.length ?? 0) > 0

  /** `/give <物品> <玩家> [数量] [词缀]`；有词缀时必须带数量 1。未登录不显示。 */
  const playerArg = username && /\s/.test(username) ? `"${username}"` : username
  const giveCommand = username
    ? prefixId
      ? `/give ${item.id} ${playerArg} 1 ${prefixId}`
      : `/give ${item.id} ${playerArg}`
    : null

  const copy = useCallback(
    async (kind: 'id' | 'name') => {
      try {
        await navigator.clipboard.writeText(kind === 'id' ? String(item.id) : item.name)
        setCopied(kind)
        window.setTimeout(() => setCopied(null), 1200)
      } catch {
        setCopied(null)
      }
    },
    [item.id, item.name],
  )

  const headerClass = 'flex-row items-center gap-1 border-b px-5 py-3'
  const header = (
    <>
      {depth > 0 && (
        <IconAction
          label={t('action.back')}
          icon={ChevronLeft}
          onClick={onBack}
          testId="dex-detail-back"
        />
      )}
      <Title className="min-w-0 flex-1 truncate">{t('dex.detail')}</Title>
      {/* 弹框的 × 由 `DialogContent` 提供（绝对定位在右上角），这里不再重复一个。 */}
      {!isDialog && (
        <IconAction
          label={t('action.close')}
          icon={X}
          onClick={onCloseAll}
          testId="dex-detail-close"
        />
      )}
    </>
  )

  return (
    <>
      {isDialog ? (
        // `pr-12` 让开 `DialogContent` 右上角那个 ×。
        <DialogHeader className={cn(headerClass, 'pr-12')}>{header}</DialogHeader>
      ) : (
        <DrawerHeader className={headerClass}>{header}</DrawerHeader>
      )}

      {/* 中间滚动区：通栏 tips（无阴影）→ 词缀（可折叠分区）→ 相关指令 → 合成 / 掉落 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-4">
        {/* 这里的这份 tips 就是当前物品自己：宽度占满一行、不要阴影，
            右上角不再显示 ⓘ「物品详情」入口（指向自己没意义） */}
        <ItemTooltipContent
          item={item}
          atlas={dataset.atlas}
          stat={stat}
          prefix={prefix?.name ?? null}
          prefixId={prefixId}
          prefixMods={prefixMods}
          stack={stackSize}
          className="w-full max-w-none shadow-none"
          hideDetailLink
        />

        {/* Wiki / 复制在底部固定操作区；词缀与标签跟着 tips 走（切换后 tips 属性值 / 名称随之变化）。
            分区**总是**显示：没有可滚词缀时只有标签框（裸 `[i:ID]` 也能复制 / 广播）。 */}
        <PrefixPicker
          item={item}
          prefixId={prefixId}
          onPrefixChange={onPrefixChange}
          prefixRanks={prefixRanks}
          bestPrefixIds={bestPrefixIds}
          prefix={prefix}
          accessory={stat?.stats?.accessory === true}
          stack={stackSize}
          dataset={dataset}
          formatTag={formatItemTag}
          transport={transport}
          authenticated={authenticated}
        />

        {giveCommand && (
          <CommandLine
            label={t('commandLine.related')}
            commands={[giveCommand]}
            // 浮动终端在详情下面，填完就关掉整个详情（堆叠 / 弹框都一样）。
            onOpenTerminal={onCloseAll}
          />
        )}

        {/* 页面级设置已统一移到图鉴工具栏的「图鉴设置」Popover。 */}
        <RecipePanel
          itemId={item.id}
          dataset={dataset}
          iconOnly={!recipe.showItemNames}
          copyTags={false}
          twoColumn={recipe.twoColumn}
        />

        {/* 可开启物品（木匣等）的掉落：物品 + 数量范围 + 实测概率 */}
        <ItemDropsPanel
          itemId={item.id}
          dataset={dataset}
          iconOnly={!recipe.showItemNames}
          twoColumn={recipe.twoColumn}
        />
      </div>

      {/* 底部固定操作区（同「管理卡片」底部：按钮按内容宽度、带图标、不拉伸）：
          前往 Wiki 在左，复制名称其次，复制 ID 在最右 */}
      <div
        data-testid={testId}
        className="flex shrink-0 flex-row items-center justify-between gap-2 border-t px-5 py-3"
      >
        <Button variant="outline" asChild>
          <a
            href={wikiUrl(item.name, lang)}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t('dex.wiki')}
          >
            <ExternalLink data-icon="inline-start" />
            {t('dex.wiki')}
          </a>
        </Button>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => void copy('name')} aria-label={t('dex.copyName')}>
            {copied === 'name' ? t('dex.copied') : t('dex.copyName')}
          </Button>
          <Button variant="primary" onClick={() => void copy('id')} aria-label={t('dex.copyId')}>
            {copied === 'id' ? t('dex.copied') : t('dex.copyId')}
          </Button>
        </div>
      </div>

      {/* 空态插画：只有 tips、没有合成信息时，右下角放一个半透明大号工匠图标。
          绝对定位挂在面板上，不随中间区域滚动；`bottom-20` 让开底部操作区。 */}
      {!hasRecipeInfo && (
        <div aria-hidden className="pointer-events-none absolute right-6 bottom-20 opacity-[0.15]">
          <ItemIcon
            item={dataset.itemsById.get(36)}
            atlas={dataset.atlas}
            size={200}
            mode="fit"
            tooltip={false}
          />
        </div>
      )}
    </>
  )
}
