import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search, Star } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { ItemTooltipContent } from '@/components/ItemTooltipContent'
import { RecipePanel } from '@/components/RecipePanel'
import { ItemDropsPanel } from '@/components/ItemDropsPanel'
import { DexCell } from '@/components/items/DexCell'
import { DexPagination } from '@/components/items/DexPagination'
import { PrefixPicker } from '@/components/items/PrefixPicker'
import { SearchInput } from '@/components/SearchInput'
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  NativeSelect,
  NativeSelectOption,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useLocalState } from '@/hooks/useLocalState'
import { useSearchHistory } from '@/hooks/useSearchHistory'
import { cn } from '@/lib/cn'
import {
  COLLECTION_GROUPS,
  COLLECTIONS_BY_ID,
  ITEM_COLLECTIONS,
  rangeTabLabel,
  resolveCollectionItems,
} from '@/lib/collections'
import { useI18n } from '@/lib/i18n'
import {
  addItemFavorite,
  isItemFavorited,
  removeItemFavorite,
  sanitizeItemFavorites,
} from '@/lib/itemFavorites'
import { readDexState, rememberDexState, rememberDexPageSize, DEFAULT_GAME_TAB, type CopyKind, type DexMode, type DexState } from '@/lib/dexState'
import { ItemFavoritesProvider, type ItemFavoritesApi } from '@/lib/itemFavoritesContext'
import { formatItemTag, searchItems, wikiUrl } from '@/lib/items'
import {
  clampPage,
  paginate,
  totalPages,
} from '@/lib/pagination'
import { StorageKeys } from '@/lib/storage'
import { computeVirtualGrid } from '@/lib/virtualGrid'
import { rankPrefixes } from '@/lib/prefixes'
import type { Dataset, Item, ItemFavorite } from '@/types'

/** 一行目标数量（格子宽度据此自适应，9~11 个）。 */
const CELL_GAP = 8
const TARGET_COLS = 10
const MIN_CELL_W = 88
const MAX_CELL_W = 132
/** 格子高度：内边距 12 + 图标 64 + 每行（含 4px 间距）—— 虚拟化需要确定的行高。 */
const CELL_HEIGHT_BASE = 76
const CELL_HEIGHT_ID = 14 // ID 行 10px + 间距 4
const CELL_HEIGHT_NAME = 20 // 名称行 16px + 间距 4


/**
 * 物品图鉴：集合/搜索 + 分页（默认每页 100，可切换）+ 选中后详情弹框。
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
  // 合成表「仅图标」开关（减少视觉信息，跨刷新记忆；**默认开启**）。
  const [recipeIconOnly, setRecipeIconOnly] = useLocalState<boolean>(
    StorageKeys.dexRecipeIconOnly,
    true,
  )
  // 合成表「复制含标签」开关（复制的合成文本是否带 [i:..] 标签）。
  const [recipeCopyTag, setRecipeCopyTag] = useLocalState<boolean>(
    StorageKeys.dexRecipeCopyTag,
    true,
  )
  // 合成表「单列显示」开关（默认多列自适应；勾选后每条记录占一行）。
  const [recipeSingleColumn, setRecipeSingleColumn] = useLocalState<boolean>(
    StorageKeys.dexRecipeSingleColumn,
    false,
  )
  // 「最近搜索」（统一规则：最多 10 条、窄区域显示 5 条；见 lib/searchHistory.ts）。
  const { history: searchHistory, remember: rememberSearch } = useSearchHistory(
    StorageKeys.dexSearchHistory,
  )
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
    patch({ selectedId: focusItemId, query: '', mode: 'all', favoritesOnly: false, collectionId: '', groupTab: '', prefixId: 0, page: 1, scrollTop: 0 })
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

  const keyword = debounced.trim()

  // 一级模式：全部物品（all）/ 制作界面（game）/ ⭐ 收藏（favorites）/ 集合分组（二级）
  const isCollectionGroup = state.mode !== 'all' && state.mode !== 'game'
  /** 一级 ToggleGroup 的当前值（集合分组激活时为空，不选中任何一级模式）。 */
  const activeTopMode = state.favoritesOnly
    ? 'favorites'
    : isCollectionGroup
      ? ''
      : state.mode
  const collection =
    isCollectionGroup && state.collectionId ? COLLECTIONS_BY_ID.get(state.collectionId) ?? null : null

  /** ⭐ 收藏（按收藏时间倒序）解析为物品。 */
  const favoriteItems = useMemo(
    () => itemFavs.map((f) => dataset.itemsById.get(f.id)).filter((it): it is Item => !!it),
    [itemFavs, dataset.itemsById],
  )

  const baseItems = useMemo(() => {
    if (state.favoritesOnly) return favoriteItems
    if (collection) return resolveCollectionItems(collection, dataset.itemsById)
    return dataset.items
  }, [state.favoritesOnly, favoriteItems, collection, dataset.items, dataset.itemsById])

  // 游戏自身的物品分组：创意菜单页签（ItemFilters）+ 每件物品的 ItemGroup / 组内顺序。
  const groupTabs = dataset.itemGroups.tabs
  const groupItems = dataset.itemGroups.items
  const gameMode = state.mode === 'game'
  // 游戏分组模式不再有「全部」页签：未选时落到默认页签（工具）。
  const effectiveGroupTab = gameMode ? state.groupTab || DEFAULT_GAME_TAB : ''
  const groupTabIndex =
    gameMode && effectiveGroupTab ? groupTabs.findIndex((t) => t.id === effectiveGroupTab) : -1

  /** 游戏分组模式下选中页签时按该页签过滤（一个物品可同时属于多个页签，与游戏一致）。 */
  const tabItems = useMemo(() => {
    if (groupTabIndex < 0) return baseItems
    return baseItems.filter((it) => groupItems[String(it.id)]?.t.includes(groupTabIndex))
  }, [baseItems, groupTabIndex, groupItems])

  const matched = useMemo(
    () => (keyword ? searchItems(tabItems, keyword, tabItems.length) : tabItems),
    [tabItems, keyword],
  )

  const ordered = useMemo(() => {
    if (gameMode) {
      // 游戏 ByCreativeSortingId 顺序：ItemGroup → 组内顺序（gv / o）
      return [...matched].sort((a, b) => {
        const ea = groupItems[String(a.id)]
        const eb = groupItems[String(b.id)]
        return (ea?.gv ?? 0) - (eb?.gv ?? 0) || (ea?.o ?? 0) - (eb?.o ?? 0) || a.id - b.id
      })
    }
    return matched
  }, [gameMode, matched, groupItems])

  /** 切换主筛选方式：清空第二级与收藏；进「物品分组」时默认落到「工具」页签。 */
  const selectMode = useCallback(
    (mode: DexMode) => {
      setState((s) => ({
        ...s,
        mode,
        favoritesOnly: false,
        collectionId: '',
        groupTab: mode === 'game' && !s.groupTab ? DEFAULT_GAME_TAB : s.groupTab,
        page: 1,
        scrollTop: 0,
      }))
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    },
    [setState],
  )

  /** 一级模式切换（ToggleGroup）：收藏 → 只看收藏；其余 → 对应池子。
   *  空值 = 取消选中：仅「收藏」允许再点一次关掉（回到全部物品），其余忽略。 */
  const selectTopMode = useCallback(
    (value: string) => {
      if (!value) {
        setState((s) =>
          s.favoritesOnly ? { ...s, favoritesOnly: false, mode: 'all', page: 1, scrollTop: 0 } : s,
        )
        if (scrollRef.current) scrollRef.current.scrollTop = 0
        return
      }
      if (value === 'favorites') {
        setState((s) => ({
          ...s,
          favoritesOnly: true,
          mode: 'all',
          collectionId: '',
          groupTab: '',
          page: 1,
          scrollTop: 0,
        }))
        if (scrollRef.current) scrollRef.current.scrollTop = 0
        return
      }
      selectMode(value as DexMode)
    },
    [selectMode],
  )

  /** 工具提示右上角 ⭐ 用的收藏读写。 */
  const favoritesApi = useMemo<ItemFavoritesApi>(
    () => ({
      isFavorited: (id) => isItemFavorited(itemFavs, id),
      toggle: toggleItemFavorite,
    }),
    [itemFavs, toggleItemFavorite],
  )

  /** 切换游戏页签：同时把网格滚动复位。 */
  const selectGroupTab = useCallback(
    (value: string) => {
      patch({ groupTab: value, page: 1, scrollTop: 0 })
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    },
    [patch],
  )

  /** 选择物品集合：同时把网格滚动复位。 */
  const selectCollection = useCallback(
    (id: string) => {
      patch({ collectionId: id, page: 1, scrollTop: 0 })
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    },
    [patch],
  )

  /** 快捷搜索：切到「全部物品」并搜该关键词（tag / 最近搜索都走这里）。 */
  const selectKeyword = useCallback(
    (kw: string) => {
      patch({
        mode: 'all',
        favoritesOnly: false,
        collectionId: '',
        groupTab: '',
        query: kw,
        page: 1,
        scrollTop: 0,
      })
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    },
    [patch],
  )

  // 搜过的词进「最近搜索」（去重、最新在前；上限统一在 lib/searchHistory.ts）。
  useEffect(() => {
    if (keyword) rememberSearch(keyword)
  }, [keyword, rememberSearch])

  const pageCount = totalPages(ordered.length, state.pageSize)
  const page = clampPage(state.page, pageCount)
  const pageItems = paginate(ordered, page, state.pageSize)
  /** 收藏模式下但收藏夹为空：区别于「有记录但没匹配到」。 */
  const favoritesEmpty = state.favoritesOnly && favoriteItems.length === 0

  const selected =
    state.selectedId != null ? dataset.itemsById.get(state.selectedId) ?? null : null
  const selectedStat = selected ? dataset.itemStats.items[String(selected.id)] : undefined
  /** 详情里预览的词缀（0 = 无词缀）。 */
  const selectedPrefix = state.prefixId ? dataset.prefixesById.get(state.prefixId) ?? null : null
  const selectedPrefixMods = state.prefixId ? dataset.prefixModsById.get(state.prefixId) : undefined
  /** 该物品**可滚的词缀**（严格按游戏规则；盔甲等没有）。 */
  const rollablePrefixes = selected
    ? (dataset.rollablePrefixesById.get(selected.id) ?? [])
        .map((id) => dataset.prefixesById.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
    : []
  /** 可滚词缀按游戏评分（`prefix-mods.json` 的 `val`）从高到低排序（无效词缀已剔除）。 */
  const prefixRanks = useMemo(
    () =>
      selected
        ? rankPrefixes(
            dataset.rollablePrefixesById.get(selected.id) ?? [],
            dataset.prefixModsById,
            selectedStat?.stats,
          )
        : [],
    [selected, dataset.rollablePrefixesById, dataset.prefixModsById, selectedStat],
  )
  /** 评分并列最高的词缀 id（可能多个，如饰品顶级词缀）。 */
  const bestPrefixIds = useMemo(() => {
    const best = prefixRanks[0]?.val
    if (best == null) return new Set<number>()
    return new Set(prefixRanks.filter((p) => p.val === best).map((p) => p.id))
  }, [prefixRanks])
  /** 最佳词缀名（可能多个）——用于文案展示。 */
  const bestPrefixNames = useMemo(
    () =>
      [
        ...new Set(
          [...bestPrefixIds]
            .map((id) => dataset.prefixesById.get(id)?.name)
            .filter((n): n is string => !!n),
        ),
      ],
    [bestPrefixIds, dataset.prefixesById],
  )
  /** 当前物品是否有合成 / 用途 / 微光转换信息（没有则连「仅图标」开关也不显示）。 */
  const hasRecipeInfo = selected
    ? (dataset.recipes.byResult[String(selected.id)]?.length ?? 0) > 0 ||
      (dataset.recipes.byIngredient[String(selected.id)]?.length ?? 0) > 0 ||
      dataset.shimmerToById.has(selected.id) ||
      (dataset.shimmerFromById.get(selected.id)?.length ?? 0) > 0
    : false

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
    <ItemFavoritesProvider api={favoritesApi}>
      <div
        ref={rootRef}
        className="flex min-h-[360px] flex-col gap-3 overflow-hidden"
        style={{ height: pageHeight }}
      >
      {/* 工具条：一张卡片 */}
      <Card className="shrink-0">
        <CardBody className="flex flex-col gap-2 pt-4">
          <SearchInput
            ref={searchRef}
            value={state.query}
            onValueChange={(v) => patch({ query: v, page: 1 })}
            placeholder={t('dex.placeholder')}
            aria-label={t('nav.items')}
            history={searchHistory}
            onHistorySelect={selectKeyword}
            className="h-9"
            inputClassName="text-sm"
          />

          {/* 一级模式 + 集合分组 + 上下文控件：手气不错→换一批；制作界面→页签；集合分组→集合下拉；全部/收藏→无 */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {/* 一级模式（一键可达，含 ⭐ 收藏） */}
            <ToggleGroup
              type="single"
              value={activeTopMode}
              onValueChange={selectTopMode}
              aria-label={t('dex.filter')}
              className="flex-wrap"
            >
              <ToggleGroupItem value="all" data-testid="dex-mode-all">
                {t('dex.collectionAll')}
              </ToggleGroupItem>
              <ToggleGroupItem value="game" data-testid="dex-mode-game">
                {t('dex.tabs')}
              </ToggleGroupItem>
              <ToggleGroupItem value="favorites" data-testid="dex-favorites-toggle">
                <Star
                  className={cn(activeTopMode === 'favorites' && 'fill-current')}
                  data-icon="inline-start"
                />
                {t('dex.favorites')}
              </ToggleGroupItem>
            </ToggleGroup>

            {/* 分组 + 集合：合并成一个 InputGroup 样式（同一底色、共享边框） */}
            <div className="flex items-center rounded-lg bg-accent p-0.5">
              <Select
                value={isCollectionGroup ? state.mode : ''}
                onValueChange={(v) => v && selectMode(v as DexMode)}
              >
                <SelectTrigger
                  size="default"
                  aria-label={t('dex.collectionGroup')}
                  className="max-w-full rounded-md bg-transparent"
                >
                  <SelectValue placeholder={t('dex.collectionGroup')} />
                </SelectTrigger>
                <SelectContent className="min-h-[9rem]">
                  <SelectGroup>
                    {COLLECTION_GROUPS.map((group) => (
                      <SelectItem key={group} value={group}>
                        {t(`dex.group.${group}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {isCollectionGroup && (
                <>
                  <Separator orientation="vertical" className="mx-0.5 h-5" />
                  <Select
                    key={state.mode}
                    value={state.collectionId}
                    onValueChange={selectCollection}
                  >
                    <SelectTrigger
                      size="default"
                      aria-label={t('dex.collection')}
                      className="tswui-attention max-w-full rounded-md bg-transparent"
                    >
                      <SelectValue placeholder={t(`dex.group.${state.mode}`)} />
                    </SelectTrigger>
                    <SelectContent className="min-w-[9rem]">
                      <SelectGroup>
                        {ITEM_COLLECTIONS.filter((c) => c.group === state.mode).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.group === 'range' ? rangeTabLabel(c) : c.name}（{c.ids.length}）
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {gameMode && (
              <Tabs
                value={effectiveGroupTab}
                onValueChange={selectGroupTab}
                className="min-w-0 flex-1"
              >
                <TabsList
                  aria-label={t('dex.tabs')}
                  className="h-auto w-full flex-wrap justify-start gap-1"
                >
                  {groupTabs.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} className="flex-none px-2.5">
                      {t(`dex.tab.${tab.id}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}

          </div>

          {/* 快捷搜索：最近搜索（统一最多 10 条 / 窄区域 5 条） */}
        </CardBody>
      </Card>

      {/* 结果区：不是卡片（直接铺在页面上），内部滚动；overscroll-contain 防止滚轮带动整页 */}
      <div
        ref={scrollRef}
        data-testid="dex-list"
        onScroll={(e) => patch({ scrollTop: e.currentTarget.scrollTop })}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {favoritesEmpty || pageItems.length === 0 ? (
          <Empty className="min-h-40 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">{favoritesEmpty ? <Star /> : <Search />}</EmptyMedia>
              <EmptyTitle>{favoritesEmpty ? t('dex.favoritesEmpty') : t('dex.noMatch')}</EmptyTitle>
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
                  onSelect={(it) => patch({ selectedId: it.id, prefixId: 0 })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <DexPagination
        total={ordered.length}
        gameVersion={dataset.meta.gameVersion}
        itemCount={dataset.meta.itemCount}
        page={page}
        pageCount={pageCount}
        pageSize={state.pageSize}
        onPage={goToPage}
        onPageSize={(size) => {
          patch({ pageSize: size, page: 1 })
          rememberDexPageSize(size)
        }}
      />
      {/* 详情：右侧抽屉（合成区域较长，抽屉比分栏弹框更好用） */}
      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) patch({ selectedId: null })
        }}
      >
        <SheetContent
          side="right"
          data-testid="dex-detail"
          // 标题 / 底部固定，仅中间（tips + 合成表）滚动；宽度同旧弹框（576px）。
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          {selected && (
            <>
              <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
                <SheetTitle>{t('dex.detail')}</SheetTitle>
              </SheetHeader>

              {/* 中间滚动区：左 = 游戏同款 tips，右 = 词缀下拉（group 样式）；下方合成表 */}
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <ItemTooltipContent
                      item={selected}
                      atlas={dataset.atlas}
                      stat={selectedStat}
                      prefix={selectedPrefix?.name ?? null}
                      prefixMods={selectedPrefixMods}
                    />
                  </div>
                  {/* 词缀与下拉作为一个 group，放在 tips 右侧；切换后 tips 属性值随之变化。
                      下拉按游戏自身的词缀评分排序，评分最高的即「顶级词缀」（可能并列）。 */}
                  {rollablePrefixes.length > 0 && (
                    <PrefixPicker
                      item={selected}
                      prefixId={state.prefixId}
                      onPrefixChange={(id) => patch({ prefixId: id })}
                      prefixRanks={prefixRanks}
                      bestPrefixIds={bestPrefixIds}
                      bestPrefixNames={bestPrefixNames}
                      prefix={selectedPrefix}
                      accessory={selectedStat?.stats?.accessory === true}
                      dataset={dataset}
                      formatTag={formatItemTag}
                    />
                  )}
                </div>

                {/* 物品级标签：可丢微光分解（数据见 gamedump 的 canDecraft）
                    已融入到「合成表」的每条记录里（见 RecipePanel），这里不再单独占一行。 */}

                {/* 合成表 + 下方居左的「仅显示图标 / 单列 / 复制含标签」勾选项 */}
                <div className="flex min-w-0 flex-col gap-2">
                  <RecipePanel
                    itemId={selected.id}
                    dataset={dataset}
                    iconOnly={recipeIconOnly}
                    copyTags={recipeCopyTag}
                    singleColumn={recipeSingleColumn}
                  />
                  {hasRecipeInfo && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <Checkbox
                          checked={recipeIconOnly}
                          onCheckedChange={(v) => setRecipeIconOnly(v === true)}
                          aria-label={t('dex.recipeIconOnly')}
                        />
                        <span>{t('dex.recipeIconOnly')}</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <Checkbox
                          checked={recipeSingleColumn}
                          onCheckedChange={(v) => setRecipeSingleColumn(v === true)}
                          aria-label={t('dex.recipeSingleColumn')}
                        />
                        <span>{t('dex.recipeSingleColumn')}</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <Checkbox
                          checked={recipeCopyTag}
                          onCheckedChange={(v) => setRecipeCopyTag(v === true)}
                          aria-label={t('dex.recipeCopyTag')}
                        />
                        <span>{t('dex.recipeCopyTag')}</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* 可开启物品（木匣等）的掉落：物品 + 数量范围 + 实测概率 */}
                <ItemDropsPanel
                  itemId={selected.id}
                  dataset={dataset}
                  iconOnly={recipeIconOnly}
                  singleColumn={recipeSingleColumn}
                />
              </div>

              {/* 底部操作区（固定不滚动）：左 = 前往 Wiki，右 = 复制（主操作）；收藏用提示右上角 ⭐ */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
                <Button size="sm" variant="outline" className="h-8 bg-card" asChild>
                  <a
                    href={wikiUrl(selected.name, lang)}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={t('dex.wiki')}
                  >
                    {t('dex.wiki')}
                  </a>
                </Button>
                <div className="flex items-stretch">
                  <NativeSelect
                    size="sm"
                    value={state.copyKind}
                    onChange={(e) => patch({ copyKind: e.target.value as CopyKind })}
                    aria-label={t('dex.copyWhat')}
                    className="[&>select]:h-8 [&>select]:rounded-lg [&>select]:rounded-r-none [&>select]:border [&>select]:border-border/60"
                  >
                    <NativeSelectOption value="id">{t('dex.copyId')}</NativeSelectOption>
                    <NativeSelectOption value="name">{t('dex.copyName')}</NativeSelectOption>
                    <NativeSelectOption value="tag">{t('dex.copyTag')}</NativeSelectOption>
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="primary"
                    className="h-8 min-w-[5rem] rounded-l-none px-4"
                    onClick={() => void copy()}
                    aria-label={t('dex.copy')}
                  >
                    {copied ? t('dex.copied') : t('dex.copy')}
                  </Button>
                </div>
              </div>

              {/* 空态插画：只有 tips、没有合成信息时，右下角放一个半透明大号工匠图标 */}
              {!hasRecipeInfo && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute right-6 bottom-16 opacity-[0.15]"
                >
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
          )}
        </SheetContent>
      </Sheet>
      </div>
    </ItemFavoritesProvider>
  )
}
