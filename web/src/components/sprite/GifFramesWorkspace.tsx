import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Download, ImageUp, Upload } from 'lucide-react'
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
  Spinner,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { downloadBlob } from '@/lib/playerPage'
import { canvasFromRgba, rgbaToPngBytes } from '@/lib/spriteSheet/export'
import { decodeGif, type DecodedGif } from '@/lib/spriteSheet/gifDecode'
import { buildZip } from '@/lib/spriteSheet/zip'

interface LoadedGif {
  name: string
  decoded: DecodedGif
}

const THUMB = 64
const PREVIEW = 128

function checkerboard(): React.CSSProperties {
  return {
    backgroundColor: 'var(--muted)',
    backgroundImage:
      'repeating-conic-gradient(rgba(127,127,127,0.14) 0% 25%, transparent 0% 50%)',
    backgroundSize: '12px 12px',
  }
}

/**
 * 「精灵图 → GIF」：上传一张 GIF，按帧拆成 PNG（可单帧 / 全部打包 ZIP）。
 *
 * 解码用自写的 `gifDecode.ts`（支持透明 / disposal / interlace），全程本地，不上传。
 */
export function GifFramesWorkspace() {
  const { t } = useI18n()
  const [gif, setGif] = useState<LoadedGif | null>(null)
  const [selected, setSelected] = useState(0)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const runImport = async (file: File) => {
    setImporting(true)
    setError(null)
    setNotice(null)
    try {
      const decoded = decodeGif(new Uint8Array(await file.arrayBuffer()))
      if (decoded.frames.length === 0) throw new Error('no frames')
      setGif({ name: file.name, decoded })
      setSelected(0)
    } catch (err) {
      setError(t('gifSplit.err', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setImporting(false)
    }
  }

  const pickImport = () => inputRef.current?.click()

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    if (file) void runImport(file)
  }

  const baseName = gif ? gif.name.replace(/\.gif$/i, '') || 'animation' : 'animation'

  const exportOne = async (index: number) => {
    if (!gif) return
    const frame = gif.decoded.frames[index]
    if (!frame) return
    setExporting(true)
    setError(null)
    try {
      const bytes = await rgbaToPngBytes(frame.data, gif.decoded.width, gif.decoded.height)
      const file = `${baseName}-frame-${String(index + 1).padStart(3, '0')}.png`
      const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      downloadBlob(new Blob([payload], { type: 'image/png' }), file)
      setNotice(t('gifSplit.exportedOne', { file }))
    } catch (err) {
      setError(t('gifSplit.errExport', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setExporting(false)
    }
  }

  const exportAll = async () => {
    if (!gif) return
    setExporting(true)
    setError(null)
    try {
      const entries = []
      for (let i = 0; i < gif.decoded.frames.length; i += 1) {
        entries.push({
          name: `${baseName}-frame-${String(i + 1).padStart(3, '0')}.png`,
          data: await rgbaToPngBytes(gif.decoded.frames[i].data, gif.decoded.width, gif.decoded.height),
        })
      }
      const zip = buildZip(entries)
      const payload = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
      const file = `${baseName}-frames.zip`
      downloadBlob(new Blob([payload], { type: 'application/zip' }), file)
      setNotice(t('gifSplit.exported', { file, n: entries.length }))
    } catch (err) {
      setError(t('gifSplit.errExport', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setExporting(false)
    }
  }

  const selectedFrame = gif?.decoded.frames[selected] ?? null

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-testid="gif-split-drop"
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
              {t('gifSplit.import')}
            </Button>
            {gif ? (
              <>
                <span className="text-2xs text-muted-foreground tabular-nums">
                  {t('gifSplit.info', {
                    w: gif.decoded.width,
                    h: gif.decoded.height,
                    n: gif.decoded.frames.length,
                  })}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {gif.decoded.loop == null
                    ? t('gifSplit.loopNone')
                    : gif.decoded.loop === 0
                      ? t('gifSplit.loopInfinite')
                      : t('gifSplit.loopCount', { n: gif.decoded.loop })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={exporting}
                  onClick={() => void exportAll()}
                >
                  {exporting ? (
                    <Spinner aria-hidden data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {t('gifSplit.exportAll')}
                </Button>
              </>
            ) : (
              <span className="min-w-0 flex-1 text-2xs text-muted-foreground">
                {t('gifSplit.emptyHint')}
              </span>
            )}
            <input
              ref={inputRef}
              id="gif-split-input"
              name="gif-split-input"
              type="file"
              accept="image/gif"
              className="hidden"
              data-testid="gif-split-input"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void runImport(file)
              }}
            />
          </div>

          {!gif || !selectedFrame ? (
            <Empty className="min-h-32 border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageUp />
                </EmptyMedia>
                <EmptyTitle>{t('gifSplit.empty')}</EmptyTitle>
                <EmptyDescription>{t('gifSplit.emptyHint')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              <div
                className="grid shrink-0 place-items-center overflow-hidden rounded-control ring-1 ring-border/60"
                style={checkerboard()}
              >
                <RgbaCanvas
                  data={selectedFrame.data}
                  width={gif.decoded.width}
                  height={gif.decoded.height}
                  box={PREVIEW}
                  label={t('gifSplit.frame', { n: selected + 1 })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs text-foreground">
                  {t('gifSplit.frame', { n: selected + 1 })}
                  <span className="ml-2 text-2xs text-muted-foreground tabular-nums">
                    {selectedFrame.delayMs} ms
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void exportOne(selected)}
                >
                  <Download data-icon="inline-start" />
                  {t('gifSplit.exportOne')}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {gif && gif.decoded.frames.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-2 pt-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">{t('gifSplit.list')}</h2>
              <span className="text-2xs text-muted-foreground tabular-nums">
                {t('gifSplit.count', { n: gif.decoded.frames.length })}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {gif.decoded.frames.map((frame, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={t('gifSplit.frame', { n: index + 1 })}
                  aria-pressed={index === selected}
                  data-testid="gif-frame-thumb"
                  onClick={() => setSelected(index)}
                  onDoubleClick={() => void exportOne(index)}
                  className={
                    'relative rounded-control p-1 transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ' +
                    (index === selected ? 'bg-primary/10 ring-2 ring-primary' : 'ring-1 ring-border/60')
                  }
                >
                  <span
                    className="grid place-items-center overflow-hidden rounded-chip"
                    style={checkerboard()}
                  >
                    <RgbaCanvas
                      data={frame.data}
                      width={gif.decoded.width}
                      height={gif.decoded.height}
                      box={THUMB}
                    />
                  </span>
                  <span
                    className={
                      'absolute top-1 left-1 rounded-chip px-1 text-[10px] leading-4 font-semibold tabular-nums ' +
                      (index === selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-black/60 text-white/85')
                    }
                  >
                    {index + 1}
                  </span>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

/** 把一帧 RGBA 按「包含」方式画进 `box × box` 的 canvas（像素风保持锐利）。 */
function RgbaCanvas({
  data,
  width,
  height,
  box,
  label,
}: {
  data: Uint8ClampedArray
  width: number
  height: number
  box: number
  label?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const source = canvasFromRgba(data, width, height)
    if (!source) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    canvas.width = Math.round(box * dpr)
    canvas.height = Math.round(box * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box, box)
    ctx.imageSmoothingEnabled = false
    const scale = Math.min(box / Math.max(1, width), box / Math.max(1, height), 4)
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    ctx.drawImage(source, 0, 0, width, height, Math.round((box - w) / 2), Math.round((box - h) / 2), w, h)
  }, [data, width, height, box])

  return (
    <canvas
      ref={ref}
      style={{ width: box, height: box }}
      className="[image-rendering:pixelated]"
      aria-label={label}
      role="img"
    />
  )
}
