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
import type { WorldThumb } from '@/lib/save/worldThumb'
import type { WorldInfo } from '@/lib/save/worldFile'
import { bossKey, formatWorldTime, gameModeKey, worldSizeKey } from '@/lib/worldPage'

interface WorldPanelProps {
  world: WorldInfo
  thumb: WorldThumb
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
 * 世界概览：缩略图（浏览器本地渲染）+ 徽章 + 基本信息 + Boss 进度。
 *
 * 只展示存档里真实记录的值；读不到的字段（如旧存档的种子 / 创建时间）直接不显示。
 */
export function WorldPanel({ world, thumb }: WorldPanelProps) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoomRef = useRef<HTMLCanvasElement>(null)
  /** 点击缩略图 → 打开 1:1 大图（可滚动看清方块）。 */
  const [zoomed, setZoomed] = useState(false)

  const paintZoom = useCallback(() => paintThumbnail(thumb, zoomRef.current), [thumb])

  useEffect(() => {
    paintThumbnail(thumb, canvasRef.current)
  }, [thumb])

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
          className="group relative w-full cursor-zoom-in overflow-hidden rounded-lg border border-border"
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={t('wld.thumbnail')}
            data-testid="world-thumbnail"
            className="block w-full"
            style={{ aspectRatio: `${thumb.width} / ${thumb.height}` }}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <ZoomIn className="mr-1.5 size-4" />
            {t('wld.zoomHint')}
          </span>
        </button>

        <Dialog
          open={zoomed}
          onOpenChange={(open) => {
            setZoomed(open)
          }}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] gap-3 sm:max-w-[90vw]">
            <DialogHeader>
              <DialogTitle>{world.name || t('wld.untitled')}</DialogTitle>
              <DialogDescription>{t('wld.zoomDesc')}</DialogDescription>
            </DialogHeader>
            <div className="max-h-[72vh] overflow-auto rounded-lg border border-border bg-muted">
              <canvas
                ref={(el) => {
                  zoomRef.current = el
                  if (el && zoomed) paintZoom()
                }}
                role="img"
                aria-label={t('wld.thumbnail')}
                data-testid="world-thumbnail-zoom"
                className="block max-w-none"
              />
            </div>
          </DialogContent>
        </Dialog>

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
          <div className="flex flex-wrap items-center gap-1.5">
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
          <Row label={t('wld.version')} value={String(world.release)} />
          <Row label={t('wld.revision')} value={String(world.revision)} />
        </dl>

        <Separator />

        <div className="flex flex-col gap-1.5">
          <p className="text-2xs text-muted-foreground">{t('wld.progress')}</p>
          {bosses.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
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
