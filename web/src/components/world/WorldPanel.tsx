import { useCallback, useEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import {
  Badge,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Separator,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { useDataset } from '@/lib/datasetContext'
import { WORLD_LIQUIDS, wallDisplayName } from '@/lib/tiles'
import { tileAt } from '@/lib/save/worldTileAt'
import { TILE_COLORS } from '@/lib/save/worldColors.generated'
import type { WorldThumb } from '@/lib/save/worldThumb'
import type { ParsedWorld, WorldInfo } from '@/lib/save/worldFile'
import { playerGameVersion } from '@/lib/save/playerVersions'
import { bossKey, formatWorldTime, gameModeKey, worldSizeKey } from '@/lib/worldPage'

/** 查找结果的标记（与 `lib/save/worldFind.ts` 的结果对应）。 */
export interface WorldMarkers {
  kind: 'tile' | 'wall' | 'liquid'
  id: number
  /** 图例文案（如「生命水晶 ×37」）。 */
  label: string
  hits: { x: number; y: number }[]
}

interface WorldPanelProps {
  world: WorldInfo
  thumb: WorldThumb
  /** 「查找图格」命中的坐标：画在缩略图上的小方点（可选）。 */
  markers?: WorldMarkers | null
  /** 要跳转并高亮的坐标（点查找结果里的坐标时设置，`seq` 变化即触发一次）。 */
  focus?: { x: number; y: number; seq: number } | null
  /** 关掉 1:1 大图时通知父组件清掉 `focus`（否则 `open` 会一直为 true，关不掉）。 */
  onFocusClear?: () => void
  /** 原始 `.wld` 字节 + 解析结果：有了它们才能「悬停看这一格是什么」（可选）。 */
  bytes?: Uint8Array
  parsed?: ParsedWorld
}

/** 一行「标签 + 值」；值为空时不渲染（避免满屏占位符）。 */
function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm text-foreground" title={value}>
        {value}
      </dd>
    </div>
  )
}

/** 缩略图位图 → `<canvas>`（浏览器本地绘制；导出图片也用同一份像素）。 */
function paintThumbnail(thumb: WorldThumb, canvas: HTMLCanvasElement | null) {
  if (!canvas) return
  canvas.width = thumb.width
  canvas.height = thumb.height
  // jsdom（单测）里没有 canvas 2d / ImageData：直接跳过绘制，不影响信息展示。
  if (typeof ImageData === 'undefined') return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // ImageData 直接包住同一块缓冲（不再复制一遍）；putImageData 会把它画进 canvas。
  ctx.putImageData(new ImageData(thumb.pixels, thumb.width, thumb.height), 0, 0)
}

/**
 * 把命中的图格坐标画到缩略图上（**独立的覆盖层 canvas**，不改动缩略图位图本身）。
 *
 * 世界坐标 → 缩略图坐标的比例由 `thumb.width / world.width` 决定（与渲染时的 `res` 一致）。
 */
function paintMarkers(
  markers: WorldMarkers | null | undefined,
  world: WorldInfo,
  thumb: WorldThumb,
  canvas: HTMLCanvasElement | null,
  focus?: { x: number; y: number } | null,
) {
  if (!canvas) return
  canvas.width = thumb.width
  canvas.height = thumb.height
  const ctx = canvas.getContext('2d')
  // jsdom（单测）里 getContext 返回的是残缺 stub：缺绘制 API 就直接跳过，别让测试炸。
  if (!ctx || typeof ctx.beginPath !== 'function') return
  const sx = thumb.width / world.width
  const sy = thumb.height / world.height
  // 点的大小随缩放走：至少 2px，命中稀疏时更明显。
  const size = Math.max(2, Math.min(6, Math.round(Math.min(sx, sy) * 3) || 2))
  ctx.fillStyle = '#ff2d55'
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'
  ctx.lineWidth = 1
  for (const hit of markers?.hits ?? []) {
    const px = Math.floor(hit.x * sx)
    const py = Math.floor(hit.y * sy)
    ctx.fillRect(px, py, size, size)
    ctx.strokeRect(px - 0.5, py - 0.5, size + 1, size + 1)
  }
  // 出生点 / 地牢：固定标注（与查找命中共用覆盖层，避免多一层 canvas）。
  const pin = (point: { x: number; y: number }, color: string) => {
    const px = Math.floor(point.x * sx)
    const py = Math.floor(point.y * sy)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(px + 0.5, py + 0.5, 4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(px - 6, py + 0.5)
    ctx.lineTo(px + 6, py + 0.5)
    ctx.moveTo(px + 0.5, py - 6)
    ctx.lineTo(px + 0.5, py + 6)
    ctx.stroke()
  }
  ctx.lineWidth = 1.5
  if (validPoint(world.spawn, world)) pin(world.spawn, '#22c55e')
  if (validPoint(world.dungeon, world)) pin(world.dungeon, '#a855f7')

  // 跳转目标：画一个空心高亮圈（比点大一圈，便于定位）。
  if (focus) {
    const px = Math.floor(focus.x * sx)
    const py = Math.floor(focus.y * sy)
    ctx.strokeStyle = '#ffd60a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(px + size / 2, py + size / 2, Math.max(6, size * 2), 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** 图格 → `#rrggbb`（与缩略图渲染同一张颜色表；表里没有的用中性灰，和渲染时一致）。 */
function tileColorHex(id: number): string {
  const color = id >= 0 && id < TILE_COLORS.length && TILE_COLORS[id] !== 0 ? TILE_COLORS[id] : 0x808080
  return `#${color.toString(16).padStart(6, '0')}`
}

/** 占比文案：≥1% 保留一位小数，否则给两位（避免 0.0%）。 */
function formatPct(count: number, total: number): string {
  if (!total) return '0%'
  const p = (count / total) * 100
  return p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`
}

/** 世界坐标是否在合理范围内（越界的不画标注）。 */
function validPoint(point: { x: number; y: number }, world: WorldInfo): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height
}

/**
 * 世界概览：缩略图（浏览器本地渲染）+ 徽章 + 基本信息 + Boss 进度。
 *
 * 只展示存档里真实记录的值；读不到的字段（如旧存档的种子 / 创建时间）直接不显示。
 */
export function WorldPanel({ world, thumb, markers, focus, onFocusClear, bytes, parsed }: WorldPanelProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** 悬停的图格（世界坐标 + 指针在容器里的百分比位置）；null = 没有悬停。 */
  const [hover, setHover] = useState<
    { x: number; y: number; left: number; top: number; tile: number; wall: number; liquid: number } | null
  >(null)
  const markersRef = useRef<HTMLCanvasElement>(null)
  const zoomRef = useRef<HTMLCanvasElement>(null)
  /** 点击缩略图 → 打开 1:1 大图（可滚动看清方块）。 */
  const [zoomed, setZoomed] = useState(false)

  const paintZoom = useCallback(() => paintThumbnail(thumb, zoomRef.current), [thumb])

  useEffect(() => {
    paintThumbnail(thumb, canvasRef.current)
  }, [thumb])

  useEffect(() => {
    paintMarkers(markers, world, thumb, markersRef.current, focus)
  }, [markers, world, thumb, focus])

  // 点查找结果里的坐标 → 打开 1:1 大图并滚到那个位置（`seq` 变化触发，重复点同一处也能再跳）。
  const scrollRef = useRef<HTMLDivElement>(null)
  // 打开状态直接由 `focus` 派生（不在 effect 里 setState，避免级联渲染）。
  const zoomOpen = zoomed || Boolean(focus)
  useEffect(() => {
    if (!focus) return
    const el = scrollRef.current
    if (!el) return
    const sx = thumb.width / world.width
    const sy = thumb.height / world.height
    // 让目标落在视口中心（缩略图是 1:1 像素，直接按像素滚）。
    el.scrollTo({
      left: Math.max(0, focus.x * sx - el.clientWidth / 2),
      top: Math.max(0, focus.y * sy - el.clientHeight / 2),
      behavior: 'smooth',
    })
  }, [focus, thumb.width, thumb.height, world.width, world.height])

  const seedBadges = world.specialSeeds.map((seed) => t(`wld.seed.${seed}`))
  const bosses = world.bossesDowned.map((boss) => t(`wld.boss.${bossKey(boss, world.evil)}`))
  const dungeon =
    world.dungeon.x >= 0 && world.dungeon.y >= 0
      ? `${world.dungeon.x}, ${world.dungeon.y}`
      : t('wld.none')

  return (
    <Card>
      <CardBody className="flex flex-col gap-4 pt-4">
        {/* 屏幕上是「原图缩小」：按容器宽度缩放（默认平滑，不强制 nearest）。点击看 1:1 大图。 */}
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label={t('wld.zoomHint')}
          title={t('wld.zoomHint')}
          className="group relative w-full cursor-zoom-in overflow-hidden rounded-control border border-border"
          data-testid="world-thumb-button"
          onMouseMove={(e) => {
            const el = e.currentTarget
            const rect = el.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            const fx = (e.clientX - rect.left) / rect.width
            const fy = (e.clientY - rect.top) / rect.height
            const x = Math.min(world.width - 1, Math.max(0, Math.floor(fx * world.width)))
            const y = Math.min(world.height - 1, Math.max(0, Math.floor(fy * world.height)))
            const cell =
              bytes && parsed && thumb.columnOffsets ? tileAt(bytes, parsed, thumb.columnOffsets, x, y) : null
            setHover({
              x,
              y,
              left: Math.min(85, Math.max(0, fx * 100)),
              top: Math.min(85, Math.max(0, fy * 100)),
              tile: cell?.tile ?? -1,
              wall: cell?.wall ?? 0,
              liquid: cell?.liquid ?? 0,
            })
          }}
          onMouseLeave={() => setHover(null)}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={t('wld.thumbnail')}
            data-testid="world-thumbnail"
            className="block w-full"
            style={{ aspectRatio: `${thumb.width} / ${thumb.height}` }}
          />
          {/* 查找结果的覆盖层（独立 canvas，避免改动缩略图位图 / 导出图片） */}
          <canvas
            ref={markersRef}
            aria-hidden
            data-testid="world-thumbnail-markers"
            data-marked={markers?.hits.length ?? 0}
            data-pins={validPoint(world.spawn, world) || validPoint(world.dungeon, world) ? '1' : '0'}
            className="pointer-events-none absolute inset-0 block w-full"
            style={{ aspectRatio: `${thumb.width} / ${thumb.height}` }}
          />
          {/* 悬停这一格是什么：图格名 / 墙名 / 液体 + 坐标 */}
          {hover && (
            <span
              data-testid="world-hover-tip"
              className="pointer-events-none absolute z-10 max-w-[70%] truncate rounded bg-black/75 px-2 py-0.5 text-2xs text-white tabular-nums"
              style={{ left: `${hover.left}%`, top: `${hover.top}%` }}
            >
              {[
                hover.tile >= 0
                  ? (dataset?.tileNameById.get(hover.tile) ?? dataset?.tilesById.get(hover.tile)?.key ?? `#${hover.tile}`)
                  : t('wld.hover.air'),
                hover.wall > 0
                  ? `${t('wld.hover.wall')} ${wallDisplayName(dataset, hover.wall)}`
                  : null,
                hover.liquid > 0
                  ? t(WORLD_LIQUIDS.find((l) => l.id === hover.liquid)?.nameKey ?? 'wld.hover.air')
                  : null,
                `${hover.x}, ${hover.y}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          {markers && markers.hits.length > 0 && (
            <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-2 py-0.5 text-2xs text-white">
              {markers.label}
            </span>
          )}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <ZoomIn className="mr-2 size-4" />
            {t('wld.zoomHint')}
          </span>
        </button>

        <Dialog
          open={zoomOpen}
          onOpenChange={(open) => {
            setZoomed(open)
            // 打开态还可能来自 `focus`：不清掉它，关掉后会被 `zoomOpen` 立刻拉回来。
            if (!open) onFocusClear?.()
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] gap-3 sm:max-w-[90vw]">
            <DialogHeader>
              <DialogTitle>{world.name || t('wld.untitled')}</DialogTitle>
              <DialogDescription>{t('wld.zoomDesc')}</DialogDescription>
            </DialogHeader>
            <div
              ref={scrollRef}
              data-testid="world-zoom-scroll"
              className="max-h-[72vh] overflow-auto rounded-control border border-border bg-muted"
            >
              <canvas
                ref={(el) => {
                  zoomRef.current = el
                  if (el && zoomOpen) paintZoom()
                }}
                role="img"
                aria-label={t('wld.thumbnail')}
                data-testid="world-thumbnail-zoom"
                className="block max-w-none"
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* 图例：缩略图上的颜色对应哪些方块（与渲染同一张 `TILE_COLORS`，取占比最高的 6 种）。
            不加标题——色块 + 名字本身说明了一切。 */}
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="world-legend">
          {[...thumb.stats.tiles.entries()]
            .sort((a, b) => b[1] - a[1] || a[0] - b[0])
            .slice(0, 6)
            .map(([id, count]) => (
              <li key={id} className="flex items-center gap-1 text-2xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2.5 rounded-chip ring-1 ring-border"
                  style={{ backgroundColor: tileColorHex(id) }}
                />
                <span className="max-w-32 truncate text-foreground">
                  {dataset?.tileNameById.get(id) ?? dataset?.tilesById.get(id)?.key ?? `#${id}`}
                </span>
                <span className="tabular-nums">{formatPct(count, thumb.stats.total)}</span>
              </li>
            ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">
            {world.name || t('wld.untitled')}
          </h2>
          <Badge tone="neutral">{t(`wld.mode.${gameModeKey(world.gameMode)}`)}</Badge>
          <Badge tone="neutral">{t(`wld.size.${worldSizeKey(world.width)}`)}</Badge>
          <Badge tone={world.evil === 'crimson' ? 'danger' : 'purple'}>
            {t(`wld.evil.${world.evil}`)}
          </Badge>
          {world.hardmode && <Badge tone="warn">{t('wld.hardmode')}</Badge>}
          {world.favorite && <Badge tone="gold">{t('wld.favorite')}</Badge>}
          <Badge tone="mock">{t('wld.imported')}</Badge>
        </div>

        {seedBadges.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {seedBadges.map((label) => (
              <Badge key={label} tone="accent">
                {label}
              </Badge>
            ))}
          </div>
        )}

        <Separator />

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <Row label={t('wld.size')} value={`${world.width} × ${world.height}`} />
          <Row label={t('wld.seed')} value={world.seed} />
          <Row label={t('wld.created')} value={formatWorldTime(world.createdAt)} />
          <Row label={t('wld.lastPlayed')} value={formatWorldTime(world.lastPlayed)} />
          <Row label={t('wld.spawn')} value={`${world.spawn.x}, ${world.spawn.y}`} />
          <Row label={t('wld.dungeon')} value={dungeon} />
          <Row
            label={t('wld.version')}
            value={
              // 世界与角色共用同一套 release 编号，所以直接复用角色版本表（如 326 → 1.4.5.8）
              playerGameVersion(world.release)
                ? `${playerGameVersion(world.release)}（${world.release}）`
                : String(world.release)
            }
          />
          <Row label={t('wld.revision')} value={String(world.revision)} />
        </dl>

        <Separator />

        <div className="flex flex-col gap-2">
          <p className="text-2xs text-muted-foreground">{t('wld.progress')}</p>
          {bosses.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {bosses.map((name) => (
                <Badge key={name} tone="success">
                  {name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('wld.progressNone')}</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
