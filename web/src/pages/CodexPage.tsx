import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { DataDetail, DataTableLayout, NpcCell, NpcDetail } from '@/components/codex/CodexViews'
import { SearchInput } from '@/components/SearchInput'
import {
  Card,
  CardBody,
  Checkbox,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
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
import type { TileWallData, TileWallEntry } from '@/types'

/** 格子里的贴图框尺寸（NPC 贴图与物品图标共用，保证两种数据源对齐；默认 64×64）。 */
const THUMB_SIZE = 64
/** 切到「Boss」分类时放大到 128×128。 */
const THUMB_SIZE_BOSS = 128

const EMPTY_TILEWALL: TileWallData = {
  meta: { gameVersion: '', count: 0, withItem: 0, source: '', generatedBy: '', note: '' },
  entries: [],
}

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
                <Field orientation="horizontal" className="w-auto">
                  <Checkbox
                    id="codex-two-cols"
                    checked={twoCols}
                    onCheckedChange={(v) => setTwoCols(v === true)}
                    data-testid="codex-two-cols"
                  />
                  <FieldLabel htmlFor="codex-two-cols" className="cursor-pointer font-normal">
                    {t('codex.table.twoCols')}
                  </FieldLabel>
                </Field>
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

