import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, Maximize2, Minimize2, Search, Settings2 } from 'lucide-react'
import {
  BuffDetail,
  BuffGrid,
  BuffTableLayout,
  DataDetail,
  DataTableLayout,
  NpcCell,
  NpcDetail,
  NpcTableLayout,
  TileIconGrid,
} from '@/components/dataid/DataIdViews'
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageHeight } from '@/hooks/usePageHeight'
import { useSearchHistory } from '@/hooks/useSearchHistory'
import { cn } from '@/lib/cn'
import { readDataIdState, rememberDataIdState, type DataIdKind } from '@/lib/dataIdState'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import {
  NPC_COLLECTIONS,
  NPC_COLLECTION_BY_ID,
  isBossNpc,
  npcCollectionName,
} from '@/lib/npcCollections'
import { StorageKeys } from '@/lib/storage'
import type { TileWallData, TileWallEntry } from '@/types'

/** 格子里的贴图框尺寸（NPC 贴图与物品图标共用，保证两种数据源对齐；默认 64×64）。 */
const THUMB_SIZE = 64
const EMPTY_TILEWALL: TileWallData = {
  meta: { gameVersion: '', count: 0, withItem: 0, source: '', generatedBy: '', note: '' },
  entries: [],
}

/**
 * 数据ID（原「数据图鉴」，由「NPC 图鉴」+「数据 ID」合并）：**同一套网格 / 表格**浏览 NPC / 图格 / 墙 / Buff。
 *
 * - 布局沿用物品图鉴：工具条一张卡片、中间是可滚动区域（不套白色卡片）；**无分页**，一次展示全部结果。
 * - 工具条：搜索框在第一行；下面一行左侧是数据源 `Tabs`（下划线样式），右侧是视图 checkbox + Wiki 链接。
 * - NPC / 图格 / Buff 支持**图标网格 / 表格**两种视图（checkbox 切换，默认图标）。
 * - 「两列表格」只在 `xl`（≥1280px）真的排成两列：小屏隐藏该开关并强制单列。
 * - NPC / Buff 详情用 **Popover**（图标 32×32）；图格 / 墙仍用右侧抽屉（`Sheet`）。
 * - 搜索框进入页面即聚焦；**聚焦时不弹「最近搜索」**，打字（或点右侧历史按钮）才弹。
 *
 * 只读页：不执行任何指令（`/sb` / `/sm` 都只能在游戏内执行）。
 */
export function DataIdPage() {
  const { t, lang } = useI18n()
  const dataset = useDataset()
  const npcs = useMemo(() => dataset?.npcs ?? [], [dataset])
  const buffs = useMemo(() => dataset?.buffs ?? [], [dataset])

  // 页面状态（数据源 tab / NPC 分类 / 页码 / 每页数量 / 两列表格 / 滚动位置）记在模块内存里：
  // 切到其它页面再回来会还原，刷新页面则重置（见 lib/dataIdState.ts）。
  const [initial] = useState(readDataIdState)
  const [kind, setKind] = useState<DataIdKind>(initial.kind)
  const [query, setQuery] = useState('')
  // 搜索词是在哪个数据源下输入的：切换数据源时会清空搜索，避免把上一个源的词记进另一个源的历史。
  const [queryKind, setQueryKind] = useState<DataIdKind>(initial.kind)
  // NPC 单行筛选：'' = 全部，'boss' = Boss，其余 = 分类 id。
  const [npcFilter, setNpcFilter] = useState(initial.npcFilter)
  // 图格 / 墙 / Buff 表格是否排成左右两列（默认开）。
  const [twoCols, setTwoCols] = useState(initial.twoCols)
  // 「两列表格」只在 xl（≥1280px）真能排成两列；小屏只有一列 → 隐藏开关，也按单列渲染。
  const twoColsAvailable = useMediaQuery('(min-width: 1280px)')
  const effectiveTwoCols = twoCols && twoColsAvailable
  // NPC / Buff 是否使用表格视图（默认关闭 = 图标网格）。
  const [tableView, setTableView] = useState(initial.tableView)
  // 图格是否把子 ID 平铺成独立行（默认关闭，只在详情里看）。
  const [expandStyles, setExpandStyles] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resultsFullscreen, setResultsFullscreen] = useState(false)
  // 图格 / 墙的抽屉详情（NPC / Buff 改用 Popover，不再走这里）。
  const [selected, setSelected] = useState<{ kind: DataIdKind; id: number } | null>(null)
  const debounced = useDebouncedValue(query, 150)

  // 「最近搜索」按数据源分开记（NPC / 图格·墙 / Buff，老记录不丢）。
  const npcHistory = useSearchHistory(StorageKeys.npcsSearchHistory)
  const dataHistory = useSearchHistory(StorageKeys.tilesSearchHistory)
  const buffHistory = useSearchHistory(StorageKeys.buffsSearchHistory)
  const searchHistory =
    kind === 'npc' ? npcHistory.history : kind === 'buff' ? buffHistory.history : dataHistory.history
  const removeSearchHistory =
    kind === 'npc' ? npcHistory.remove : kind === 'buff' ? buffHistory.remove : dataHistory.remove

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pageHeight = usePageHeight(rootRef)

  // 把当前状态存到 ref，卸载（切走）时一次性写回模块内存。
  const stateRef = useRef({ kind, npcFilter, twoCols, tableView })
  useEffect(() => {
    stateRef.current = { kind, npcFilter, twoCols, tableView }
  }, [kind, npcFilter, twoCols, tableView])
  const scrollTopRef = useRef(initial.scrollTop)
  useEffect(
    () => () => {
      rememberDataIdState({ ...stateRef.current, scrollTop: scrollTopRef.current })
    },
    [],
  )
  // 切页面回来时还原上次滚动位置（刷新后 initial.scrollTop = 0）。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && initial.scrollTop > 0) el.scrollTop = initial.scrollTop
    // 仅挂载时一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 进入页面即聚焦搜索框；下拉框只在打字 / 点历史按钮时出现（见 SearchInput 的 historyOnFocus）。
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const collectionIds = useMemo(() => {
    const c = npcFilter && npcFilter !== 'boss' ? NPC_COLLECTION_BY_ID.get(npcFilter) : undefined
    return c ? new Set(c.ids) : null
  }, [npcFilter])

  const filteredNpcs = useMemo(() => {
    if (kind !== 'npc') return []
    const q = debounced.trim().toLowerCase()
    return npcs.filter((n) => {
      if (npcFilter === 'boss' && !isBossNpc(n)) return false
      if (collectionIds && !collectionIds.has(n.id)) return false
      if (!q) return true
      if (String(n.id) === q) return true
      if (n.name.toLowerCase().includes(q)) return true
      if (n.key.toLowerCase().includes(q)) return true
      if (n.sb?.toLowerCase().includes(q)) return true
      return (n.sbAliases ?? []).some((a) => a.toLowerCase().includes(q))
    })
  }, [kind, npcs, debounced, npcFilter, collectionIds])

  // 图格 / 墙：名称取「放置它的代表物品」的本地化名，没有代表物品时回退内部名。
  // 展开子 ID 时，优先用该样式的代表物品名。
  const source = kind === 'wall' ? (dataset?.walls ?? EMPTY_TILEWALL) : (dataset?.tiles ?? EMPTY_TILEWALL)
  const nameOf = useMemo(
    () => (e: TileWallEntry) => {
      const itemId = e.subId != null ? e.styleItem : e.item
      if (itemId != null) return dataset?.itemsById.get(itemId)?.name ?? e.key
      return e.subId != null ? `${e.key} · ${e.subId}` : e.key
    },
    [dataset],
  )

  const filteredData = useMemo(() => {
    if (kind === 'npc') return []
    const q = debounced.trim().toLowerCase()
    if (!q) return source.entries
    return source.entries.filter((e) => {
      if (String(e.id) === q) return true
      if (e.key.toLowerCase().includes(q)) return true
      if (nameOf(e).toLowerCase().includes(q)) return true
      // 子 ID：支持 `21-3` 与样式物品名
      return Boolean(
        e.styles?.some((s) => {
          if (`${e.id}-${s.subId}` === q) return true
          const name = s.item != null ? dataset?.itemsById.get(s.item)?.name : undefined
          return Boolean(name?.toLowerCase().includes(q))
        }),
      )
    })
  }, [kind, source.entries, debounced, nameOf, dataset])

  /** 图格表：默认一行一个 TileID；勾选「展开子 ID」后每个样式一行。 */
  const dataRows = useMemo(() => {
    if (kind !== 'tile' || !expandStyles) return filteredData
    const q = debounced.trim().toLowerCase()
    return filteredData.flatMap((e) => {
      if (!e.styles || e.styles.length === 0) return [e]
      // 搜索 `21-1` 或样式名时，只展开匹配的样式；搜索 TileID 时展开全部。
      const styles = q
        ? e.styles.filter((s) => {
            if (`${e.id}-${s.subId}`.includes(q)) return true
            const name = s.item != null ? dataset?.itemsById.get(s.item)?.name : undefined
            return Boolean(name?.toLowerCase().includes(q))
          })
        : e.styles
      return (styles.length > 0 ? styles : e.styles).map((s) => ({
        ...e,
        subId: s.subId,
        styleItem: s.item,
      }))
    })
  }, [kind, expandStyles, filteredData, debounced, dataset])

  // Buff：名称取 `loc.BuffName`，搜索名称 / 内部名 / 数字 ID。
  const filteredBuffs = useMemo(() => {
    if (kind !== 'buff') return []
    const q = debounced.trim().toLowerCase()
    if (!q) return buffs
    return buffs.filter(
      (b) =>
        String(b.id) === q ||
        b.key.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q),
    )
  }, [kind, buffs, debounced])

  const total =
    kind === 'npc' ? filteredNpcs.length : kind === 'buff' ? filteredBuffs.length : filteredData.length

  // 换数据源 / 搜索 / 筛选 → 把列表滚动复位。
  // 跳过首次渲染：否则切回本页时会把上次记忆的滚动位置清掉。
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    scrollTopRef.current = 0
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [debounced, kind, npcFilter, tableView])

  // 搜过的词进「最近搜索」（统一规则：最多 10 条），按当前数据源分别记。
  const rememberNpc = npcHistory.remember
  const rememberData = dataHistory.remember
  const rememberBuff = buffHistory.remember
  useEffect(() => {
    const q = debounced.trim()
    if (!q || queryKind !== kind) return
    if (kind === 'npc') rememberNpc(q)
    else if (kind === 'buff') rememberBuff(q)
    else rememberData(q)
  }, [debounced, kind, queryKind, rememberNpc, rememberData, rememberBuff])

  const changeQuery = (next: string) => {
    setQuery(next)
    setQueryKind(kind)
  }

  const switchKind = (next: DataIdKind) => {
    setKind(next)
    setSettingsOpen(false)
    // 换数据源就清空搜索：一个源里搜的词（如 NPC 名）在另一个源里只会得到空列表。
    setQuery('')
  }

  // 全屏结果模式：Esc 退出，并锁住背景页面滚动。
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

  const selectedData =
    selected?.kind === 'tile' || selected?.kind === 'wall'
      ? (selected.kind === 'tile'
          ? dataset?.tilesById.get(selected.id)
          : dataset?.wallsById.get(selected.id)) ?? null
      : null
  const selectedNpc = selected?.kind === 'npc' ? dataset?.npcsById.get(selected.id) ?? null : null
  const selectedBuff = selected?.kind === 'buff' ? dataset?.buffsById.get(selected.id) ?? null : null
  const selectedKind: DataIdKind = selected?.kind ?? 'tile'

  // 所有 NPC 分类统一使用默认 64×64 图标绘制区。
  const thumbSize = THUMB_SIZE

  // 页面设置统一给出全部 Wiki 入口，不随当前 tab 增删。
  const wiki = (zh: string, en: string) =>
    lang === 'en'
      ? `https://terraria.wiki.gg/wiki/${en}`
      : `https://terraria.wiki.gg/zh/wiki/${encodeURIComponent(zh)}`
  const dataWikiLink = { href: wiki('数据_ID', 'Data_IDs'), label: t('dataId.wiki.data') }
  const otherWikiLinks = [
    { href: wiki('NPC_ID', 'NPC_IDs'), label: t('dataId.wiki.npc') },
    { href: wiki('图格_ID', 'Tile_IDs'), label: t('dataId.wiki.tile') },
    { href: wiki('墙_ID', 'Wall_IDs'), label: t('dataId.wiki.wall') },
    { href: wiki('增益_ID', 'Buff_IDs'), label: t('dataId.wiki.buff') },
  ]

  const exportCurrentTable = () => {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
    let headers: string[]
    let rows: string[][]
    if (kind === 'npc') {
      headers = ['NPCID', 'Name', 'InternalName']
      rows = filteredNpcs.map((npc) => [String(npc.id), npc.name, npc.key])
    } else if (kind === 'buff') {
      headers = ['BuffID', 'Name', 'InternalName']
      rows = filteredBuffs.map((buff) => [String(buff.id), buff.name, buff.key])
    } else {
      headers = [kind === 'tile' ? 'TileID' : 'WallID', 'Name', 'InternalName']
      if (kind === 'tile') headers.splice(2, 0, 'Size')
      rows = dataRows.map((entry) => {
        const row = [
          String(entry.subId != null ? `${entry.id}-${entry.subId}` : entry.id),
          nameOf(entry),
        ]
        if (kind === 'tile') {
          row.push(entry.size ? `${entry.size[0]}×${entry.size[1]}` : '')
        }
        row.push(entry.key)
        return row
      })
    }
    const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `tswui-${kind}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const settingsControl = (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('dataId.settings')}
          title={t('dataId.settings')}
          className={cn(
            'text-muted-foreground hover:bg-card hover:text-foreground',
            settingsOpen && 'bg-card text-foreground',
          )}
        >
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        data-testid="dataid-settings-popover"
      >
        <div className="border-b px-4 py-3 text-sm font-semibold text-foreground">
          {t('dataId.settings')}
        </div>

        <div className="flex flex-col gap-2 p-3">
          <div className="text-2xs font-medium text-muted-foreground">
            {t('dataId.settings.view')}
          </div>
          <FieldGroup className="gap-2">
            <div className="flex items-center justify-between gap-2">
              <Field orientation="horizontal" className="w-auto">
                <Checkbox
                  id="dataid-table-view"
                  aria-label={t('dataId.view.table')}
                  checked={tableView}
                  onCheckedChange={(v) => setTableView(v === true)}
                  data-testid="dataid-table-view"
                />
                <FieldLabel htmlFor="dataid-table-view" className="cursor-pointer font-normal">
                  {t('dataId.view.table')}
                </FieldLabel>
              </Field>
              <Button
                size="sm"
                variant="outline"
                onClick={exportCurrentTable}
                disabled={total === 0}
                className="h-7"
              >
                <Download />
                {t('dataId.exportTable')}
              </Button>
            </div>
            {twoColsAvailable && (
              <Field orientation="horizontal" className="w-auto">
                <Checkbox
                  id="dataid-two-cols"
                  aria-label={t('dataId.table.twoCols')}
                  checked={twoCols}
                  onCheckedChange={(v) => setTwoCols(v === true)}
                  data-testid="dataid-two-cols"
                />
                <FieldLabel htmlFor="dataid-two-cols" className="cursor-pointer font-normal">
                  {t('dataId.table.twoCols')}
                </FieldLabel>
              </Field>
            )}
          </FieldGroup>
        </div>

        <Separator />

        <div className="flex flex-col gap-2 p-3">
          <div className="text-2xs font-medium text-muted-foreground">
            {t('dataId.settings.reference')}
          </div>
          <div className="flex flex-col gap-1">
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id="dataid-expand-styles"
                aria-label={t('dataId.styles.expand')}
                checked={expandStyles}
                onCheckedChange={(v) => setExpandStyles(v === true)}
                data-testid="dataid-expand-styles"
              />
              <FieldLabel htmlFor="dataid-expand-styles" className="cursor-pointer font-normal">
                {t('dataId.styles.expand')}
              </FieldLabel>
            </Field>
            <p className="pl-6 text-2xs leading-4 text-muted-foreground">
              {t('dataId.styles.expandNote')}
            </p>
          </div>

          <Separator data-testid="dataid-wiki-separator" />
          <div data-testid="dataid-wiki" className="flex flex-col gap-2">
            <div>
              <a
                href={dataWikiLink.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {dataWikiLink.label}
              </a>
            </div>
            <div className="flex flex-wrap gap-2">
              {otherWikiLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )

  const fullscreenControl = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={resultsFullscreen ? t('dataId.exitFullscreen') : t('dataId.enterFullscreen')}
      title={resultsFullscreen ? t('dataId.exitFullscreen') : t('dataId.enterFullscreen')}
      aria-pressed={resultsFullscreen}
      onClick={() => setResultsFullscreen((value) => !value)}
      className="text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {resultsFullscreen ? <Minimize2 /> : <Maximize2 />}
    </Button>
  )

  return (
    <div
      ref={rootRef}
      data-testid="dataid-page"
      data-fullscreen={resultsFullscreen || undefined}
      className={cn(
        'flex min-h-[360px] flex-col gap-3 overflow-hidden',
        resultsFullscreen && 'fixed inset-0 z-50 bg-background',
      )}
      style={{ height: resultsFullscreen ? '100dvh' : pageHeight }}
    >
      {resultsFullscreen ? (
        <div className="pointer-events-auto absolute top-3 right-3 z-30 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {settingsControl}
          {fullscreenControl}
        </div>
      ) : (
        <>
          {/* 数据源 Tab 独立置顶。 */}
          <Tabs
            value={kind}
            onValueChange={(v) => switchKind(v as DataIdKind)}
            className="w-full shrink-0 gap-0"
          >
            <TabsList aria-label={t('dataId.tabs')} variant="line" className="w-full justify-start">
              <TabsTrigger value="npc" variant="line" className="flex-none">
                {t('dataId.tab.npc')}
              </TabsTrigger>
              <TabsTrigger value="tile" variant="line" className="flex-none">
                {t('dataId.tab.tile')}
              </TabsTrigger>
              <TabsTrigger value="wall" variant="line" className="flex-none">
                {t('dataId.tab.wall')}
              </TabsTrigger>
              <TabsTrigger value="buff" variant="line" className="flex-none">
                {t('dataId.tab.buff')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Card className="shrink-0">
            <CardBody className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4 pb-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="w-full max-w-sm min-w-0">
                  <SearchInput
                    ref={searchRef}
                    value={query}
                    onValueChange={changeQuery}
                    placeholder={
                      kind === 'npc'
                        ? t('dataId.search.npc')
                        : kind === 'tile'
                          ? t('dataId.search.tile')
                          : kind === 'wall'
                            ? t('dataId.search.wall')
                            : t('dataId.search.buff')
                    }
                    aria-label={t('nav.dataId')}
                    history={searchHistory}
                    onHistoryRemove={removeSearchHistory}
                    trailingIcon={<Search className="size-4 text-muted-foreground" />}
                    className="h-9 rounded-full pl-3 pr-1"
                    inputClassName="text-sm"
                  />
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('dataId.resultCount', { n: total })}
                </span>
              </div>

              <div className="ml-auto flex min-w-0 items-center gap-1">
                {kind === 'npc' && (
                  <Tabs
                    value={npcFilter || 'all'}
                    onValueChange={(value) => setNpcFilter(value === 'all' ? '' : value)}
                    className="w-auto max-w-full shrink-0 gap-0"
                  >
                    <TabsList
                      aria-label={t('npcs.collections')}
                      data-testid="npc-category-tabs"
                      className="h-8 max-w-full justify-start overflow-x-auto p-0.5"
                    >
                      <TabsTrigger value="all" className="h-7 flex-none px-2">
                        {t('npcs.filter.all')}
                      </TabsTrigger>
                      <TabsTrigger value="boss" className="h-7 flex-none px-2">
                        {t('npcs.filter.boss')}
                      </TabsTrigger>
                      {NPC_COLLECTIONS.map((c) => (
                        <TabsTrigger key={c.id} value={c.id} className="h-7 flex-none px-2">
                          {npcCollectionName(c, lang)}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
                {settingsControl}
                {fullscreenControl}
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {/* 网格：不是卡片（直接铺在页面上），内部滚动 */}
      <div
        ref={scrollRef}
        data-testid="dataid-list"
        onScroll={(e) => {
          scrollTopRef.current = e.currentTarget.scrollTop
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {total === 0 ? (
          <Empty className="min-h-40 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>
                {kind === 'npc' ? t('dataId.empty.npc') : t('dataId.empty.data')}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : kind === 'npc' ? (
          tableView ? (
            <NpcTableLayout rows={filteredNpcs} onSelect={(npc) => setSelected({ kind: 'npc', id: npc.id })} />
          ) : (
            <div
              className={cn(
                'grid gap-1.5',
                resultsFullscreen
                  ? 'grid-cols-[repeat(auto-fill,minmax(5rem,1fr))]'
                  : 'grid-cols-4 @[32rem]:grid-cols-6 @[48rem]:grid-cols-8 @[72rem]:grid-cols-10',
              )}
            >
              {filteredNpcs.map((npc) => (
                <NpcCell key={npc.id} npc={npc} size={thumbSize} onSelect={(value) => setSelected({ kind: 'npc', id: value.id })} />
              ))}
            </div>
          )
        ) : kind === 'buff' ? (
          tableView ? (
            <BuffTableLayout rows={filteredBuffs} twoCols={effectiveTwoCols} onSelect={(buff) => setSelected({ kind: 'buff', id: buff.id })} />
          ) : (
            <BuffGrid rows={filteredBuffs} fullscreen={resultsFullscreen} onSelect={(buff) => setSelected({ kind: 'buff', id: buff.id })} />
          )
        ) : (kind === 'tile' || kind === 'wall') && !tableView ? (
          <TileIconGrid
            rows={dataRows}
            nameOf={nameOf}
            itemOf={(e) =>
              dataset?.itemsById.get(e.subId != null ? (e.styleItem ?? -1) : (e.item ?? -1))
            }
            atlas={dataset?.atlas}
            fullscreen={resultsFullscreen}
            onSelect={(entry) => setSelected({ kind, id: entry.id })}
          />
        ) : (
          <DataTableLayout
            rows={dataRows}
            kind={kind}
            twoCols={effectiveTwoCols}
            nameOf={nameOf}
            itemOf={(e) =>
              dataset?.itemsById.get(e.subId != null ? (e.styleItem ?? -1) : (e.item ?? -1))
            }
            atlas={dataset?.atlas}
            onSelect={(entry) => setSelected({ kind, id: entry.id })}
          />
        )}
      </div>

      {/* 详情：图格 / 墙仍用右侧抽屉（NPC / Buff 已改为 Popover） */}
      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent
          side="right"
          data-testid="dataid-detail"
          data-kind={selectedKind}
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-sm"
        >
          {selected && (
            <>
              <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
                <SheetTitle>{t(`dataId.detail.${selectedKind}`)}</SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                {selectedNpc ? (
                  <NpcDetail npc={selectedNpc} large />
                ) : selectedBuff ? (
                  <BuffDetail buff={selectedBuff} large />
                ) : selectedData ? (
                  <DataDetail
                    entry={selectedData}
                    kind={selectedKind}
                    item={
                      selectedData.item != null
                        ? dataset?.itemsById.get(selectedData.item)
                        : undefined
                    }
                    atlas={dataset?.atlas}
                    itemsById={dataset?.itemsById}
                  />
                ) : null}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

