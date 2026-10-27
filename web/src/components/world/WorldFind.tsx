import { useMemo, useState } from 'react'
import { Download, MapPin, Search, X } from 'lucide-react'
import { SearchInput } from '@/components/SearchInput'
import { downloadBlob } from '@/lib/playerPage'
import { Alert, AlertDescription, Button, Card, CardBody, Spinner } from '@/components/ui'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import {
  findMatches,
  targetKey,
  type FindTarget,
  type FindTilesResult,
} from '@/lib/save/worldFind'
import type { ParsedWorld } from '@/lib/save/worldFile'
import { searchTargets, type TileSearchHit } from '@/lib/tiles'
import { cn } from '@/lib/cn'

/** 结果里最多列出多少个坐标（其余提示省略）。 */
const MAX_LISTED = 200

export interface TileMarkers {
  kind: 'tile' | 'wall' | 'liquid'
  id: number
  /** 图例文案（如「生命水晶 ×37」）。 */
  label: string
  hits: { x: number; y: number }[]
}

interface WorldFindProps {
  /** 原始 `.wld` 字节（扫描需要重新走一遍图格流）。 */
  bytes: Uint8Array
  parsed: ParsedWorld
  onMarkersChange: (markers: TileMarkers | null) => void
  /** 点某个坐标 → 在 1:1 大图里跳到那里（父组件负责打开弹窗）。 */
  onFocusHit?: (hit: { x: number; y: number }) => void
}

/**
 * 「查找图格」：按名字（生命水晶 / 石块 / 金矿…）在世界里定位图格。
 *
 * 名字解析见 `lib/tiles.ts`（口径 = 游戏地图图例）；扫描见 `lib/save/worldFind.ts`。
 * 命中后可以「在缩略图上标记」，把坐标交给 `WorldPanel` 叠加。
 */
export function WorldFind({ bytes, parsed, onMarkersChange, onFocusHit }: WorldFindProps) {
  const world = parsed.info
  const { t } = useI18n()
  const dataset = useDataset()
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<TileSearchHit | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<FindTilesResult | null>(null)
  const [marked, setMarked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hits = useMemo(
    () => (query.trim() ? searchTargets(dataset, query, t, 12) : []),
    [dataset, query, t],
  )

  const clear = () => {
    setTarget(null)
    setResult(null)
    setMarked(false)
    setProgress(0)
    onMarkersChange(null)
  }

  const run = async (hit: TileSearchHit) => {
    setTarget(hit)
    setRunning(true)
    setError(null)
    setResult(null)
    setMarked(false)
    setProgress(0)
    onMarkersChange(null)
    try {
      const target: FindTarget = { kind: hit.kind, id: hit.id }
      const res = await findMatches(bytes, parsed, [target], { onProgress: setProgress })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const toggleMark = () => {
    if (!target || !result) return
    const next = !marked
    setMarked(next)
    onMarkersChange(
      next
        ? { kind: target.kind, id: target.id, label: `${target.name} ×${result.hits.length}`, hits: result.hits }
        : null,
    )
  }

  /** 导出坐标列表（`x, y` 每行一个，带一行抬头，方便贴进表格 / 脚本）。 */
  const exportHits = () => {
    if (!target || !result || result.hits.length === 0) return
    const header = [
      `# ${target.name} (${target.kind} #${target.id})`,
      `# world: ${world.name} ${world.width}x${world.height}`,
      `# hits: ${result.counts.get(targetKey(target)) ?? 0}`,
      'x,y',
    ]
    const body = result.hits.map((hit) => `${hit.x},${hit.y}`)
    const text = [...header, ...body].join('\n') + '\n'
    downloadBlob(
      new Blob([text], { type: 'text/csv;charset=utf-8' }),
      `${(world.name || 'world').replace(/[\\/:*?"<>|\s]+/g, '_')}-${target.key}.csv`,
    )
  }

  const count = target && result ? (result.counts.get(targetKey(target)) ?? 0) : 0

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-sm font-medium">{t('wld.find.title')}</h3>
          <span className="text-2xs text-muted-foreground">{t('wld.find.hint')}</span>
        </div>

        <SearchInput
          value={query}
          onValueChange={(v) => {
            setQuery(v)
            setTarget(null)
            setResult(null)
            setMarked(false)
            onMarkersChange(null)
          }}
          placeholder={t('wld.find.placeholder')}
        />

        {/* 候选：点一下就扫描 */}
        {query.trim() && !target && (
          <ul className="flex flex-col gap-0.5" data-testid="wld-find-candidates">
            {hits.length === 0 && (
              <li className="px-1 py-2 text-2xs text-muted-foreground">{t('wld.find.noMatch')}</li>
            )}
            {hits.map((hit) => (
              // key 带 kind：候选里同时有图格 / 墙 / 液体，id 可能重复（如液体 1 与图格 1）
              <li key={`${hit.kind}:${hit.id}`}>
                <button
                  type="button"
                  onClick={() => void run(hit)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Search className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="truncate">{hit.name}</span>
                  <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
                    #{hit.id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 扫描中 / 结果 */}
        {target && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <MapPin className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{target.name}</span>
              <span className="text-2xs text-muted-foreground tabular-nums">#{target.id}</span>
              {running ? (
                <span className="ml-auto flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <Spinner aria-hidden /> {t('wld.find.scanning', { percent: Math.round(progress * 100) })}
                </span>
              ) : (
                <span className="ml-auto tabular-nums">
                  {t('wld.find.found', { n: count.toLocaleString() })}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5"
                onClick={clear}
                aria-label={t('wld.find.clear')}
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {result && count > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={marked ? 'primary' : 'outline'}
                    size="sm"
                    className="h-7 px-2 text-2xs"
                    onClick={toggleMark}
                  >
                    <MapPin data-icon="inline-start" />
                    {marked ? t('wld.find.unmark') : t('wld.find.mark')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-2xs"
                    onClick={exportHits}
                  >
                    <Download data-icon="inline-start" />
                    {t('wld.find.export')}
                  </Button>
                  {result.truncated && (
                    <span className="text-2xs text-muted-foreground">
                      {t('wld.find.truncated', { n: result.hits.length })}
                    </span>
                  )}
                </div>
                <ul
                  className="grid max-h-40 grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto text-2xs tabular-nums text-muted-foreground @[520px]:grid-cols-4"
                  data-testid="wld-find-hits"
                >
                  {result.hits.slice(0, MAX_LISTED).map((hit) => (
                    <li key={`${hit.x},${hit.y}`}>
                      <button
                        type="button"
                        onClick={() => onFocusHit?.(hit)}
                        className="tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        title={t('wld.find.jump')}
                      >
                        {hit.x}, {hit.y}
                      </button>
                    </li>
                  ))}
                </ul>
                {result.hits.length > MAX_LISTED && (
                  <span className="text-2xs text-muted-foreground">
                    {t('wld.find.showingTop', { n: MAX_LISTED })}
                  </span>
                )}
              </>
            )}

            {result && count === 0 && (
              <p className={cn('text-2xs text-muted-foreground')}>{t('wld.find.none')}</p>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardBody>
    </Card>
  )
}
