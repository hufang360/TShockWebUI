import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import {
  Button,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Separator,
} from '@/components/ui'
import { SearchInput } from '@/components/SearchInput'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { downloadBlob } from '@/lib/playerPage'
import type { WorldInfo } from '@/lib/save/worldFile'
import { analysisFilename, buildAnalysisText } from '@/lib/save/worldAnalysisText'
import type { WorldSections } from '@/lib/save/worldStats'
import type { WorldTileStats } from '@/lib/save/worldThumb'
import { wallDisplayName } from '@/lib/tiles'
import { cn } from '@/lib/cn'

/** 一行的数据（id + 数量），按数量降序排好再交给渲染。 */
type CountRow = { id: number; count: number }

/** 默认展示的行数（剩下的折叠起来，避免一次列出几百种图格）。 */
const TOP_ROWS = 12

interface WorldAnalysisProps {
  info: WorldInfo
  stats: WorldTileStats
  sections: WorldSections
}

/** 明细抽屉的种类：箱子 / 招牌 / NPC。 */
type DetailKind = 'chests' | 'signs' | 'npcs'

function sortedRows(map: Map<number, number>): CountRow[] {
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id - b.id)
}

/** 百分比：分母是总格数（宽 × 高），与 TEdit 的分析报告口径一致。 */
function pct(count: number, total: number): string {
  if (total <= 0) return '0%'
  const p = (count / total) * 100
  if (p >= 10) return `${p.toFixed(1)}%`
  if (p >= 1) return `${p.toFixed(2)}%`
  return `${p.toFixed(3)}%`
}

/**
 * 「地图分析」：图格 / 墙体 / 液体占比 + 箱子·招牌·NPC·图格实体数量 + 箱子物品 Top。
 *
 * 数据来源：图格统计与缩略图**同一次解码**（`worldThumb.ts`），段计数来自 `worldStats.ts`。
 * 名字全部走 dataset 的本地化表（`tilesById` / `wallsById` / `itemsById`）。
 */
export function WorldAnalysis({ info, stats, sections }: WorldAnalysisProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  const [expanded, setExpanded] = useState(false)
  const [showWalls, setShowWalls] = useState(false)
  const [detail, setDetail] = useState<DetailKind | null>(null)
  /** 明细里的过滤词（箱子按物品名，招牌按文本，NPC 按名字）。 */
  const [detailQuery, setDetailQuery] = useState('')

  const tiles = useMemo(() => sortedRows(stats.tiles), [stats.tiles])
  const walls = useMemo(() => sortedRows(stats.walls), [stats.walls])
  const chestItems = useMemo(
    () => (sections.chestItems ? sortedRows(sections.chestItems) : []),
    [sections.chestItems],
  )

  // 图格 / 墙的显示名：与缩略图图例、查找图格**同一套**口径
  // （图格走 dataset 预计算的 `tileNameById`：MapObject → 图例物品 → 代表物品 → 常量名；
  //  墙没有地图图例名，走 `wallDisplayName`：代表物品 → 常量名）。别再在这里另写一套回退链，
  //  否则同一件事「地图分析显示 Heart、查找显示生命水晶」。
  const tileName = (id: number) => dataset?.tileNameById.get(id) ?? dataset?.tilesById.get(id)?.key ?? `#${id}`
  const wallName = (id: number) => wallDisplayName(dataset, id)
  const itemName = (id: number) => dataset?.itemsById.get(id)?.name ?? `#${id}`
  const airPct = pct(stats.air, stats.total)
  const maxTile = tiles[0]?.count ?? 0
  const maxWall = walls[0]?.count ?? 0

  const bar = (count: number, max: number) => (
    <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
        style={{ width: `${max > 0 ? Math.max(2, (count / max) * 100) : 0}%` }}
      />
    </span>
  )

  const row = (key: string, name: string, count: number, total: number, max: number) => (
    <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="truncate text-sm">{name}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count.toLocaleString()} · {pct(count, total)}
      </span>
      {bar(count, max)}
    </li>
  )

  const chips: { key: string; label: string; value: string }[] = [{ key: 'air', label: t('wld.analysis.air'), value: airPct }]
  const liquids: [keyof WorldTileStats['liquid'], string][] = [
    ['water', 'wld.analysis.water'],
    ['lava', 'wld.analysis.lava'],
    ['honey', 'wld.analysis.honey'],
    ['shimmer', 'wld.analysis.shimmer'],
  ]
  for (const [key, labelKey] of liquids) {
    const n = stats.liquid[key]
    if (n > 0) chips.push({ key, label: t(labelKey), value: `${n.toLocaleString()}` })
  }
  /** 明细按当前搜索词过滤（箱子：任一物品名匹配；招牌：文本匹配；NPC：名字匹配）。 */
  const filteredDetail = useMemo(() => {
    const q = detailQuery.trim().toLowerCase()
    if (!q) {
      return {
        chests: sections.chestList ?? [],
        signs: sections.signList ?? [],
        npcs: sections.npcList ?? [],
      }
    }
    return {
      chests: (sections.chestList ?? []).filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.items.some((it) => itemName(it.id).toLowerCase().includes(q)),
      ),
      signs: (sections.signList ?? []).filter((s2) => s2.text.toLowerCase().includes(q)),
      npcs: (sections.npcList ?? []).filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          (dataset?.npcsById.get(n.netId)?.name ?? '').toLowerCase().includes(q),
      ),
    }
    // itemName/dataset 都从 dataset 派生，依赖项里带上 dataset 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQuery, sections.chestList, sections.signList, sections.npcList, dataset])

  const detailList = (kind: Exclude<DetailKind, never>) =>
    kind === 'chests' ? sections.chestList : kind === 'signs' ? sections.signList : sections.npcList
  const counters: { key: DetailKind | 'entities'; label: string; value: number | null }[] = [
    { key: 'chests', label: t('wld.analysis.chests'), value: sections.chests },
    { key: 'signs', label: t('wld.analysis.signs'), value: sections.signs },
    { key: 'npcs', label: t('wld.analysis.npcs'), value: sections.npcs },
    { key: 'entities', label: t('wld.analysis.tileEntities'), value: sections.tileEntities },
  ]

  /** 导出分析文本（格式对齐参考件，含逐箱内容 / 招牌全文 / NPC 明细）。 */
  const exportAnalysis = () => {
    const text = buildAnalysisText({
      info,
      stats,
      sections,
      names: {
        tile: tileName,
        wall: wallName,
        item: itemName,
        prefix: (id) => dataset?.prefixesById.get(id)?.name ?? `#${id}`,
        npc: (netId) => dataset?.npcsById.get(netId)?.name ?? `#${netId}`,
      },
      exportedAt: new Date().toISOString(),
    })
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), analysisFilename(info.name))
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-sm font-medium">{t('wld.analysis.title')}</h3>
          <span className="text-2xs text-muted-foreground">
            {t('wld.analysis.summary', { total: stats.total.toLocaleString(), kinds: tiles.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7 px-2 text-2xs"
            onClick={exportAnalysis}
          >
            <Download data-icon="inline-start" />
            {t('wld.analysis.export')}
          </Button>
        </div>

        {/* 概览：空气占比 + 液体 + 各段计数 */}
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-baseline gap-1 rounded-control border border-border/60 px-2 py-1 text-2xs"
            >
              <span className="text-muted-foreground">{chip.label}</span>
              <span className="font-medium tabular-nums">{chip.value}</span>
            </span>
          ))}
          {counters
            .filter(
              (c): c is { key: DetailKind | 'entities'; label: string; value: number } =>
                c.value != null,
            )
            .map((c) => {
              // 有明细才能点开（图格实体只给数量）
              const canOpen =
                c.key !== 'entities' ? Boolean(detailList(c.key as DetailKind)?.length) : false
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={!canOpen}
                  onClick={() => {
                    if (c.key === 'entities') return
                    setDetailQuery('')
                    setDetail(c.key)
                  }}
                  className={cn(
                    'inline-flex items-baseline gap-1 rounded-control border border-border/60 px-2 py-1 text-2xs',
                    canOpen ? 'hover:border-foreground/40 hover:bg-accent' : 'cursor-default',
                  )}
                >
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-medium tabular-nums">{c.value.toLocaleString()}</span>
                </button>
              )
            })}
        </div>

        <Separator />

        {/* 分层：地表 / 地下 / 洞穴 / 地狱（按存储层，不是生物群系） */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t('wld.analysis.zones')}</span>
          <ul className="flex flex-col gap-2" data-testid="analysis-zones">
            {stats.zones.map((zone, i) => {
              const from = stats.zoneBounds[i] ?? 0
              const to =
                (i === stats.zones.length - 1 ? info.height : (stats.zoneBounds[i + 1] ?? info.height)) - 1
              const top = sortedRows(zone.tiles).slice(0, 3)
              const empty = zone.total === 0
              return (
                <li key={zone.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="min-w-24">{t(`wld.analysis.zone.${zone.key}`)}</span>
                    <span className="text-2xs tabular-nums text-muted-foreground">
                      y {from}–{to}
                    </span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {t('wld.analysis.zone.air', { pct: empty ? '—' : pct(zone.air, zone.total) })}
                      {zone.liquid.lava > 0 && ` · ${t('wld.analysis.lava')} ${zone.liquid.lava.toLocaleString()}`}
                    </span>
                  </div>
                  <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
                      style={{ width: `${zone.total > 0 ? (1 - zone.air / zone.total) * 100 : 0}%` }}
                    />
                  </span>
                  {top.length > 0 && (
                    <p className="truncate text-2xs text-muted-foreground">
                      {top.map((r) => `${tileName(r.id)} ${pct(r.count, zone.total)}`).join(' · ')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <Separator />

        {/* 图格占比（Top N，可展开全部） */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('wld.analysis.tiles')}
            </span>
            {tiles.length > TOP_ROWS && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
                className="h-6 px-2 text-2xs"
              >
                {expanded ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
                {expanded ? t('wld.analysis.collapse') : t('wld.analysis.expand', { n: tiles.length })}
              </Button>
            )}
          </div>
          <ul className="flex flex-col gap-2" data-testid="analysis-tiles">
            {tiles.slice(0, expanded ? tiles.length : TOP_ROWS).map((r) =>
              row(`tile-${r.id}`, tileName(r.id), r.count, stats.total, maxTile),
            )}
          </ul>
        </div>

        {/* 墙体（默认折叠） */}
        {walls.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowWalls((v) => !v)}
                className="flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showWalls ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
                {t('wld.analysis.walls', { n: walls.length })}
              </button>
              {showWalls && (
                <ul className="flex flex-col gap-2" data-testid="analysis-walls">
                  {walls.slice(0, TOP_ROWS).map((r) =>
                    row(`wall-${r.id}`, wallName(r.id), r.count, stats.total, maxWall),
                  )}
                </ul>
              )}
            </div>
          </>
        )}

        {/* 箱子物品（数量 Top） */}
        {chestItems.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('wld.analysis.chestItems', { kinds: chestItems.length })}
              </span>
              <ul className="flex flex-col gap-2" data-testid="analysis-chest-items">
                {chestItems.slice(0, TOP_ROWS).map((r) => (
                  <li
                    key={`item-${r.id}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{itemName(r.id)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      ×{r.count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <p className={cn('text-2xs text-muted-foreground')}>{t('wld.analysis.note')}</p>
      </CardBody>

      {/* 明细抽屉：箱子逐格内容 / 招牌全文 / NPC 明细 */}
      <Dialog open={detail != null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {detail === 'chests'
                ? t('wld.analysis.detail.chests', { n: sections.chests ?? 0 })
                : detail === 'signs'
                  ? t('wld.analysis.detail.signs', { n: sections.signs ?? 0 })
                  : t('wld.analysis.detail.npcs', { n: sections.npcs ?? 0 })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <SearchInput
              value={detailQuery}
              onValueChange={setDetailQuery}
              placeholder={t('wld.analysis.detail.search')}
            />
            <p className="text-2xs text-muted-foreground tabular-nums">
              {t('wld.analysis.detail.matched', {
                n:
                  detail === 'chests'
                    ? filteredDetail.chests.length
                    : detail === 'signs'
                      ? filteredDetail.signs.length
                      : filteredDetail.npcs.length,
                total:
                  detail === 'chests'
                    ? (sections.chestList ?? []).length
                    : detail === 'signs'
                      ? (sections.signList ?? []).length
                      : (sections.npcList ?? []).length,
              })}
            </p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {detail === 'chests' && (
              <ul className="flex flex-col gap-2 text-sm">
                {filteredDetail.chests.map((chest, i) => (
                  <li key={`${chest.x},${chest.y},${i}`} className="flex flex-col gap-1">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      [{chest.x}, {chest.y}]{chest.name ? ` · ${chest.name}` : ''}
                    </span>
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      {chest.items.length === 0 ? (
                        <span className="text-2xs text-muted-foreground">
                          {t('wld.analysis.detail.emptyChest')}
                        </span>
                      ) : (
                        chest.items.map((it) => (
                          <span
                            key={it.slot}
                            className="inline-flex items-baseline gap-1 rounded border border-border/60 px-2 py-0.5 text-2xs"
                          >
                            {it.prefix > 0 && (
                              <span className="text-muted-foreground">
                                {dataset?.prefixesById.get(it.prefix)?.name ?? `#${it.prefix}`}
                              </span>
                            )}
                            <span>{itemName(it.id)}</span>
                            <span className="tabular-nums text-muted-foreground">×{it.stack}</span>
                          </span>
                        ))
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {detail === 'signs' && (
              <ul className="flex flex-col gap-2 text-sm">
                {filteredDetail.signs.map((sign, i) => (
                  <li key={`${sign.x},${sign.y},${i}`} className="flex flex-col gap-0.5">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      [{sign.x}, {sign.y}]
                    </span>
                    <span className="whitespace-pre-line">{sign.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {detail === 'npcs' && (
              <ul className="flex flex-col gap-2 text-sm">
                {filteredDetail.npcs.map((npc, i) => (
                  <li key={`${npc.netId},${i}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span>{dataset?.npcsById.get(npc.netId)?.name ?? `#${npc.netId}`}</span>
                    {npc.name && (
                      <span className="text-2xs text-muted-foreground">{npc.name}</span>
                    )}
                    <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                      [{npc.x.toFixed(0)}, {npc.y.toFixed(0)}]
                      {' · '}
                      {npc.homeless
                        ? t('wld.analysis.detail.homeless')
                        : `🏠 ${npc.homeX}, ${npc.homeY}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
