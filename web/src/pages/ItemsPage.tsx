import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, Info, ListFilter, Maximize2, Minimize2, Search, Settings2, Star, X } from 'lucide-react'
import { DexCell } from '@/components/items/DexCell'
import { DexGroupDrawer } from '@/components/items/DexGroupDrawer'
import { ItemDetailDrawer, type ItemDetailRecipeOptions } from '@/components/items/ItemDetailDrawer'
import { ItemTableLayout } from '@/components/items/ItemTable'
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
  Field,
  FieldGroup,
  FieldLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useLocalState } from '@/hooks/useLocalState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageHeight } from '@/hooks/usePageHeight'
import { useSearchHistory } from '@/hooks/useSearchHistory'
import { cn } from '@/lib/cn'
import {
  COLLECTIONS_BY_ID,
  ITEM_COLLECTIONS,
  rangeTabLabel,
  resolveCollectionItems,
  type ItemCollection,
} from '@/lib/collections'
import { useI18n } from '@/lib/i18n'
import {
  addItemFavorite,
  isItemFavorited,
  removeItemFavorite,
  sanitizeItemFavorites,
} from '@/lib/itemFavorites'
import { readDexState, rememberDexState, DEFAULT_GAME_TAB, type DexMode, type DexState } from '@/lib/dexState'
import { ItemFavoritesProvider, type ItemFavoritesApi } from '@/lib/itemFavoritesContext'
import { ItemDetailProvider, type ItemDetailApi } from '@/lib/itemDetailContext'
import { searchItems } from '@/lib/items'
import { StorageKeys } from '@/lib/storage'
import { computeVirtualGrid } from '@/lib/virtualGrid'
import type { Dataset, Item, ItemFavorite } from '@/types'

/** 格子是正方形；一行最多 10 个，剩余宽度留白。横纵间距统一 4px。 */
const CELL_GAP = 4
const TARGET_COLS = 10
const CELL_SIZE = 76
const CELL_META_SIZE = 110
const COMPACT_CELL_SIZE = 68
const COMPACT_CELL_META_SIZE = 88


interface DexSettingFieldProps {
  id: string
  label: string
  hint: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

function DexSettingField({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: DexSettingFieldProps) {
  return (
    <Field orientation="horizontal" className="items-start rounded-lg px-2 py-2 hover:bg-accent/50">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor={id} className="cursor-pointer font-medium text-foreground">
            {label}
          </FieldLabel>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${label}：${hint}`}
                className="grid size-5 shrink-0 cursor-help place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-64 text-balance">
              {hint}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Field>
  )
}

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
  const { t } = useI18n()
  const [state, setState] = useState<DexState>(readDexState)
  const patch = useCallback((p: Partial<DexState>) => setState((s) => ({ ...s, ...p })), [])
  /** 分组侧抽屉：打开时展开当前选中的分区（未选中则展开第一区「制作界面」）。 */
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false)
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false)
  const [resultsFullscreen, setResultsFullscreen] = useState(false)
  const [tableView, setTableView] = useLocalState<boolean>(StorageKeys.dexTableView, false)
  const [tableTwoCols, setTableTwoCols] = useLocalState<boolean>(StorageKeys.dexTableTwoCols, true)
  const [openGroup, setOpenGroup] = useState<string>('game')
  const [groupQuery, setGroupQuery] = useState('')
  const [rawRecentGroups, setRawRecentGroups] = useLocalState<string[]>(
    StorageKeys.dexGroupRecent,
    [],
  )
  const recentGroups = useMemo(
    () =>
      (Array.isArray(rawRecentGroups) ? rawRecentGroups : [])
        .filter((token): token is string => typeof token === 'string')
        .slice(0, 3),
    [rawRecentGroups],
  )
  /**
   * 物品详情抽屉栈：`[根物品, 子物品, 孙物品…]`。
   * 根物品同时就是 `DexState.selectedId`（切模块回来会重新打开一次），子层只在本次停留期间有效。
   */
  const [detail, setDetail] = useState<{ stack: number[]; closingFrom: number | null }>(() => ({
    stack: state.selectedId != null ? [state.selectedId] : [],
    // 正在收起的那一层（>= 它的层一起关）：等收起动画结束才出栈，避免抽屉瞬间消失。
    closingFrom: null,
  }))
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const debounced = useDebouncedValue(state.query, 180)
  const compactCells = useMediaQuery('(max-width: 639px)')
  const tableTwoColsAvailable = useMediaQuery('(min-width: 1280px)')
  const effectiveTableTwoCols = tableTwoCols && tableTwoColsAvailable

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pageHeight = usePageHeight(rootRef)
  /**
   * 滚动位置：**渲染**用 `scrollTop` state（虚拟化窗口），**持久化**用 `scrollTopRef`。
   *
   * 不能直接用 `state.scrollTop` 渲染：挂载那一刻滚动容器还没有固定高度（`pageHeight` 未生效），
   * 浏览器会把 `scrollTop = 上次位置` 夹回 0，而虚拟窗口仍停在旧位置 → 可视区一片空白。
   * 现在先渲染顶部，等容器高度就绪后再还原，并以浏览器夹取后的真实值为准。
   */
  const [scrollTop, setScrollTop] = useState(0)
  /**
   * 首次布局完成前不挂格子。否则 `viewport` 还是 0×0 时会用兜底 10 列 × 560px
   * 先挂几十个 canvas，紧接着真实列数生效又整体替换，形成数百毫秒首帧长任务。
   */
  const [scrollReady, setScrollReady] = useState(false)
  const scrollTopRef = useRef(state.scrollTop)
  const scrollRafRef = useRef<number | null>(null)
  const layoutRef = useRef<ReturnType<typeof computeVirtualGrid> | null>(null)
  const pendingFocusIndexRef = useRef<number | null>(null)

  /** 滚回顶部（换筛选 / 搜索 / 跳转时），并同步持久化值。 */
  const resetScroll = useCallback(() => {
    scrollTopRef.current = 0
    setScrollTop(0)
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = null
    }
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [])

  // 全屏查看结果时，Esc 退出，并避免背景页面继续滚动。
  useEffect(() => {
    if (!resultsFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setResultsFullscreen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [resultsFullscreen])

  // 桌面进入页面聚焦搜索框；手机不用自动弹键盘（从「前往物品图鉴」进来时也保持详情焦点）。
  useEffect(() => {
    if (focusItemId == null && !compactCells) searchRef.current?.focus()
  }, [compactCells, focusItemId])

  // 物品收藏（tswui:itemFavorites）：图鉴里收藏后，会出现在「指令」模块的收藏 tab。
  const [rawItemFavs, setRawItemFavs] = useLocalState<ItemFavorite[]>(
    StorageKeys.itemFavorites,
    [],
  )
  const itemFavs = useMemo(() => sanitizeItemFavorites(rawItemFavs), [rawItemFavs])
  // 默认显示格子文字与 ID；用户可在页面设置里切换为仅图标。
  const [hideItemMeta, setHideItemMeta] = useLocalState<boolean>(
    StorageKeys.dexHideItemMeta,
    false,
  )
  // 合成表「显示物品名称」开关（默认不勾选 = 仅图标；跨刷新记忆）。
  const [recipeShowNames, setRecipeShowNames] = useLocalState<boolean>(
    StorageKeys.dexRecipeShowNames,
    false,
  )
  // 合成表「两列视图」开关（默认不勾选 = 单列；勾选后固定两列）。
  const [recipeTwoColumn, setRecipeTwoColumn] = useLocalState<boolean>(
    StorageKeys.dexRecipeTwoColumn,
    false,
  )
  // 「最近搜索」（统一规则：最多 10 条、窄区域显示 5 条；见 lib/searchHistory.ts）。
  const {
    history: searchHistory,
    remember: rememberSearch,
    remove: removeSearchHistory,
  } = useSearchHistory(StorageKeys.dexSearchHistory)
  const toggleItemFavorite = useCallback(
    (id: number) => {
      setRawItemFavs((prev) => {
        const clean = sanitizeItemFavorites(prev)
        return isItemFavorited(clean, id) ? removeItemFavorite(clean, id) : addItemFavorite(clean, id)
      })
    },
    [setRawItemFavs],
  )

  /**
   * 打开物品详情：没开抽屉时开根抽屉；已经开着时**叠一层**（可堆叠 drawer）。
   * 点自己正在看的那件物品不重复叠。
   */
  const openDetail = useCallback((itemId: number) => {
    setDetail((d) => {
      // 收起动画进行中还点了别的物品：先把要关的几层丢掉，避免「关掉的层又被救活」。
      const stack =
        d.closingFrom != null ? d.stack.slice(0, d.closingFrom) : d.stack
      const last = stack[stack.length - 1]
      if (last === itemId) return { stack, closingFrom: null }
      return { stack: [...stack, itemId], closingFrom: null }
    })
  }, [])
  /** 关掉第 `index` 层及以上的抽屉（0 = 全部关闭，回到网格）：先放收起动画。 */
  const closeDetailFrom = useCallback((index: number) => {
    setDetail((d) => ({
      ...d,
      closingFrom: d.closingFrom == null ? index : Math.min(d.closingFrom, index),
    }))
  }, [])
  /** 收起动画结束 → 真正出栈（截断到第 `index` 层之下）。 */
  const commitDetailClose = useCallback((index: number) => {
    setDetail((d) => ({ stack: d.stack.slice(0, index), closingFrom: null }))
  }, [])
  // 抽屉栈根物品 ↔ DexState.selectedId（跳页 / 切模块回来时靠它还原）
  useEffect(() => {
    const root = detail.stack[0] ?? null
    if (root !== state.selectedId) patch({ selectedId: root, prefixId: 0 })
  }, [detail.stack, state.selectedId, patch])
  /** 物品提示里的「合成表」入口：就地打开（或叠一层）物品详情抽屉。 */
  const detailApi = useMemo<ItemDetailApi>(() => ({ open: openDetail }), [openDetail])
  /** 稳定引用：让 memo 化的 DexCell 在滚动 / 搜索时不重复渲染。 */
  const selectCell = useCallback((item: Item) => openDetail(item.id), [openDetail])

  // 「前往物品图鉴」：选中指定物品并弹出详情（清空筛选，保证它出现在结果里）。
  useEffect(() => {
    if (focusItemId == null) return
    setDetail({ stack: [focusItemId], closingFrom: null })
    patch({ query: '', mode: 'all', favoritesOnly: false, collectionId: '', groupTab: '', prefixId: 0 })
    resetScroll()
    onFocusConsumed?.()
  }, [focusItemId, patch, onFocusConsumed, resetScroll])

  // 卸载时把状态存进模块内存：切模块回来还原，刷新则重新随机
  const stateRef = useRef(state)
  // 每次渲染后同步 ref（不在渲染期写 ref）
  useEffect(() => {
    stateRef.current = state
  })
  // 卸载时把最新状态写进模块内存：切模块回来还原，刷新则重新随机。
  // 滚动位置只存在 ref 里（不参与渲染），这里补进快照。
  useEffect(
    () => () => rememberDexState({ ...stateRef.current, scrollTop: scrollTopRef.current }),
    [],
  )

  const keyword = debounced.trim()

  // 一级模式只剩「全部物品 / ⭐ 收藏」；制作界面与集合都收进「分组」Popover。
  const isCollectionGroup = state.mode !== 'all' && state.mode !== 'game'
  /** 一级 ToggleGroup 的当前值（制作界面 / 集合分组激活时为空，不选中任何一级模式）。 */
  const activeTopMode = state.favoritesOnly ? 'favorites' : state.mode === 'all' ? 'all' : ''
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
  /** 每个创意菜单页签的物品数；只在分组浮层打开过之后才统计（省掉进入页面时的全量遍历）。 */
  const tabCounts = useMemo(() => {
    if (!groupDrawerOpen) return [] as number[]
    const counts = new Array<number>(groupTabs.length).fill(0)
    for (const it of dataset.items) {
      const tabs = groupItems[String(it.id)]?.t
      if (!tabs) continue
      for (const i of tabs) if (i >= 0 && i < counts.length) counts[i] += 1
    }
    return counts
  }, [groupDrawerOpen, dataset.items, groupItems, groupTabs.length])
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

  const rememberGroupToken = useCallback(
    (token: string) => {
      setRawRecentGroups((prev) =>
        [token, ...(Array.isArray(prev) ? prev : []).filter((v) => v !== token)].slice(0, 3),
      )
    },
    [setRawRecentGroups],
  )

  /** 切换主筛选方式：清空第二级与收藏；进「物品分组」时默认落到「工具」页签。 */
  const selectMode = useCallback(
    (mode: DexMode) => {
      setState((s) => ({
        ...s,
        mode,
        favoritesOnly: false,
        collectionId: '',
        groupTab: mode === 'game' && !s.groupTab ? DEFAULT_GAME_TAB : s.groupTab,
      }))
      resetScroll()
    },
    [setState, resetScroll],
  )

  /** 一级模式切换（ToggleGroup）：收藏 → 只看收藏；全部物品再点一次 → 重置搜索并回到顶部。 */
  const selectTopMode = useCallback(
    (value: string) => {
      if (!value) {
        setState((s) => {
          if (s.favoritesOnly) {
            return { ...s, favoritesOnly: false, mode: 'all' }
          }
          // 再点已选中的「全部物品」= 重置：清空搜索词与分组，回到顶部。
          if (s.mode === 'all') {
            return { ...s, query: '', collectionId: '', groupTab: '' }
          }
          return s
        })
        resetScroll()
        return
      }
      if (value === 'favorites') {
        setState((s) => ({
          ...s,
          favoritesOnly: true,
          mode: 'all',
          collectionId: '',
          groupTab: '',
          }))
        resetScroll()
        return
      }
      selectMode(value as DexMode)
    },
    [selectMode, resetScroll],
  )

  /** 工具提示右上角 ⭐ 用的收藏读写。 */
  const favoritesApi = useMemo<ItemFavoritesApi>(
    () => ({
      isFavorited: (id) => isItemFavorited(itemFavs, id),
      toggle: toggleItemFavorite,
    }),
    [itemFavs, toggleItemFavorite],
  )

  /** 选择「制作界面」的页签：再次点选中的页签 = 取消，回到全部物品。 */
  const selectGameTab = useCallback(
    (tabId: string) => {
      rememberGroupToken(`game:${tabId}`)
      setState((s) => {
        const current = s.groupTab || DEFAULT_GAME_TAB
        if (s.mode === 'game' && current === tabId) {
          return { ...s, mode: 'all', collectionId: '', groupTab: '' }
        }
        return {
          ...s,
          mode: 'game',
          favoritesOnly: false,
          collectionId: '',
          groupTab: tabId,
          }
      })
      resetScroll()
    },
    [setState, resetScroll, rememberGroupToken],
  )

  /** 选择物品集合：再次点选中的集合 = 取消，回到全部物品。 */
  const selectCollectionItem = useCallback(
    (c: ItemCollection) => {
      rememberGroupToken(`collection:${c.id}`)
      setState((s) => {
        if (s.mode === c.group && s.collectionId === c.id) {
          return { ...s, mode: 'all', collectionId: '' }
        }
        return {
          ...s,
          mode: c.group,
          favoritesOnly: false,
          collectionId: c.id,
          }
      })
      resetScroll()
    },
    [setState, resetScroll, rememberGroupToken],
  )

  /** 分组按钮上的 ×：清除当前分组 / 页签，回到全部物品。 */
  const clearGroup = useCallback(() => {
    patch({ mode: 'all', collectionId: '', groupTab: '' })
    resetScroll()
  }, [patch, resetScroll])

  /** 快捷搜索：切到「全部物品」并搜该关键词（tag / 最近搜索都走这里）。 */
  const selectKeyword = useCallback(
    (kw: string) => {
      patch({
        mode: 'all',
        favoritesOnly: false,
        collectionId: '',
        groupTab: '',
        query: kw,
      })
      resetScroll()
    },
    [patch, resetScroll],
  )

  // 搜过的词进「最近搜索」（去重、最新在前；上限统一在 lib/searchHistory.ts）。
  useEffect(() => {
    if (keyword) rememberSearch(keyword)
  }, [keyword, rememberSearch])

  // 打开分组抽屉时，把当前选中项滚到可视区（集合多时不必手动找）。
  useEffect(() => {
    if (!groupDrawerOpen) return
    document
      .querySelector('[data-group-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [groupDrawerOpen, openGroup])

  /** 收藏模式下但收藏夹为空：区别于「有记录但没匹配到」。 */
  const favoritesEmpty = state.favoritesOnly && favoriteItems.length === 0

  // 页面高度 = 容器可用高度（详见 docs/页面-物品图鉴.md：不能用「视口 − rect.top」，要减掉容器滚动偏移）
  // 测量逻辑统一在 usePageHeight：不要用 MutationObserver 监听子节点（滚动时每挂/卸一行都会触发，
  // 每次都要读一次布局 → 掉帧）。

  // 容器尺寸（决定列数、可视行数）；尺寸变化时重测
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

  /**
   * 等 `pageHeight` 生效（容器真正有高度、可滚动）后再：量尺寸 → 还原上次滚动位置。
   *
   * 这三件事在同一个 layout effect 里完成，React 会在**绘制前**一次性提交，
   * 于是第一屏格子直接在正确的位置 / 列数上挂载：
   * - 不会先渲染顶部再跳到上次位置（少了整整一轮格子挂载）；
   * - 也不会出现「scrollTop 被浏览器夹回 0，虚拟窗口却停在旧位置」的空白。
   */
  useLayoutEffect(() => {
    if (pageHeight == null) return
    const el = scrollRef.current
    if (!el) return
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    const target = scrollTopRef.current
    if (target > 0 && el.scrollTop !== target) el.scrollTop = target
    // 浏览器可能把目标位置夹取到最大可滚动范围，以真实值为准
    const actual = el.scrollTop
    scrollTopRef.current = actual
    setScrollTop((prev) => (prev === actual ? prev : actual))
    setScrollReady(true)
  }, [pageHeight])

  // 格子宽高保持一致：默认只显示图标；关闭隐藏设置后整体放大以容纳文字。
  const cell = compactCells
    ? hideItemMeta
      ? COMPACT_CELL_SIZE
      : COMPACT_CELL_META_SIZE
    : hideItemMeta
      ? CELL_SIZE
      : CELL_META_SIZE
  const cellHeight = cell

  const layout = computeVirtualGrid({
    count: ordered.length,
    cell,
    cellHeight,
    gap: CELL_GAP,
    viewportWidth: viewport.w,
    viewportHeight: viewport.h,
    scrollTop,
    overscanRows: 1,
    maxCols: resultsFullscreen ? undefined : TARGET_COLS,
  })
  const visible = ordered.slice(layout.startIndex, layout.endIndex)

  useLayoutEffect(() => {
    layoutRef.current = layout
  })

  useLayoutEffect(() => {
    const target = pendingFocusIndexRef.current
    if (target == null) return
    const button = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-dex-index="${target}"]`,
    )
    if (!button) return
    pendingFocusIndexRef.current = null
    button.focus()
  }, [layout.startIndex, visible.length])

  /** 方向键在网格内移动；目标行尚未挂载时先滚动，等虚拟窗口更新后聚焦。 */
  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLElement)) return
    const button = e.target.closest<HTMLButtonElement>('[data-dex-index]')
    if (!button) return
    const current = Number(button.dataset.dexIndex)
    if (!Number.isFinite(current) || ordered.length === 0) return

    const rowStart = Math.floor(current / layout.cols) * layout.cols
    let target = current
    if (e.key === 'ArrowLeft') target = Math.max(rowStart, current - 1)
    else if (e.key === 'ArrowRight') target = Math.min(rowStart + layout.cols - 1, current + 1)
    else if (e.key === 'ArrowUp') target = Math.max(0, current - layout.cols)
    else if (e.key === 'ArrowDown') target = Math.min(ordered.length - 1, current + layout.cols)
    else if (e.key === 'Home') target = rowStart
    else if (e.key === 'End') target = Math.min(rowStart + layout.cols - 1, ordered.length - 1)
    else return

    e.preventDefault()
    if (target === current) return
    const mounted = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-dex-index="${target}"]`,
    )
    if (mounted) {
      mounted.focus()
      return
    }
    pendingFocusIndexRef.current = target
    const targetTop = Math.floor(target / layout.cols) * layout.rowHeight
    if (scrollRef.current) scrollRef.current.scrollTop = targetTop
    setScrollTop(targetTop)
  }

  /**
   * 滚动：用 rAF 合并同一帧内的多次 scroll 事件，并且**只有可视行窗口变化时才 setState**
   * （同一行内的小幅滚动不需要重新渲染）。
   */
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      scrollTopRef.current = e.currentTarget.scrollTop
      if (scrollRafRef.current != null) return
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null
        const top = scrollTopRef.current
        const next = computeVirtualGrid({
          count: ordered.length,
          cell,
          cellHeight,
          gap: CELL_GAP,
          viewportWidth: viewport.w,
          viewportHeight: viewport.h,
          scrollTop: top,
          overscanRows: 1,
          maxCols: resultsFullscreen ? undefined : TARGET_COLS,
        })
        const cur = layoutRef.current
        if (cur && cur.startRow === next.startRow && cur.endRow === next.endRow) return
        setScrollTop(top)
      })
    },
    [ordered.length, cell, cellHeight, viewport.w, viewport.h],
  )

  const groupSearch = groupQuery.trim().toLowerCase()
  const groupSearchResults = useMemo(() => {
    if (!groupSearch) return []
    const tabs = groupTabs
      .filter((tab) => {
        const label = t(`dex.tab.${tab.id}`).toLowerCase()
        return label.includes(groupSearch) || tab.id.toLowerCase().includes(groupSearch)
      })
      .map((tab) => ({
        token: `game:${tab.id}`,
        label: t(`dex.tab.${tab.id}`),
        meta: t('dex.tabs'),
      }))
    const collections = ITEM_COLLECTIONS.filter((c) => {
      const groupLabel = t(`dex.group.${c.group}`).toLowerCase()
      return (
        c.name.toLowerCase().includes(groupSearch) ||
        c.id.toLowerCase().includes(groupSearch) ||
        groupLabel.includes(groupSearch)
      )
    }).map((c) => ({
      token: `collection:${c.id}`,
      label: c.group === 'range' ? rangeTabLabel(c) : c.name,
      meta: t(`dex.group.${c.group}`),
    }))
    return [...tabs, ...collections]
  }, [groupSearch, groupTabs, t])

  const recentGroupEntries = useMemo(
    () =>
      recentGroups.flatMap((token) => {
        if (token.startsWith('game:')) {
          const id = token.slice('game:'.length)
          const tab = groupTabs.find((item) => item.id === id)
          return tab
            ? [{ token, label: t(`dex.tab.${tab.id}`), meta: t('dex.tabs') }]
            : []
        }
        if (token.startsWith('collection:')) {
          const c = COLLECTIONS_BY_ID.get(token.slice('collection:'.length))
          return c
            ? [
                {
                  token,
                  label: c.group === 'range' ? rangeTabLabel(c) : c.name,
                  meta: t(`dex.group.${c.group}`),
                },
              ]
            : []
        }
        return []
      }),
    [recentGroups, groupTabs, t],
  )

  const applyGroupToken = useCallback(
    (token: string) => {
      if (token.startsWith('game:')) {
        selectGameTab(token.slice('game:'.length))
      } else if (token.startsWith('collection:')) {
        const collection = COLLECTIONS_BY_ID.get(token.slice('collection:'.length))
        if (collection) selectCollectionItem(collection)
      }
      setGroupQuery('')
      setGroupDrawerOpen(false)
    },
    [selectGameTab, selectCollectionItem],
  )

  // 卸载时取消未执行的 rAF
  useEffect(
    () => () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current)
    },
    [],
  )

  /** 详情抽屉里合成表的三个勾选项（页面级状态，各层抽屉共享）。 */
  const detailRecipe: ItemDetailRecipeOptions = {
    showItemNames: recipeShowNames,
    twoColumn: recipeTwoColumn,
  }

  const exportItemTable = () => {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
    const csv = [
      ['ID', 'Name', 'InternalName'],
      ...ordered.map((item) => [String(item.id), item.name, item.key]),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'tswui-items.csv'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const itemsSettingsControl = (
                <TooltipProvider delayDuration={150}>
                  <Popover open={settingsPopoverOpen} onOpenChange={setSettingsPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('dex.settings')}
                        title={t('dex.settings')}
                        className={cn(
                          'text-muted-foreground hover:bg-card hover:text-foreground',
                          settingsPopoverOpen && 'bg-card text-foreground',
                        )}
                      >
                        <Settings2 />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-80 max-w-[calc(100vw-2rem)] p-0"
                      data-testid="dex-settings-popover"
                    >
                      <div className="border-b px-4 py-3 text-sm font-semibold text-foreground">
                        {t('dex.settings')}
                      </div>
                      <FieldGroup className="gap-0.5 p-1.5">
                        <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">
                          {t('dex.viewSection')}
                        </div>
                        <DexSettingField
                          id="dex-hide-item-meta"
                          label={t('dex.hideItemMeta')}
                          hint={t('dex.hideItemMetaHint')}
                          checked={hideItemMeta}
                          onCheckedChange={setHideItemMeta}
                        />
                        <DexSettingField
                          id="dex-table-view"
                          label={t('dex.tableView')}
                          hint={t('dex.tableViewHint')}
                          checked={tableView}
                          onCheckedChange={(checked) => {
                            setTableView(checked)
                            resetScroll()
                          }}
                        />
                        {tableTwoColsAvailable && tableView && (
                          <DexSettingField
                            id="dex-table-two-cols"
                            label={t('dex.tableTwoCols')}
                            hint={t('dex.tableTwoColsHint')}
                            checked={tableTwoCols}
                            onCheckedChange={(checked) => {
                              setTableTwoCols(checked)
                              resetScroll()
                            }}
                          />
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="mx-2 mt-1 w-[calc(100%-1rem)]"
                          onClick={exportItemTable}
                          disabled={ordered.length === 0}
                        >
                          <Download />
                          {t('dex.exportTable')}
                        </Button>
                        <Separator className="my-1" />
                        <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">
                          {t('dex.recipeSection')}
                        </div>
                        <DexSettingField
                          id="dex-show-item-names"
                          label={t('dex.recipeShowNames')}
                          hint={t('dex.showItemNamesHint')}
                          checked={recipeShowNames}
                          onCheckedChange={setRecipeShowNames}
                        />
                        <DexSettingField
                          id="dex-two-column"
                          label={t('dex.recipeTwoColumn')}
                          hint={t('dex.twoColumnHint')}
                          checked={recipeTwoColumn}
                          onCheckedChange={setRecipeTwoColumn}
                        />
                      </FieldGroup>
                    </PopoverContent>
                  </Popover>
                </TooltipProvider>
  )

  const fullscreenToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={resultsFullscreen ? t('dex.exitFullscreen') : t('dex.enterFullscreen')}
      title={resultsFullscreen ? t('dex.exitFullscreen') : t('dex.enterFullscreen')}
      aria-pressed={resultsFullscreen}
      onClick={() => setResultsFullscreen((value) => !value)}
      className="text-muted-foreground hover:bg-card hover:text-foreground"
    >
      {resultsFullscreen ? <Minimize2 /> : <Maximize2 />}
    </Button>
  )

  return (
    <ItemFavoritesProvider api={favoritesApi}>
      <ItemDetailProvider api={detailApi}>
        <div
          ref={rootRef}
          data-testid="dex-page"
          data-fullscreen={resultsFullscreen || undefined}
          className={cn(
            'flex min-h-[360px] flex-col gap-3 overflow-hidden',
            resultsFullscreen && 'fixed inset-0 z-50 bg-background p-3 sm:p-4',
          )}
          style={{ height: resultsFullscreen ? '100dvh' : pageHeight }}
        >
          {/* 工具条：一张卡片 */}
          {!resultsFullscreen && (
          <Card className="shrink-0">
            <CardBody className="flex flex-col gap-2 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex w-full min-w-0 items-center gap-2 sm:flex-1">
                <div className="w-full max-w-sm">
                  <SearchInput
                    ref={searchRef}
                    value={state.query}
                    onValueChange={(v) => {
                      patch({ query: v })
                      resetScroll()
                    }}
                    placeholder={t('dex.placeholder')}
                    aria-label={t('nav.items')}
                    history={searchHistory}
                    onHistorySelect={selectKeyword}
                    onHistoryRemove={removeSearchHistory}
                    historyOnInput={false}
                    trailingIcon={<Search className="size-4 text-muted-foreground" />}
                    className="h-9 rounded-full pl-3 pr-1"
                    inputClassName="text-sm"
                  />
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('dex.resultCount', { n: ordered.length })}
                </span>
              </div>

              {/* 手机上搜索独占第一行；筛选项从下一行开始。 */}
              <div className="ml-0 flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground sm:ml-auto sm:w-auto">
                <div className="flex min-w-0 items-center rounded-lg bg-accent p-0.5">
                  <ToggleGroup
                    type="single"
                    value={activeTopMode}
                    onValueChange={selectTopMode}
                    aria-label={t('dex.filter')}
                    variant="outline"
                    size="sm"
                    className="flex-wrap"
                  >
                    <ToggleGroupItem value="all" data-testid="dex-mode-all">
                      {t('dex.collectionAll')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="favorites" data-testid="dex-favorites-toggle">
                      <Star
                        className={cn(activeTopMode === 'favorites' && 'fill-current')}
                        data-icon="inline-start"
                      />
                      {t('dex.favorites')}
                      <span className="tabular-nums opacity-70">{favoriteItems.length}</span>
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <Separator orientation="vertical" className="mx-1 h-4" />

                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('dex.collectionGroup')}
                    onClick={() => setGroupDrawerOpen(true)}
                    className={cn(
                      'max-w-64 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground',
                      (collection || gameMode) && 'bg-card font-semibold text-foreground shadow-sm',
                    )}
                  >
                    <ListFilter className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 truncate">
                      {collection
                        ? t('dex.groupCurrent', {
                            group: t(`dex.group.${collection.group}`),
                            name:
                              collection.group === 'range'
                                ? rangeTabLabel(collection)
                                : collection.name,
                          })
                        : gameMode
                          ? t('dex.groupCurrent', {
                              group: t('dex.tabs'),
                              name: t(`dex.tab.${effectiveGroupTab}`),
                            })
                          : t('dex.collectionGroup')}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                  {(collection || gameMode) && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('dex.clearGroup')}
                      title={t('dex.clearGroup')}
                      onClick={clearGroup}
                      className="text-muted-foreground hover:bg-card hover:text-foreground"
                    >
                      <X />
                    </Button>
                  )}
                </div>

                {itemsSettingsControl}

                {fullscreenToggle}
              </div>
            </CardBody>
          </Card>
          )}

          {resultsFullscreen && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-border/60 bg-card/95 p-1 shadow-sm backdrop-blur">
              {itemsSettingsControl}
              {fullscreenToggle}
            </div>
          )}

          <DexGroupDrawer
            open={groupDrawerOpen}
            onOpenChange={setGroupDrawerOpen}
            groupQuery={groupQuery}
            onGroupQueryChange={setGroupQuery}
            groupTabs={groupTabs}
            tabCounts={tabCounts}
            gameMode={gameMode}
            effectiveGroupTab={effectiveGroupTab}
            isCollectionGroup={isCollectionGroup}
            mode={state.mode}
            collectionId={state.collectionId}
            openGroup={openGroup}
            onOpenGroupChange={setOpenGroup}
            recentGroups={recentGroupEntries}
            searchResults={groupSearchResults}
            onApplyToken={applyGroupToken}
            onSelectGameTab={selectGameTab}
            onSelectCollection={selectCollectionItem}
          />

          {/* 结果区：不是卡片（直接铺在页面上），内部滚动；overscroll-contain 防止滚轮带动整页 */}
          <div
            ref={scrollRef}
            data-testid="dex-list"
            onScroll={handleScroll}
            onKeyDown={handleGridKeyDown}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
          >
            {favoritesEmpty || ordered.length === 0 ? (
              <Empty className="min-h-40 border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">{favoritesEmpty ? <Star /> : <Search />}</EmptyMedia>
                  <EmptyTitle>{favoritesEmpty ? t('dex.favoritesEmpty') : t('dex.noMatch')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : tableView ? (
              <ItemTableLayout
                rows={ordered}
                atlas={dataset.atlas}
                selectedId={state.selectedId}
                twoCols={effectiveTableTwoCols}
                onSelect={selectCell}
              />
            ) : (
              <div className="relative" style={{ height: layout.totalHeight }}>
                {/* 位置还原完成前只占高度、不挂格子（挂载发生在页面高度就绪之后） */}
                {scrollReady && (
                <div
                  className="absolute right-0 left-0 grid justify-start"
                  style={{
                    top: layout.offsetTop,
                    gridTemplateColumns: `repeat(${layout.cols}, ${cell}px)`,
                    gap: CELL_GAP,
                  }}
                >
                  {visible.map((item, index) => (
                    <DexCell
                      key={item.id}
                      item={item}
                      atlas={dataset.atlas}
                      selected={state.selectedId === item.id}
                      width={cell}
                      height={cellHeight}
                      index={layout.startIndex + index}
                      compact={compactCells}
                      hideMeta={hideItemMeta}
                      onSelect={selectCell}
                    />
                  ))}
                </div>
                )}
              </div>
            )}
          </div>

          {/* 详情：**可堆叠**抽屉（合成区域较长，抽屉比分栏弹框更好用）。
              在抽屉里点配方材料 / 产物、或用提示里的「合成表」入口，会再叠一层，关掉即返回上一层。 */}
          {detail.stack.length > 0 && (
            <ItemDetailDrawer
              dataset={dataset}
              stack={detail.stack}
              index={0}
              rootPrefixId={state.prefixId}
              onRootPrefixChange={(prefixId) => patch({ prefixId })}
              recipe={detailRecipe}
              closingFrom={detail.closingFrom}
              onCloseFrom={closeDetailFrom}
              onClosed={commitDetailClose}
            />
          )}
        </div>
      </ItemDetailProvider>
    </ItemFavoritesProvider>
  )
}
