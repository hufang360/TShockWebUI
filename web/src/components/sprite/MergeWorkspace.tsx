import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ArrowDown, ArrowUp, Download, ImageUp, Trash2, Upload } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardBody,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldLabel,
  Input,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { downloadBlob } from '@/lib/playerPage'
import { canvasToBlob, sheetBaseName } from '@/lib/spriteSheet/export'
import { loadSheet, type LoadedSheet } from '@/lib/spriteSheet/load'
import { mergeLayout, type MergeDirection } from '@/lib/spriteSheet/merge'

const SMALL_INPUT = 'h-8 px-2 text-xs md:h-7'

interface MergeImage {
  id: number
  sheet: LoadedSheet
}

/**
 * 「精灵图 → 合并」：多张 PNG 按横向 / 纵向 / 网格拼成一张精灵图（不缩放，尺寸不同时居中）。
 *
 * 纯本地：解码与合成都在 canvas 里做，不上传、不请求接口。
 */
export function MergeWorkspace() {
  const { t } = useI18n()
  const [images, setImages] = useState<MergeImage[]>([])
  const [direction, setDirection] = useState<MergeDirection>('row')
  const [columns, setColumns] = useState(4)
  const [gap, setGap] = useState(0)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const idRef = useRef(1)
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const layout = useMemo(
    () =>
      mergeLayout(
        images.map((image) => ({ width: image.sheet.width, height: image.sheet.height })),
        { direction, columns, gap },
      ),
    [images, direction, columns, gap],
  )

  // 预览：直接按自然尺寸画到 canvas，再交给 CSS 缩放（像素保持锐利）。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = Math.max(1, layout.width)
    canvas.height = Math.max(1, layout.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    for (const placement of layout.placements) {
      const image = images[placement.index]
      if (!image) continue
      ctx.drawImage(image.sheet.source, placement.x, placement.y, placement.w, placement.h)
    }
  }, [images, layout])

  const addFiles = async (files: File[]) => {
    const pngs = files.filter((file) => /image\/(png|gif|webp|jpeg)/.test(file.type) || /\.(png|gif|webp|jpe?g)$/i.test(file.name))
    if (pngs.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const loaded = await Promise.all(pngs.map((file) => loadSheet(file)))
      setImages((prev) => [
        ...prev,
        ...loaded.map((sheet) => ({ id: idRef.current++, sheet })),
      ])
    } catch {
      setError(t('merge.err.read'))
    } finally {
      setImporting(false)
    }
  }

  const pickImport = () => inputRef.current?.click()

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length > 0) void addFiles(files)
  }

  const removeAt = (index: number) => {
    setImages((prev) => {
      const target = prev[index]
      target?.sheet.dispose()
      return prev.filter((_, i) => i !== index)
    })
  }

  const move = (index: number, delta: number) => {
    setImages((prev) => {
      const next = [...prev]
      const to = index + delta
      if (to < 0 || to >= next.length) return prev
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }

  const exportMerged = async () => {
    const canvas = canvasRef.current
    if (!canvas || layout.width < 1 || layout.height < 1) return
    setExporting(true)
    setError(null)
    try {
      const blob = await canvasToBlob(canvas)
      const file = `${sheetBaseName(images[0]?.sheet.name ?? 'sheet.png')}-merged.png`
      downloadBlob(blob, file)
      setNotice(t('merge.exported', { file, w: layout.width, h: layout.height }))
    } catch {
      setError(t('slice.err.export', { reason: 'canvas unavailable' }))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-testid="merge-drop"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && !error && (
        <Alert variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardBody className="flex flex-col gap-2.5 pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={importing} onClick={pickImport}>
              {importing ? (
                <Spinner aria-hidden data-icon="inline-start" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              {t('merge.import')}
            </Button>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {t('merge.count', { n: images.length })}
            </span>
            {images.length > 0 && (
              <span className="text-2xs text-muted-foreground tabular-nums">
                {t('merge.size', { w: layout.width, h: layout.height })}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <ToggleGroup
                size="sm"
                className="h-7 shrink-0"
                value={direction}
                onValueChange={(value) => {
                  if (value === 'row' || value === 'column' || value === 'grid') setDirection(value)
                }}
                aria-label={t('merge.direction')}
              >
                <ToggleGroupItem value="row" size="sm" aria-label={t('merge.dir.row')}>
                  {t('merge.dir.row')}
                </ToggleGroupItem>
                <ToggleGroupItem value="column" size="sm" aria-label={t('merge.dir.column')}>
                  {t('merge.dir.column')}
                </ToggleGroupItem>
                <ToggleGroupItem value="grid" size="sm" aria-label={t('merge.dir.grid')}>
                  {t('merge.dir.grid')}
                </ToggleGroupItem>
              </ToggleGroup>
              {direction === 'grid' && (
                <Field className="w-20 shrink-0 gap-0">
                  <FieldLabel htmlFor="merge-columns" className="text-2xs text-muted-foreground">
                    {t('merge.columns')}
                  </FieldLabel>
                  <Input
                    id="merge-columns"
                    name="merge-columns"
                    className={SMALL_INPUT}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={64}
                    value={columns}
                    onChange={(event) =>
                      setColumns(Math.min(64, Math.max(1, Number(event.target.value) || 1)))
                    }
                  />
                </Field>
              )}
              <Field className="w-20 shrink-0 gap-0">
                <FieldLabel htmlFor="merge-gap" className="text-2xs text-muted-foreground">
                  {t('merge.gap')}
                </FieldLabel>
                <Input
                  id="merge-gap"
                  name="merge-gap"
                  className={SMALL_INPUT}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={256}
                  value={gap}
                  onChange={(event) =>
                    setGap(Math.min(256, Math.max(0, Math.round(Number(event.target.value) || 0))))
                  }
                />
              </Field>
              <Button
                size="sm"
                variant="outline"
                disabled={images.length === 0 || exporting}
                onClick={() => void exportMerged()}
              >
                {exporting ? (
                  <Spinner aria-hidden data-icon="inline-start" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                {t('merge.export')}
              </Button>
            </div>
            <input
              ref={inputRef}
              id="merge-png-input"
              name="merge-png-input"
              type="file"
              accept="image/png,image/*"
              multiple
              className="hidden"
              data-testid="merge-png-input"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ''
                void addFiles(files)
              }}
            />
          </div>

          {images.length === 0 ? (
            <Empty className="min-h-32 border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageUp />
                </EmptyMedia>
                <EmptyTitle>{t('merge.empty')}</EmptyTitle>
                <EmptyDescription>{t('merge.emptyHint')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div
              className="overflow-auto rounded-control border border-border/60"
              style={{
                backgroundColor: 'var(--muted)',
                backgroundImage:
                  'repeating-conic-gradient(rgba(127,127,127,0.14) 0% 25%, transparent 0% 50%)',
                backgroundSize: '16px 16px',
              }}
            >
              <canvas
                ref={canvasRef}
                aria-label={t('merge.preview')}
                className="mx-auto block h-auto max-w-full [image-rendering:pixelated]"
              />
            </div>
          )}
        </CardBody>
      </Card>

      {images.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-1 pt-2">
            {images.map((image, index) => (
              <div key={image.id} className="flex items-center gap-2 rounded-control px-1 py-0.5">
                <span className="w-5 shrink-0 text-2xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {image.sheet.name}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                  {image.sheet.width}×{image.sheet.height}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-7"
                  aria-label={t('merge.up')}
                  title={t('merge.up')}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-7"
                  aria-label={t('merge.down')}
                  title={t('merge.down')}
                  disabled={index === images.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-7 text-destructive"
                  aria-label={t('merge.remove')}
                  title={t('merge.remove')}
                  onClick={() => removeAt(index)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
