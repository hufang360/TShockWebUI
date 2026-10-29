import { useCallback, useState } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { ItemDropsPanel } from '@/components/ItemDropsPanel'
import { ItemIcon } from '@/components/ItemIcon'
import { ItemTooltipContent } from '@/components/ItemTooltipContent'
import { PrefixPicker } from '@/components/items/PrefixPicker'
import { RecipePanel } from '@/components/RecipePanel'
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui'
import { useIsMobile } from '@/hooks/use-mobile'
import { useI18n } from '@/lib/i18n'
import { CommandLine } from '@/components/CommandLine'
import { formatItemTag, wikiUrl } from '@/lib/items'
import { rankPrefixes } from '@/lib/prefixes'
import type { Dataset, Item } from '@/types'

/** 合成表 / 掉落列表的只读显示选项；编辑入口在页面工具栏的「图鉴设置」Popover。 */
export interface ItemDetailRecipeOptions {
  /** 显示物品名称（默认不勾选 = 仅图标）。 */
  showItemNames: boolean
  /** 固定两列（默认不勾选 = 自适应多列）。 */
  twoColumn: boolean
}

export interface ItemDetailDrawerProps {
  dataset: Dataset
  /** 抽屉栈：`[根物品, 子物品, 孙物品…]`。每层渲染一个 `Drawer`，父层留在原位。 */
  stack: number[]
  /** 当前层下标（0 = 根）。 */
  index: number
  /** 当前登录玩家名（`/give` 指令用）；未登录为 null。 */
  username?: string | null
  /** 根抽屉的词缀选择（存在 `DexState.prefixId`，切模块回来会还原）。 */
  rootPrefixId: number
  onRootPrefixChange: (prefixId: number) => void
  recipe: ItemDetailRecipeOptions
  /**
   * 「正在关闭」的层下标：该层及以上开始收起动画（等动画结束再真正出栈，避免瞬间消失）。
   * `null` = 没有正在关闭的层。
   */
  closingFrom: number | null
  /** 请求关闭第 `index` 层及以上的抽屉（点 × / 返回 / 滑走 / Esc 都会走这里）。 */
  onCloseFrom: (index: number) => void
  /** 第 `index` 层收起动画结束：出栈（截断到该层之下）。 */
  onClosed: (index: number) => void
}

/**
 * 物品详情抽屉（**可堆叠**）。
 *
 * 用 shadcn 的 Base UI `Drawer`（见 `ui/Drawer.tsx`）替代原来的右侧 `Sheet`：
 * - 桌面从右侧滑入、移动端从底部滑入（带拖拽手柄，可下滑关闭）；
 * - 在抽屉里再打开物品（配方材料 / 产物的点击、提示里的「合成表」入口）会**叠一层新抽屉**，
 *   父抽屉缩小留在后面，关掉子抽屉即回到上一层；
 * - 每一层是独立的 `ItemDetailDrawer`（各自维护词缀选择），根层的词缀仍记到 `DexState`。
 */
export function ItemDetailDrawer({
  dataset,
  stack,
  index,
  username = null,
  rootPrefixId,
  onRootPrefixChange,
  recipe,
  closingFrom,
  onCloseFrom,
  onClosed,
}: ItemDetailDrawerProps) {
  const item = dataset.itemsById.get(stack[index]) ?? null
  const isMobile = useIsMobile()
  /** 本层是否展开（父层开始关闭时，子层一起收起）。 */
  const open = closingFrom == null || index < closingFrom
  // 子层（index > 0）的词缀选择是本层局部状态；根层的走 DexState。
  const [localPrefixId, setLocalPrefixId] = useState(0)
  const prefixId = index === 0 ? rootPrefixId : localPrefixId
  const setPrefixId = index === 0 ? onRootPrefixChange : setLocalPrefixId

  if (!item) return null

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onCloseFrom(index)
      }}
      onOpenChangeComplete={(next) => {
        // 只有「开始关闭的那一层」负责出栈：它上面几层会随栈截断一起卸载。
        if (!next && index === closingFrom) onClosed(index)
      }}
      swipeDirection={isMobile ? 'down' : 'right'}
      showSwipeHandle={isMobile}
    >
      <DrawerContent
        data-testid="dex-detail"
        data-detail-index={index}
        // 标题 / 底部固定，仅中间（tips + 合成表）滚动；宽度沿用旧弹框（≤576px，窄屏占满）。
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl data-[swipe-axis=x]:[--drawer-content-width:min(100vw,36rem)]"
      >
        <ItemDetailPanel
          item={item}
          dataset={dataset}
          depth={index}
          username={username}
          prefixId={prefixId}
          onPrefixChange={setPrefixId}
          recipe={recipe}
          onBack={() => onCloseFrom(index)}
          onCloseAll={() => onCloseFrom(0)}
        />
        {/* 下一层抽屉：必须渲染在本层内容里（Base UI 靠 React 树判定嵌套） */}
        {stack[index + 1] != null && (
          <ItemDetailDrawer
            dataset={dataset}
            stack={stack}
            index={index + 1}
            username={username}
            rootPrefixId={rootPrefixId}
            onRootPrefixChange={onRootPrefixChange}
            recipe={recipe}
            closingFrom={closingFrom}
            onCloseFrom={onCloseFrom}
            onClosed={onClosed}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}

/** 单层抽屉的内容：标题栏（固定）/ 中间滚动区 / 底部操作区（固定）。 */
function ItemDetailPanel({
  item,
  dataset,
  depth,
  prefixId,
  onPrefixChange,
  recipe,
  username,
  onBack,
  onCloseAll,
}: {
  item: Item
  dataset: Dataset
  depth: number
  username: string | null
  prefixId: number
  onPrefixChange: (prefixId: number) => void
  recipe: ItemDetailRecipeOptions
  /** 左上角「返回」：只关当前这层，回到上一层。 */
  onBack: () => void
  /** 右上角 ×：直接关掉整个抽屉（所有层）。 */
  onCloseAll: () => void
}) {
  const { t, lang } = useI18n()
  const [copied, setCopied] = useState<'id' | 'name' | null>(null)

  const stat = dataset.itemStats.items[String(item.id)]
  /** 预览的词缀（0 = 无词缀）。 */
  const prefix = prefixId ? dataset.prefixesById.get(prefixId) ?? null : null
  const prefixMods = prefixId ? dataset.prefixModsById.get(prefixId) : undefined
  /** 该物品**可滚的词缀**（严格按游戏规则；盔甲等没有）。 */
  const rollablePrefixes = (dataset.rollablePrefixesById.get(item.id) ?? [])
    .map((id) => dataset.prefixesById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
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
  /** 最佳词缀名（可能多个）——用于文案展示。 */
  const bestPrefixNames = [
    ...new Set(
      [...bestPrefixIds]
        .map((id) => dataset.prefixesById.get(id)?.name)
        .filter((n): n is string => !!n),
    ),
  ]
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

  const copy = useCallback(async (kind: 'id' | 'name') => {
    try {
      await navigator.clipboard.writeText(kind === 'id' ? String(item.id) : item.name)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1200)
    } catch {
      setCopied(null)
    }
  }, [item.id, item.name])

  return (
    <>
      {/* 标题栏（固定）：左上角「返回」= 关当前层（叠层时才有），右上角 × = 关掉整个抽屉 */}
      <DrawerHeader className="flex-row items-center gap-1 border-b px-5 py-3">
        {depth > 0 && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onBack}
            aria-label={t('action.back')}
            title={t('action.back')}
            data-testid="dex-detail-back"
          >
            <ChevronLeft data-icon="inline-start" />
          </Button>
        )}
        <DrawerTitle className="min-w-0 flex-1 truncate">{t('dex.detail')}</DrawerTitle>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onCloseAll}
          aria-label={t('action.close')}
          title={t('action.close')}
          data-testid="dex-detail-close"
        >
          <X data-icon="inline-start" />
        </Button>
      </DrawerHeader>

      {/* 中间滚动区：左 = 游戏同款 tips，右 = 词缀下拉（group 样式）；下方合成表 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* 抽屉里的这份 tips 就是当前物品自己：底部不再显示「合成表」入口（指向自己没意义） */}
            <ItemTooltipContent
              item={item}
              atlas={dataset.atlas}
              stat={stat}
              prefix={prefix?.name ?? null}
              prefixMods={prefixMods}
              hideRecipeLink
            />
          </div>
          <div data-testid="dex-detail-side" className="flex w-40 shrink-0 flex-col gap-2">
            <div className="grid grid-cols-2 gap-1">
              <Button
                size="sm"
                variant="primary"
                className="h-8"
                onClick={() => void copy('id')}
                aria-label={t('dex.copyId')}
              >
                {copied === 'id' ? t('dex.copied') : t('dex.copyId')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => void copy('name')}
                aria-label={t('dex.copyName')}
              >
                {copied === 'name' ? t('dex.copied') : t('dex.copyName')}
              </Button>
            </div>
            <Button size="sm" variant="outline" className="h-8 w-full bg-card" asChild>
              <a
                href={wikiUrl(item.name, lang)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={t('dex.wiki')}
              >
                {t('dex.wiki')}
              </a>
            </Button>
            {/* Wiki 固定在词缀选择器上方；切换词缀后 tips 属性值随之变化。 */}
            {rollablePrefixes.length > 0 && (
              <PrefixPicker
                item={item}
                prefixId={prefixId}
                onPrefixChange={onPrefixChange}
                prefixRanks={prefixRanks}
                bestPrefixIds={bestPrefixIds}
                bestPrefixNames={bestPrefixNames}
                prefix={prefix}
                accessory={stat?.stats?.accessory === true}
                dataset={dataset}
                formatTag={formatItemTag}
              />
            )}
          </div>
        </div>

        {giveCommand && (
          <CommandLine label={t('dex.giveCommand')} commands={[giveCommand]} />
        )}

        {/* 物品级标签：可丢微光分解（数据见 gamedump 的 canDecraft）
            已融入到「合成表」的每条记录里（见 RecipePanel），这里不再单独占一行。 */}

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


      {/* 空态插画：只有 tips、没有合成信息时，右下角放一个半透明大号工匠图标。
          绝对定位挂在抽屉面板上（`fixed`），不随中间区域滚动。 */}
      {!hasRecipeInfo && (
        <div aria-hidden className="pointer-events-none absolute right-6 bottom-16 opacity-[0.15]">
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
