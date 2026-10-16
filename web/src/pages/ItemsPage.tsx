import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Search, Shuffle, Star } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { ItemTooltipContent } from '@/components/ItemTooltipContent'
import { useItemTooltip } from '@/components/ItemTooltip'
import { RecipePanel } from '@/components/RecipePanel'
import {
  Button,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useLocalState } from '@/hooks/useLocalState'
import { cn } from '@/lib/cn'
import {
  COLLECTION_GROUPS,
  COLLECTIONS_BY_ID,
  ITEM_COLLECTIONS,
  resolveCollectionItems,
} from '@/lib/collections'
import { useI18n } from '@/lib/i18n'
import {
  addItemFavorite,
  isItemFavorited,
  removeItemFavorite,
  sanitizeItemFavorites,
} from '@/lib/itemFavorites'
import { readDexState, rememberDexState, type CopyKind, type DexState } from '@/lib/dexState'
import { formatItemTag, searchItems, wikiUrl } from '@/lib/items'
import {
  PAGE_SIZES,
  clampPage,
  paginate,
  paginationRange,
  shuffleWithSeed,
  totalPages,
} from '@/lib/pagination'
import { StorageKeys } from '@/lib/storage'
import { computeVirtualGrid } from '@/lib/virtualGrid'
import type { Dataset, Item, ItemFavorite } from '@/types'

/** 随机种子。用位运算生成 32 位非负整数，供 shuffleWithSeed 使用。 */
const randomSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0

/** 图标框统一 **64×64**（= 游戏 `sizeLimit` 32 的 2 倍）→ `mode='game'` 下是整数 2× 最近邻放大，不糊。 */
const ICON_SIZE = 64
const CELL_GAP = 8
/** 一行目标数量（格子宽度据此自适应，9~11 个）。 */
const TARGET_COLS = 10
const MIN_CELL_W = 88
const MAX_CELL_W = 132
/** 格子高度：内边距 12 + 图标 64 + 每行（含 4px 间距）—— 虚拟化需要确定的行高。 */
const CELL_HEIGHT_BASE = 76
const CELL_HEIGHT_ID = 14 // ID 行 10px + 间距 4
const CELL_HEIGHT_NAME = 20 // 名称行 16px + 间距 4

/** 格子：无底色（不铺白底），hover / 选中用主题色加深，hover 时整体上移一点。 */
const CELL_CLASS =
  'grid cursor-pointer place-items-center gap-1 rounded-xl px-1.5 py-1.5 transition duration-150 hover:-translate-y-0.5 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const CELL_SELECTED = 'bg-primary/20'

/** 单个格子：提示绑在**整张卡片**上（不只是图标画框），提示样式与别处完全一致。 */
function DexCell({
  item,
  dataset,
  selected,
  width,
  height,
  onSelect,
}: {
  item: Item
  dataset: Dataset
  selected: boolean
  width: number
  height: number
  onSelect: (item: Item) => void
}) {
  const { ref, props, node } = useItemTooltip<HTMLButtonElement>({
    item,
    atlas: dataset.atlas,
    stat: dataset.itemStats.items[String(item.id)],
  })
  return (
    <>
      <Button
        variant="ghost"
        aria-label={item.name}
        aria-pressed={selected}
        onClick={() => onSelect(item)}
        ref={ref}
        {...props}
        className={cn(CELL_CLASS, selected && CELL_SELECTED)}
        style={{ width, height }}
      >
        <ItemIcon item={item} atlas={dataset.atlas} size={ICON_SIZE} tooltip={false} />
        <span className="font-pixel text-[10px] leading-none text-muted-foreground">{item.id}</span>
        <span className="w-full truncate text-center text-xs leading-4 text-foreground">
          {item.name}
        </span>
      </Button>
      {node}
    </>
  )
}

/**
 * 物品图鉴：集合/搜索 + 分页（默认每页 50，可切换）+ 选中后详情弹框。
 *
 * 页面填满可用高度、自身不滚动（顶部工具条与底部翻页器固定）：只有网格区与详情内部滚动。
 */
export function ItemsPage({
  dataset,
  focusItemId,
  onFocusConsumed,
}: {
  dataset: Dataset
  /** 从「指令 → 前往物品图鉴」带来的物品 id：挂载后选中并弹出详情。 */
  focusItemId?: number | null
  /** 消费完 focusItemId 后回调（父级清空，避免再次切回时重复弹出）。 */
  onFocusConsumed?: () => void
}) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<DexState>(readDexState)
  const patch = useCallback((p: Partial<DexState>) => setState((s) => ({ ...s, ...p })), [])
  const [copied, setCopied] = useState(false)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [pageHeight, setPageHeight] = useState<number | undefined>(undefined)
  const debounced = useDebouncedValue(state.query, 180)

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 进入页面聚焦搜索框（从「前往物品图鉴」进来时不抢弹框焦点）。
  useEffect(() => {
    if (focusItemId == null) searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 物品收藏（tswui:itemFavorites）：图鉴里收藏后，会出现在「指令」模块的收藏 tab。
  const [rawItemFavs, setRawItemFavs] = useLocalState<ItemFavorite[]>(
    StorageKeys.itemFavorites,
    [],
  )
  const itemFavs = useMemo(() => sanitizeItemFavorites(rawItemFavs), [rawItemFavs])
  const toggleItemFavorite = useCallback(
    (id: number) => {
      setRawItemFavs((prev) => {
        const clean = sanitizeItemFavorites(prev)
        return isItemFavorited(clean, id) ? removeItemFavorite(clean, id) : addItemFavorite(clean, id)
      })
    },
    [setRawItemFavs],
  )

  /** 切页：同时把网格滚动复位（虚拟化依赖 state.scrollTop）。 */
  const goToPage = useCallback(
    (next: number) => {
      patch({ page: next, scrollTop: 0 })
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    },
    [patch],
  )

  // 「前往物品图鉴」：选中指定物品并弹出详情（清空筛选，保证它出现在结果里）。
  useEffect(() => {
    if (focusItemId == null) return
    patch({ selectedId: focusItemId, query: '', collectionId: '', page: 1, scrollTop: 0 })
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    onFocusConsumed?.()
  }, [focusItemId, patch, onFocusConsumed])

  // 卸载时把状态存进模块内存：切模块回来还原，刷新则重新随机
  const stateRef = useRef(state)
  // 每次渲染后同步 ref（不在渲染期写 ref）
  useEffect(() => {
    stateRef.current = state
  })
  // 卸载时把最新状态写进模块内存：切模块回来还原，刷新则重新随机
  useEffect(() => () => rememberDexState(stateRef.current), [])

  const collection = state.collectionId ? COLLECTIONS_BY_ID.get(state.collectionId) ?? null : null
  const keyword = debounced.trim()
  /** 无搜索时一律随机排序：全部物品 / 集合条目都是「每次换一批就从池子里随机取」。 */
  const shuffleable = !keyword

  const baseItems = useMemo(
    () => (collection ? resolveCollectionItems(collection, dataset.itemsById) : dataset.items),
    [collection, dataset.items, dataset.itemsById],
  )

  const matched = useMemo(
    () => (keyword ? searchItems(baseItems, keyword, baseItems.length) : baseItems),
    [baseItems, keyword],
  )

  const ordered = useMemo(
    () => (shuffleable ? shuffleWithSeed(matched, state.seed) : matched),
    [shuffleable, matched, state.seed],
  )

  const pageCount = totalPages(ordered.length, state.pageSize)
  const page = clampPage(state.page, pageCount)
  const pageItems = paginate(ordered, page, state.pageSize)

  const selected =
    state.selectedId != null ? dataset.itemsById.get(state.selectedId) ?? null : null
  const selectedStat = selected ? dataset.itemStats.items[String(selected.id)] : undefined
  const itemFavorited = selected ? isItemFavorited(itemFavs, selected.id) : false

  // 页面高度 = 容器可用高度（详见 docs/页面-物品图鉴.md：不能用「视口 − rect.top」，要减掉容器滚动偏移）
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const scroller = el.closest('main')
    const measure = () => {
      const container = scroller instanceof HTMLElement ? scroller : null
      // 内容区外层（AppShell 的 p-3 / md:p-6 包裹层）的底边距。
      let padWrap: HTMLElement | null = el
      if (container) {
        while (padWrap && padWrap.parentElement !== container) padWrap = padWrap.parentElement
      } else {
        padWrap = el.parentElement
      }
      const padBottom = padWrap
        ? Number.parseFloat(getComputedStyle(padWrap).paddingBottom) || 0
        : 0
      const containerTop = container ? container.getBoundingClientRect().top : 0
      const scrolled = container ? container.scrollTop : 0
      const topInContainer = el.getBoundingClientRect().top - containerTop + scrolled
      const viewportH = container ? container.clientHeight : window.innerHeight
      setPageHeight(Math.max(360, Math.floor(viewportH - topInContainer - padBottom)))
    }
    // 本页刚好占满一屏，切过来时先把容器的历史滚动复位
    if (scroller instanceof HTMLElement && scroller.scrollTop > 0) scroller.scrollTop = 0
    measure()
    const observed: Element = scroller ?? el.parentElement ?? el
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(observed)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : undefined
    mo?.observe(observed, { childList: true })
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      mo?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // 容器尺寸（决定列数、可视行数）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // 还原上次的滚动位置（切模块回来时）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && state.scrollTop > 0) el.scrollTop = state.scrollTop
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cell =
    viewport.w > 0
      ? Math.min(MAX_CELL_W, Math.max(MIN_CELL_W, Math.round((viewport.w - CELL_GAP) / TARGET_COLS) - CELL_GAP))
      : MIN_CELL_W
  // 始终显示 ID + 名称（不再提供开关）。
  const cellHeight = CELL_HEIGHT_BASE + CELL_HEIGHT_ID + CELL_HEIGHT_NAME

  const layout = computeVirtualGrid({
    count: pageItems.length,
    cell,
    cellHeight,
    gap: CELL_GAP,
    viewportWidth: viewport.w,
    viewportHeight: viewport.h,
    scrollTop: state.scrollTop,
  })
  const visible = pageItems.slice(layout.startIndex, layout.endIndex)

  const copyValue = useCallback(
    (item: Item) =>
      state.copyKind === 'id'
        ? String(item.id)
        : state.copyKind === 'name'
          ? item.name
          : formatItemTag(item.id),
    [state.copyKind],
  )

  const copy = useCallback(async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(copyValue(selected))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }, [copyValue, selected])

  return (
    <div
      ref={rootRef}
      className="flex min-h-[360px] flex-col gap-3 overflow-hidden"
      style={{ height: pageHeight }}
    >
      {/* 工具条：一张卡片 */}
      <Card className="shrink-0">
        <CardBody className="flex flex-col gap-2 pt-4">
          <Input
            ref={searchRef}
            value={state.query}
            onChange={(e) => patch({ query: e.target.value, page: 1 })}
            placeholder={t('dex.placeholder')}
            aria-label={t('nav.items')}
          />

          {/* 换一批在左；集合按分组拆成 4 个下拉：ID 范围 / 集合 / 职业 / 水友专属。 */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {shuffleable && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => patch({ seed: randomSeed(), page: 1 })}
              >
                <Shuffle data-icon="inline-start" />
                {t('dex.shuffle')}
              </Button>
            )}
            {COLLECTION_GROUPS.map((group) => (
              <NativeSelect
                key={group}
                size="sm"
                value={collection?.group === group ? state.collectionId : ''}
                onChange={(e) => patch({ collectionId: e.target.value, page: 1 })}
                aria-label={t(`dex.group.${group}`)}
                className="max-w-full"
              >
                <NativeSelectOption value="">{t(`dex.group.${group}`)}</NativeSelectOption>
                {ITEM_COLLECTIONS.filter((c) => c.group === group).map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}（{c.ids.length}）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* 结果区：不是卡片（直接铺在页面上），内部滚动；overscroll-contain 防止滚轮带动整页 */}
      <div
        ref={scrollRef}
        data-testid="dex-list"
        onScroll={(e) => patch({ scrollTop: e.currentTarget.scrollTop })}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {pageItems.length === 0 ? (
          <Empty className="min-h-40 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>{t('dex.noMatch')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="relative" style={{ height: layout.totalHeight }}>
            <div
              className="absolute right-0 left-0 grid justify-center"
              style={{
                top: layout.offsetTop,
                gridTemplateColumns: `repeat(${layout.cols}, ${cell}px)`,
                gap: CELL_GAP,
              }}
            >
              {visible.map((item) => (
                <DexCell
                  key={item.id}
                  item={item}
                  dataset={dataset}
                  selected={state.selectedId === item.id}
                  width={cell}
                  height={cellHeight}
                  onSelect={(it) => patch({ selectedId: it.id })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 翻页器（底部固定）：件数 + 数据版本 + 每页数量 + shadcn Pagination */}
      <div
        data-testid="dex-pager"
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{t('dex.summary', { n: ordered.length })}</span>
          {/* 与「共 N 件」同字号对齐 */}
          <span>
            {t('dex.version', {
              version: dataset.meta.gameVersion,
              count: dataset.meta.itemCount,
            })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <FieldLabel htmlFor="dex-page-size" className="font-normal text-muted-foreground">
              {t('dex.pageSize')}
            </FieldLabel>
            <NativeSelect
              id="dex-page-size"
              size="sm"
              className="w-20"
              value={state.pageSize}
              onChange={(e) => patch({ pageSize: Number(e.target.value), page: 1 })}
            >
              {PAGE_SIZES.map((size) => (
                <NativeSelectOption key={size} value={size}>
                  {size}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <span className="sr-only" aria-live="polite">
            {t('dex.page', { page, pages: pageCount })}
          </span>
          <Pagination aria-label={t('dex.pagination')} className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  aria-label={t('dex.prev')}
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                />
              </PaginationItem>
              {paginationRange(page, pageCount).map((p, index) =>
                p === 'ellipsis' ? (
                  <PaginationItem key={`ellipsis-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === page}
                      aria-label={t('dex.goToPage', { page: p })}
                      onClick={() => goToPage(p)}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  aria-label={t('dex.next')}
                  disabled={page >= pageCount}
                  onClick={() => goToPage(page + 1)}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>

      {/* 详情：弹框。高度固定（普通弹框高度），并随屏幕高度适当收缩 */}
      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) patch({ selectedId: null })
        }}
      >
        <DialogContent
          data-testid="dex-detail"
          // 常见弹框宽度（576px）；标题 / 底部固定，仅中间（tips + 合成表）滚动。
          className="flex max-w-xl flex-col overflow-hidden"
          // 点击框外 / 遮罩不关闭：仅允许右上角关闭或 Esc。
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          {selected && (
            <>
              <DialogTitle className="shrink-0">{t('dex.detail')}</DialogTitle>

              {/* 中间滚动区：游戏同款 tips + 合成表 */}
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                <div className="min-w-0">
                  <ItemTooltipContent item={selected} atlas={dataset.atlas} stat={selectedStat} />
                </div>

                {/* 下：合成表 */}
                <div className="min-w-0">
                  <RecipePanel itemId={selected.id} dataset={dataset} />
                </div>
              </div>

              {/* 底部操作区（固定不滚动）：左 = 收藏 / 前往 Wiki，右 = 复制（主操作） */}
              <DialogFooter className="shrink-0 flex-wrap sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 bg-card"
                    aria-pressed={itemFavorited}
                    aria-label={itemFavorited ? t('editor.unfavorite') : t('editor.favorite')}
                    title={itemFavorited ? t('editor.unfavorite') : t('editor.favorite')}
                    onClick={() => toggleItemFavorite(selected.id)}
                  >
                    <Star
                      className={cn(itemFavorited && 'fill-current text-warning')}
                      data-icon="inline-start"
                    />
                    {itemFavorited ? t('editor.unfavorite') : t('editor.favorite')}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 bg-card" asChild>
                    <a
                      href={wikiUrl(selected.name, lang)}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={t('dex.wiki')}
                    >
                      <ExternalLink data-icon="inline-start" />
                      {t('dex.wiki')}
                    </a>
                  </Button>
                </div>
                <div className="flex items-stretch">
                  <NativeSelect
                    size="sm"
                    value={state.copyKind}
                    onChange={(e) => patch({ copyKind: e.target.value as CopyKind })}
                    aria-label={t('dex.copyWhat')}
                    className="[&>select]:h-8 [&>select]:rounded-r-none"
                  >
                    <NativeSelectOption value="id">{t('dex.copyId')}</NativeSelectOption>
                    <NativeSelectOption value="name">{t('dex.copyName')}</NativeSelectOption>
                    <NativeSelectOption value="tag">{t('dex.copyTag')}</NativeSelectOption>
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="primary"
                    className="h-8 rounded-l-none"
                    onClick={() => void copy()}
                    aria-label={t('dex.copy')}
                  >
                    {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                    {copied ? t('dex.copied') : t('dex.copy')}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
