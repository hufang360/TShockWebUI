import { useEffect, useRef } from 'react'
import { Download, Film, Plus, Trash2, X } from 'lucide-react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldLabel,
  Input,
  Spinner,
} from '@/components/ui'
import type { ComposedGifFrames } from '@/lib/spriteSheet/export'
import { toInt } from '@/lib/spriteSheet/slice'
import { useI18n } from '@/lib/i18n'

const SMALL_INPUT = 'h-8 px-2 text-xs md:h-7'
const PREVIEW_BOX = 96

export interface GifFrameRef {
  key: string
  label: string
}

interface GifPanelProps {
  /** 帧序列（按播放顺序）。 */
  frames: GifFrameRef[]
  /** 合成好的帧（尺寸不一致时居中）；无法合成时为 `null`。 */
  preview: ComposedGifFrames | null
  /** 当前有选中切片、且它不在帧序列里。 */
  canAdd: boolean
  delayMs: number
  loop: boolean
  onAdd: () => void
  onRemove: (key: string) => void
  onClear: () => void
  onDelayChange: (ms: number) => void
  onLoopChange: (loop: boolean) => void
  onExport: () => void
  exporting: boolean
}

/**
 * 「GIF 动画」：把切片按顺序串成帧、预览并导出 GIF。
 *
 * 全部在本地完成（`lib/spriteSheet/gif.ts` 自己编码 GIF89a），不请求后端、不上传。
 */
export function GifPanel({
  frames,
  preview,
  canAdd,
  delayMs,
  loop,
  onAdd,
  onRemove,
  onClear,
  onDelayChange,
  onLoopChange,
  onExport,
  exporting,
}: GifPanelProps) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 预览：按帧间隔循环绘制（尺寸不同时按最大尺寸居中，和导出的 GIF 一致）。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !preview || preview.frames.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    canvas.width = Math.round(PREVIEW_BOX * dpr)
    canvas.height = Math.round(PREVIEW_BOX * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const scale = Math.min(
      PREVIEW_BOX / Math.max(1, preview.width),
      PREVIEW_BOX / Math.max(1, preview.height),
      4,
    )
    const w = Math.max(1, Math.round(preview.width * scale))
    const h = Math.max(1, Math.round(preview.height * scale))
    const x = Math.round((PREVIEW_BOX - w) / 2)
    const y = Math.round((PREVIEW_BOX - h) / 2)
    let index = 0
    const draw = () => {
      ctx.clearRect(0, 0, PREVIEW_BOX, PREVIEW_BOX)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(preview.frames[index].canvas, 0, 0, preview.width, preview.height, x, y, w, h)
    }
    draw()
    if (preview.frames.length === 1) return
    const timer = window.setInterval(() => {
      index = (index + 1) % preview.frames.length
      draw()
    }, Math.max(20, delayMs))
    return () => window.clearInterval(timer)
  }, [preview, delayMs])

  const canExport = frames.length >= 2

  return (
    <Card>
      <CardHeader className="py-1.5">
        <CardTitle>{t('slice.gif')}</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-2 pt-0.5">
        {frames.length === 0 ? (
          <p className="text-2xs text-muted-foreground">{t('slice.gif.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {frames.map((frame, index) => (
              <li
                key={frame.key}
                className="flex max-w-full items-center gap-1 rounded-chip bg-accent py-0.5 pr-0.5 pl-1.5 text-2xs"
              >
                <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="max-w-24 truncate">{frame.label}</span>
                <button
                  type="button"
                  className="rounded-chip p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label={t('slice.gif.remove')}
                  title={t('slice.gif.remove')}
                  onClick={() => onRemove(frame.key)}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={!canAdd} onClick={onAdd}>
            <Plus data-icon="inline-start" />
            {t('slice.gif.add')}
          </Button>
          <Button variant="ghost" size="sm" disabled={frames.length === 0} onClick={onClear}>
            <Trash2 data-icon="inline-start" />
            {t('slice.gif.clear')}
          </Button>
        </div>

        <div className="flex items-start gap-2">
          <div
            className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-control ring-1 ring-border/60"
            style={{
              backgroundColor: 'var(--muted)',
              backgroundImage:
                'repeating-conic-gradient(rgba(127,127,127,0.14) 0% 25%, transparent 0% 50%)',
              backgroundSize: '12px 12px',
            }}
          >
            {preview ? (
              <canvas
                ref={canvasRef}
                className="size-24 [image-rendering:pixelated]"
                aria-label={t('slice.gif.preview')}
                role="img"
              />
            ) : (
              <Film className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Field className="gap-1">
              <FieldLabel htmlFor="slice-gif-delay" className="text-2xs text-muted-foreground">
                {t('slice.gif.delay')}
              </FieldLabel>
              <Input
                id="slice-gif-delay"
                name="slice-gif-delay"
                className={SMALL_INPUT}
                type="number"
                inputMode="numeric"
                min={10}
                max={5000}
                step={10}
                value={delayMs}
                onChange={(e) => onDelayChange(toInt(e.target.value, delayMs, 10, 5000))}
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-foreground">
              <Checkbox
                className="size-3.5"
                checked={loop}
                onCheckedChange={(checked) => onLoopChange(checked === true)}
              />
              {t('slice.gif.loop')}
            </label>
          </div>
        </div>

        <p className="text-2xs text-muted-foreground">{t('slice.gif.sizeHint')}</p>

        <Button variant="primary" size="sm" disabled={!canExport || exporting} onClick={onExport}>
          {exporting ? (
            <Spinner aria-hidden data-icon="inline-start" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          {t('slice.gif.export')}
        </Button>
        {!canExport && <p className="text-2xs text-muted-foreground">{t('slice.gif.needTwo')}</p>}
      </CardBody>
    </Card>
  )
}
