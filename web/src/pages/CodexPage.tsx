import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { NpcSprite } from '@/components/NpcSprite'
import { SearchInput } from '@/components/SearchInput'
import {
  Badge,
  Card,
  CardBody,
  Checkbox,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { usePageHeight } from '@/hooks/usePageHeight'
import { useSearchHistory } from '@/hooks/useSearchHistory'
import { cn } from '@/lib/cn'
import { readCodexState, rememberCodexState, type CodexKind } from '@/lib/codexState'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { NPC_COLLECTIONS, NPC_COLLECTION_BY_ID, npcCollectionName } from '@/lib/npcCollections'
import { PAGE_SIZES, clampPage, paginate, paginationRange, totalPages } from '@/lib/pagination'
import { StorageKeys } from '@/lib/storage'
import type { Atlas, Item, Npc, TileWallData, TileWallEntry } from '@/types'

/** 格子里的贴图框尺寸（NPC 贴图与物品图标共用，保证两种数据源对齐；默认 64×64）。 */
const THUMB_SIZE = 64
/** 切到「Boss」分类时放大到 128×128。 */
const THUMB_SIZE_BOSS = 128

const EMPTY_TILEWALL: TileWallData = {
  meta: { gameVersion: '', count: 0, withItem: 0, source: '', generatedBy: '', note: '' },
  entries: [],
}

const CELL_CLASS =
  'flex cursor-pointer flex-col items-center gap-1 rounded-xl px-1 py-2 text-center transition'
const CELL_HOVER =
  'hover:-translate-y-0.5 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/**
 * 数据图鉴（原「NPC 图鉴」+「数据 ID」合并）：**同一套网格**浏览 NPC / 图格 / 墙。
 *
 * - 布局沿用物品图鉴：工具条一张卡片、中间是可滚动网格（不套白色卡片）、底部固定翻页器
 *   （件数 ｜ 数据版本 + 每页数量 + shadcn `Pagination`）。
 * - 数据源切换用 `ToggleGroup`（NPC / 图格 / 墙）；NPC 额外带分类筛选（全部 / Boss / 各分类）。
 * - 点任意格子 → **右侧抽屉**（`Sheet`）看详情：NPC = 贴图 / 名称 / ID / 内部名；
 *   图格 / 墙 = 图标 / 名称 / ID / 内部名 / 代表物品 / 摆放尺寸。
 * - 搜索框进入页面即聚焦；**聚焦时不弹「最近搜索」**，打字（或点右侧历史按钮）才弹。
 *
 * 只读页：不执行任何指令（`/sb` / `/sm` 都只能在游戏内执行）。
 */
export function CodexPage() {
  const { t, lang } = useI18n()
  const dataset = useDataset()
  const npcs = useMemo(() => dataset?.npcs ?? [], [dataset])

  // 页面状态（数据源 tab / NPC 分类 / 页码 / 每页数量 / 两列表格 / 滚动位置）记在模块内存里：
  // 切到其它页面再回来会还原，刷新页面则重置（见 lib/codexState.ts）。
  const [initial] = useState(readCodexState)
  const [kind, setKind] = useState<CodexKind>(initial.kind)
  const [query, setQuery] = useState('')
  // 搜索词是在哪个数据源下输入的：切换数据源时会清空搜索，避免把上一个源的词记进另一个源的历史。
  const [queryKind, setQueryKind] = useState<CodexKind>(initial.kind)
  // NPC 单行筛选：'' = 全部，'boss' = Boss，其余 = 分类 id。
  const [npcFilter, setNpcFilter] = useState(initial.npcFilter)
  const [page, setPage] = useState(initial.page)
  const [pageSize, setPageSize] = useState(initial.pageSize)
  // 图格 / 墙表格是否排成左右两列（默认开）。
  const [twoCols, setTwoCols] = useState(initial.twoCols)
  const [selected, setSelected] = useState<{ kind: CodexKind; id: number } | null>(null)
  const debounced = useDebouncedValue(query, 150)

  // 「最近搜索」按数据源分开记（沿用原来的两个存储键，老记录不丢）。
  const npcHistory = useSearchHistory(StorageKeys.npcsSearchHistory)
  const dataHistory = useSearchHistory(StorageKeys.tilesSearchHistory)
  const searchHistory = kind === 'npc' ? npcHistory.history : dataHistory.history

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pageHeight = usePageHeight(rootRef)

  // 把当前状态存到 ref，卸载（切走）时一次性写回模块内存。
  const stateRef = useRef({ kind, npcFilter, page, pageSize, twoCols })
  useEffect(() => {
    stateRef.current = { kind, npcFilter, page, pageSize, twoCols }
  }, [kind, npcFilter, page, pageSize, twoCols])
  const scrollTopRef = useRef(initial.scrollTop)
  useEffect(
    () => () => {
      rememberCodexState({ ...stateRef.current, scrollTop: scrollTopRef.current })
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
      if (npcFilter === 'boss' && !n.sb) return false
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
  const source = kind === 'wall' ? (dataset?.walls ?? EMPTY_TILEWALL) : (dataset?.tiles ?? EMPTY_TILEWALL)
  const nameOf = useMemo(
    () => (e: TileWallEntry) =>
      e.item != null ? (dataset?.itemsById.get(e.item)?.name ?? e.key) : e.key,
    [dataset],
  )

  const filteredData = useMemo(() => {
    if (kind === 'npc') return []
    const q = debounced.trim().toLowerCase()
    if (!q) return source.entries
    return source.entries.filter((e) => {
      if (String(e.id) === q) return true
      if (e.key.toLowerCase().includes(q)) return true
      return nameOf(e).toLowerCase().includes(q)
    })
  }, [kind, source.entries, debounced, nameOf])

  const total = kind === 'npc' ? filteredNpcs.length : filteredData.length
  const sourceCount = kind === 'npc' ? npcs.length : source.entries.length
  const pageCount = totalPages(total, pageSize)
  const current = clampPage(page, pageCount)
  const npcRows = kind === 'npc' ? paginate(filteredNpcs, current, pageSize) : []
  const dataRows = kind === 'npc' ? [] : paginate(filteredData, current, pageSize)
  const range = paginationRange(current, pageCount)

  // 换数据源 / 搜索 / 筛选 / 每页数量 → 回第一页并把网格滚动复位。
  // 跳过首次渲染：否则切回本页时会把上次记忆的页码 / 滚动位置清掉。
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    setPage(1)
    scrollTopRef.current = 0
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [debounced, kind, npcFilter, pageSize])

  // 搜过的词进「最近搜索」（统一规则：最多 10 条），按当前数据源分别记。
  const rememberNpc = npcHistory.remember
  const rememberData = dataHistory.remember
  useEffect(() => {
    const q = debounced.trim()
    if (!q || queryKind !== kind) return
    if (kind === 'npc') rememberNpc(q)
    else rememberData(q)
  }, [debounced, kind, queryKind, rememberNpc, rememberData])

  const changeQuery = (next: string) => {
    setQuery(next)
    setQueryKind(kind)
  }

  const switchKind = (next: CodexKind) => {
    setKind(next)
    // 换数据源就清空搜索：一个源里搜的词（如 NPC 名）在另一个源里只会得到空列表。
    setQuery('')
    setPage(1)
  }

  const goToPage = (next: number) => {
    setPage(next)
    scrollTopRef.current = 0
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  const selectedNpc =
    selected?.kind === 'npc' ? (dataset?.npcsById.get(selected.id) ?? null) : null
  const selectedData =
    selected && selected.kind !== 'npc'
      ? (selected.kind === 'tile'
          ? dataset?.tilesById.get(selected.id)
          : dataset?.wallsById.get(selected.id)) ?? null
      : null
  const selectedKind: CodexKind = selected?.kind ?? 'npc'

  // 切到 Boss 分类时贴图 / 图标绘制区放大到 128×128（其余 64×64）。
  const bossView = kind === 'npc' && npcFilter === 'boss'
  const thumbSize = bossView ? THUMB_SIZE_BOSS : THUMB_SIZE

  return (
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
            value={query}
            onValueChange={changeQuery}
            placeholder={
              kind === 'npc'
                ? t('codex.search.npc')
                : kind === 'tile'
                  ? t('codex.search.tile')
                  : t('codex.search.wall')
            }
            aria-label={t('nav.codex')}
            history={searchHistory}
            className="h-9"
            inputClassName="text-sm"
          />
          {/* 数据源 + NPC 分类（名称与 ID 在 lib/npcCollections.ts 配置） */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ToggleGroup
              type="single"
              value={kind}
              onValueChange={(v) => v && switchKind(v as CodexKind)}
              aria-label={t('codex.tabs')}
              className="flex-wrap"
            >
              <ToggleGroupItem value="npc">{t('codex.tab.npc')}</ToggleGroupItem>
              <ToggleGroupItem value="tile">{t('codex.tab.tile')}</ToggleGroupItem>
              <ToggleGroupItem value="wall">{t('codex.tab.wall')}</ToggleGroupItem>
            </ToggleGroup>
            {kind === 'npc' && (
              <>
                <Separator orientation="vertical" className="h-5" />
                <ToggleGroup
                  type="single"
                  value={npcFilter || 'all'}
                  onValueChange={(v) => {
                    if (v) setNpcFilter(v === 'all' ? '' : v)
                  }}
                  aria-label={t('npcs.collections')}
                  className="flex-wrap"
                >
                  <ToggleGroupItem value="all">{t('npcs.filter.all')}</ToggleGroupItem>
                  <ToggleGroupItem value="boss">{t('npcs.filter.boss')}</ToggleGroupItem>
                  {NPC_COLLECTIONS.map((c) => (
                    <ToggleGroupItem key={c.id} value={c.id}>
                      {npcCollectionName(c, lang)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </>
            )}
            {kind !== 'npc' && (
              <>
                <Separator orientation="vertical" className="h-5" />
                {/* 两列表格开关（默认开）：图格 / 墙表格列少，大屏左右两张表更短更好读 */}
                <label className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox
                    checked={twoCols}
                    onCheckedChange={(v) => setTwoCols(v === true)}
                    aria-label={t('codex.table.twoCols')}
                    data-testid="codex-two-cols"
                  />
                  {t('codex.table.twoCols')}
                </label>
              </>
            )}
          </div>
        </CardBody>
      </Card>

      {/* 网格：不是卡片（直接铺在页面上），内部滚动 */}
      <div
        ref={scrollRef}
        data-testid="codex-list"
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
                {kind === 'npc' ? t('codex.empty.npc') : t('codex.empty.data')}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : kind === 'npc' ? (
          <div
            className={cn(
              'grid gap-1.5',
              bossView
                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'
                : 'grid-cols-4 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10',
            )}
          >
            {npcRows.map((npc) => (
              <NpcCell
                key={npc.id}
                npc={npc}
                size={thumbSize}
                selected={selected?.kind === 'npc' && selected.id === npc.id}
                onSelect={() => setSelected({ kind: 'npc', id: npc.id })}
              />
            ))}
          </div>
        ) : (
          <DataTableLayout
            rows={dataRows}
            kind={kind}
            twoCols={twoCols}
            nameOf={nameOf}
            itemOf={(e) => (e.item != null ? dataset?.itemsById.get(e.item) : undefined)}
            atlas={dataset?.atlas}
            onSelect={(entry) => setSelected({ kind, id: entry.id })}
          />
        )}
      </div>

      {/* 翻页器（底部固定，与物品图鉴同一套）：件数 ｜ 数据版本 + 每页数量 + Pagination */}
      <div
        data-testid="codex-pager"
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{t('codex.summary', { n: total })}</span>
          <Separator orientation="vertical" className="h-3.5" />
          <span>
            {t('codex.version', {
              count: sourceCount,
              version: dataset?.meta.gameVersion ?? '—',
            })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <FieldLabel htmlFor="codex-page-size" className="font-normal text-muted-foreground">
              {t('dex.pageSize')}
            </FieldLabel>
            <NativeSelect
              id="codex-page-size"
              size="sm"
              className="w-20"
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {PAGE_SIZES.map((n) => (
                <NativeSelectOption key={n} value={String(n)}>
                  {n}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <span className="sr-only" aria-live="polite">
            {t('dex.page', { page: current, pages: pageCount })}
          </span>
          <Pagination aria-label={t('dex.pagination')} className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  aria-label={t('dex.prev')}
                  disabled={current <= 1}
                  onClick={() => goToPage(current - 1)}
                />
              </PaginationItem>
              {range.map((item, i) =>
                item === 'ellipsis' ? (
                  <PaginationItem key={`e${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      isActive={item === current}
                      aria-label={t('dex.goToPage', { page: item })}
                      onClick={() => goToPage(item)}
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  aria-label={t('dex.next')}
                  disabled={current >= pageCount}
                  onClick={() => goToPage(current + 1)}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>

      {/* 详情：右侧抽屉（NPC 与图格 / 墙共用，内容按数据源切换） */}
      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent
          side="right"
          data-testid="codex-detail"
          data-kind={selectedKind}
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-sm"
        >
          {(selectedNpc || selectedData) && (
            <>
              <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
                <SheetTitle>
                  {selectedKind === 'npc'
                    ? t('codex.detail.npc')
                    : selectedKind === 'tile'
                      ? t('codex.detail.tile')
                      : t('codex.detail.wall')}
                </SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                {selectedNpc ? (
                  <NpcDetail npc={selectedNpc} />
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

function NpcCell({
  npc,
  size,
  selected,
  onSelect,
}: {
  npc: Npc
  /** 贴图绘制区边长（64 / Boss 128）。 */
  size: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${npc.name} #${npc.id}`}
      className={cn(CELL_CLASS, CELL_HOVER, selected && 'bg-primary/20')}
    >
      <NpcSprite id={npc.id} size={size} name={npc.name} />
      <span className="font-pixel text-[10px] leading-none text-muted-foreground">{npc.id}</span>
      <span className="w-full truncate text-xs leading-4 text-foreground">{npc.name}</span>
    </button>
  )
}

/** 图格尺寸标签：1×1（或无尺寸）不显示；多格才显示 `W×H`（如 1×2 / 2×2）。 */
function tileSizeLabel(entry: TileWallEntry): string {
  const s = entry.size
  if (!s) return ''
  const [w, h] = s
  return w === 1 && h === 1 ? '' : `${w}×${h}`
}

/** 图格 / 墙：用表格展示（图标 / ID / 名称 / 内部名，图格另有尺寸列）。列少，大屏排成左右两张表。 */
function DataTableLayout({
  rows,
  kind,
  twoCols,
  nameOf,
  itemOf,
  atlas,
  onSelect,
}: {
  rows: TileWallEntry[]
  kind: CodexKind
  /** 是否允许排成两列（右上角 checkbox，默认开）。 */
  twoCols: boolean
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  onSelect: (entry: TileWallEntry) => void
}) {
  // 开启两列且行数够多时，在 xl 排成左右两张表（页面短一半，读起来也舒服）；行少就一张表。
  const split = twoCols && rows.length > 8
  const half = split ? Math.ceil(rows.length / 2) : rows.length
  const left = rows.slice(0, half)
  const right = split ? rows.slice(half) : []
  return (
    <div className={cn('grid gap-x-6 gap-y-3', split && 'xl:grid-cols-2')}>
      <DataTable
        rows={left}
        kind={kind}
        nameOf={nameOf}
        itemOf={itemOf}
        atlas={atlas}
        onSelect={onSelect}
      />
      {right.length > 0 && (
        <DataTable
          rows={right}
          kind={kind}
          nameOf={nameOf}
          itemOf={itemOf}
          atlas={atlas}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}

/** 单张表：图标 + ID + 名称 + 尺寸（图格）+ 内部名；斑马纹 + hover + 行可点（打开详情）；表头吸顶。 */
function DataTable({
  rows,
  kind,
  nameOf,
  itemOf,
  atlas,
  onSelect,
}: {
  rows: TileWallEntry[]
  kind: CodexKind
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  onSelect: (entry: TileWallEntry) => void
}) {
  const { t } = useI18n()
  const isTile = kind === 'tile'
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          {isTile && <col className="w-12" />}
          <col />
        </colgroup>
        {/* 表头不铺白底：用页面背景色（半透明 + 模糊），吸顶时也不会看到下面的行糊在一起 */}
        <thead className="sticky top-0 z-10 bg-background/90 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-right font-medium">
              {isTile ? 'TileID' : 'WallID'}
            </th>
            <th className="px-1 py-2 text-center font-medium">{t('codex.table.icon')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('codex.table.name')}</th>
            {isTile && (
              <th className="px-2 py-2 text-center font-medium">{t('codex.table.size')}</th>
            )}
            <th className="px-3 py-2 text-left font-medium">{t('codex.table.key')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const name = nameOf(entry)
            const item = itemOf(entry)
            // 没有代表物品（名称就是内部名）→ 用等宽 + 弱色 + 斜体区分。
            const fallback = entry.item == null
            return (
              <tr
                key={entry.id}
                title={`${name} #${entry.id}`}
                tabIndex={0}
                onClick={() => onSelect(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(entry)
                  }
                }}
                className={cn(
                  'cursor-pointer border-t border-border/50 transition-colors',
                  // 斑马纹（奇数行浅底）+ hover / 键盘聚焦
                  'odd:bg-muted/25 hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none',
                )}
              >
                <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">
                  {entry.id}
                </td>
                <td className="px-1 py-0.5">
                  <span className="flex items-center justify-center">
                    {item ? (
                      <ItemIcon item={item} atlas={atlas} size={24} name={name} tooltip={false} />
                    ) : (
                      <span className="inline-block size-5 rounded bg-muted/60" aria-hidden />
                    )}
                  </span>
                </td>
                <td
                  className={cn(
                    'truncate px-3 py-1.5',
                    fallback ? 'font-mono text-muted-foreground italic' : 'text-foreground',
                  )}
                  title={name}
                >
                  {name}
                </td>
                {isTile && (
                  <td className="px-2 py-1.5 text-center font-mono text-xs text-muted-foreground">
                    {tileSizeLabel(entry) && (
                      <span className="inline-block rounded bg-accent/60 px-1.5 py-0.5 text-[11px]">
                        {tileSizeLabel(entry)}
                      </span>
                    )}
                  </td>
                )}
                <td
                  className="truncate px-3 py-1.5 font-mono text-xs text-muted-foreground"
                  title={entry.key}
                >
                  {entry.key}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  title,
}: {
  label: string
  value: string
  mono?: boolean
  title?: string
}) {
  return (
    <div className="grid w-full grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn('truncate text-right text-foreground', mono && 'font-mono')}
        title={title ?? value}
      >
        {value}
      </span>
    </div>
  )
}

function NpcDetail({ npc }: { npc: Npc }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex size-40 items-center justify-center rounded-xl bg-accent/60">
        {/* 详情大图用 fit：小动物（如 10×16 的萤火虫）在 game 模式下会只有十像素，看不见 */}
        <NpcSprite id={npc.id} size={144} name={npc.name} mode="fit" />
      </div>
      <div className="text-center">
        <div className="text-base font-semibold text-foreground">{npc.name}</div>
        <div className="font-pixel text-xs text-muted-foreground">#{npc.id}</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {npc.sb && <Badge tone="mock">{t('npcs.badge.boss')}</Badge>}
        {npc.sbAll && <Badge tone="purple">/sb all</Badge>}
      </div>
      <DetailRow label={t('codex.field.internal')} value={npc.key} mono />
    </div>
  )
}

function DataDetail({
  entry,
  kind,
  item,
  atlas,
}: {
  entry: TileWallEntry
  kind: CodexKind
  item: Item | undefined
  atlas: Atlas | undefined
}) {
  const { t } = useI18n()
  const name = item?.name ?? entry.key
  const fallback = !item
  const size = entry.size ?? [1, 1]
  const multi = size[0] > 1 || size[1] > 1
  const sizeLabel = entry.size
    ? `${size[0]}×${size[1]}`
    : entry.frameImportant
      ? t('codex.size.variable')
      : '1×1'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-40 items-center justify-center rounded-xl bg-accent/60">
          {item ? (
            <ItemIcon item={item} atlas={atlas} size={96} name={name} tooltip={false} />
          ) : (
            <span className="inline-block size-24 rounded bg-muted/60" aria-hidden />
          )}
        </div>
        <div className="text-center">
          <div
            className={cn(
              'text-base font-semibold',
              fallback ? 'font-mono text-muted-foreground italic' : 'text-foreground',
            )}
          >
            {name}
          </div>
          <div className="font-pixel text-xs text-muted-foreground">
            {kind === 'wall' ? 'WallID' : 'TileID'} #{entry.id}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <Badge tone="neutral">
            {kind === 'wall' ? t('codex.tab.wall') : t('codex.tab.tile')}
          </Badge>
          {kind === 'tile' && multi && <Badge tone="accent">{t('tiles.badge.multi')}</Badge>}
          {kind === 'tile' && !entry.size && entry.frameImportant && (
            <Badge tone="warn">{t('codex.size.variable')}</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <DetailRow label={t('codex.field.internal')} value={entry.key} mono />
        <div className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 text-xs">
          <span className="text-muted-foreground">{t('codex.field.item')}</span>
          {item ? (
            <span className="flex min-w-0 items-center justify-end gap-1.5">
              {/* 带悬停提示（游戏同款物品提示） */}
              <ItemIcon item={item} atlas={atlas} size={20} name={item.name} />
              <span className="truncate text-foreground">
                {item.name} #{item.id}
              </span>
            </span>
          ) : (
            <span className="text-right text-muted-foreground">—</span>
          )}
        </div>
        {kind === 'tile' && (
          <DetailRow
            label={t('codex.field.size')}
            value={sizeLabel}
            title={
              entry.size
                ? multi
                  ? t('tiles.badge.multi')
                  : undefined
                : entry.frameImportant
                  ? t('tiles.size.variable')
                  : undefined
            }
          />
        )}
      </div>

      <ul className="flex list-disc flex-col gap-1 rounded-lg bg-muted/40 py-2.5 pr-3 pl-7 text-[11px] leading-relaxed text-muted-foreground">
        <li>{t('tiles.note.name')}</li>
        <li>{t('tiles.note.size')}</li>
        <li>{t('tiles.note.version')}</li>
      </ul>
    </div>
  )
}
