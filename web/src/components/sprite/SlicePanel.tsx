import { useEffect, useRef } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Download,
  RotateCcw,
  Trash2,
  Wand2,
} from 'lucide-react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from '@/components/ui'
import type { SliceSource } from '@/lib/spriteSheet/export'
import type { SliceEntry } from '@/lib/spriteSheet/model'
import {
  MAX_GRID,
  toInt,
  type SliceGrid,
  type SheetSize,
  type SliceRect,
} from '@/lib/spriteSheet/slice'
import { useI18n } from '@/lib/i18n'

/** 右侧栏的小号输入框（桌面 28px，移动端 32px 便于点按）。 */
const SMALL_INPUT = 'h-8 px-2 text-xs md:h-7'

interface SlicePanelProps {
  src: SliceSource
  size: SheetSize
  grid: SliceGrid
  cell: { w: number; h: number }
  skipEmpty: boolean
  /** 当前选中的切片（网格或手动）。 */
  entry: SliceEntry | null
  onGridChange: (patch: Partial<SliceGrid>) => void
  onSkipEmptyChange: (value: boolean) => void
  onGuess: () => void
  onRectChange: (patch: Partial<SliceRect>) => void
  onNudge: (dx: number, dy: number) => void
  /** 网格切片：删掉微调，回到默认网格。 */
  onReset: () => void
  /** 手动切片：从列表移除。 */
  onDelete: () => void
  onRename: (name: string) => void
  onExport: () => void
  exporting: boolean
}

/**
 * 右侧栏：「切分设置」+「选中切片（命名 / 微调 / 导出）」。
 *
 * 控件统一小号（输入 `h-7`、按钮 `size="sm"`），两栏并排也不挤；行列 / 边距 / 间距改动即时生效（没有「应用」按钮）。
 */
export function SlicePanel({
  src,
  size,
  grid,
  cell,
  skipEmpty,
  entry,
  onGridChange,
  onSkipEmptyChange,
  onGuess,
  onRectChange,
  onNudge,
  onReset,
  onDelete,
  onRename,
  onExport,
  exporting,
}: SlicePanelProps) {
  const { t } = useI18n()
  const rect = entry?.rect ?? null

  return (
    <>
      <Card>
        <CardHeader className="py-1.5">
          <CardTitle>{t('slice.grid')}</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-2 pt-0.5">
          <FieldGroup className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <Field className="gap-1">
              <FieldLabel htmlFor="slice-rows" className="text-2xs text-muted-foreground">
                {t('slice.rows')}
              </FieldLabel>
              <Input
                id="slice-rows"
                name="slice-rows"
                className={SMALL_INPUT}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_GRID}
                value={grid.rows}
                onChange={(e) => onGridChange({ rows: toInt(e.target.value, grid.rows, 1, MAX_GRID) })}
              />
            </Field>
            <Field className="gap-1">
              <FieldLabel htmlFor="slice-cols" className="text-2xs text-muted-foreground">
                {t('slice.cols')}
              </FieldLabel>
              <Input
                id="slice-cols"
                name="slice-cols"
                className={SMALL_INPUT}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_GRID}
                value={grid.cols}
                onChange={(e) => onGridChange({ cols: toInt(e.target.value, grid.cols, 1, MAX_GRID) })}
              />
            </Field>
            <Field className="gap-1">
              <FieldLabel htmlFor="slice-margin" className="text-2xs text-muted-foreground">
                {t('slice.margin')}
              </FieldLabel>
              <Input
                id="slice-margin"
                name="slice-margin"
                className={SMALL_INPUT}
                type="number"
                inputMode="numeric"
                min={0}
                value={grid.margin}
                onChange={(e) =>
                  onGridChange({
                    margin: toInt(e.target.value, grid.margin, 0, Math.max(0, Math.floor(size.width / 2))),
                  })
                }
              />
            </Field>
            <Field className="gap-1">
              <FieldLabel htmlFor="slice-gap" className="text-2xs text-muted-foreground">
                {t('slice.gap')}
              </FieldLabel>
              <Input
                id="slice-gap"
                name="slice-gap"
                className={SMALL_INPUT}
                type="number"
                inputMode="numeric"
                min={0}
                value={grid.gap}
                onChange={(e) =>
                  onGridChange({ gap: toInt(e.target.value, grid.gap, 0, Math.max(0, size.width)) })
                }
              />
            </Field>
          </FieldGroup>
          <p className="text-2xs text-muted-foreground">{t('slice.cell', { w: cell.w, h: cell.h })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onGuess}>
              <Wand2 data-icon="inline-start" />
              {t('slice.guess')}
            </Button>
            <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-foreground">
              <Checkbox
                className="size-3.5"
                checked={skipEmpty}
                onCheckedChange={(checked) => onSkipEmptyChange(checked === true)}
              />
              {t('slice.skipEmpty')}
            </label>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="py-1.5">
          <CardTitle>
            {entry ? t('slice.selected', { name: `#${entry.index + 1}` }) : t('slice.selected', { name: '—' })}
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-2 pt-0.5">
          {!entry || !rect ? (
            <p className="text-2xs text-muted-foreground">{t('slice.selectHint')}</p>
          ) : (
            <>
              <Field className="gap-1">
                <FieldLabel htmlFor="slice-name" className="text-2xs text-muted-foreground">
                  {t('slice.name')}
                </FieldLabel>
                <Input
                  id="slice-name"
                  name="slice-name"
                  className={SMALL_INPUT}
                  value={entry.name}
                  placeholder={entry.defaultName}
                  maxLength={64}
                  onChange={(e) => onRename(e.target.value)}
                />
              </Field>

              <div className="flex items-start gap-2">
                <SlicePreview src={src} rect={rect} />
                <FieldGroup className="grid flex-1 grid-cols-2 gap-x-2 gap-y-1.5">
                  {(
                    [
                      ['x', t('slice.x')],
                      ['y', t('slice.y')],
                      ['w', t('slice.w')],
                      ['h', t('slice.h')],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} className="gap-1">
                      <FieldLabel htmlFor={`slice-${key}`} className="text-2xs text-muted-foreground">
                        {label}
                      </FieldLabel>
                      <Input
                        id={`slice-${key}`}
                        name={`slice-${key}`}
                        className={SMALL_INPUT}
                        type="number"
                        inputMode="numeric"
                        min={key === 'w' || key === 'h' ? 1 : 0}
                        value={rect[key]}
                        onChange={(e) =>
                          onRectChange({
                            [key]: toInt(
                              e.target.value,
                              rect[key],
                              key === 'w' || key === 'h' ? 1 : 0,
                              key === 'x'
                                ? Math.max(0, size.width - 1)
                                : key === 'y'
                                  ? Math.max(0, size.height - 1)
                                  : key === 'w'
                                    ? size.width
                                    : size.height,
                            ),
                          })
                        }
                      />
                    </Field>
                  ))}
                </FieldGroup>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="size-7"
                    aria-label={t('slice.nudgeLeft')}
                    title={t('slice.nudgeLeft')}
                    onClick={() => onNudge(-1, 0)}
                  >
                    <ArrowLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="size-7"
                    aria-label={t('slice.nudgeUp')}
                    title={t('slice.nudgeUp')}
                    onClick={() => onNudge(0, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="size-7"
                    aria-label={t('slice.nudgeDown')}
                    title={t('slice.nudgeDown')}
                    onClick={() => onNudge(0, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="size-7"
                    aria-label={t('slice.nudgeRight')}
                    title={t('slice.nudgeRight')}
                    onClick={() => onNudge(1, 0)}
                  >
                    <ArrowRight />
                  </Button>
                </span>
                <span className="text-2xs text-muted-foreground">{t('slice.nudgeHint')}</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {entry.kind === 'grid' ? (
                  <Button variant="ghost" size="sm" onClick={onReset} disabled={!entry.adjusted}>
                    <RotateCcw data-icon="inline-start" />
                    {t('slice.reset')}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
                    <Trash2 data-icon="inline-start" />
                    {t('slice.delete')}
                  </Button>
                )}
                <Button variant="primary" size="sm" disabled={exporting} onClick={onExport}>
                  {exporting ? (
                    <Spinner aria-hidden data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {t('slice.exportOne')}
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  )
}

/** 选中切片的放大预览（棋盘格底，最多 4 倍）。 */
function SlicePreview({ src, rect }: { src: SliceSource; rect: SliceRect }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const box = 72

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    canvas.width = Math.round(box * dpr)
    canvas.height = Math.round(box * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box, box)
    ctx.imageSmoothingEnabled = false
    const scale = Math.min(box / Math.max(1, rect.w), box / Math.max(1, rect.h), 4)
    const w = Math.max(1, Math.round(rect.w * scale))
    const h = Math.max(1, Math.round(rect.h * scale))
    ctx.drawImage(
      src.source,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      Math.round((box - w) / 2),
      Math.round((box - h) / 2),
      w,
      h,
    )
  }, [src, rect])

  return (
    <div
      className="grid size-[72px] shrink-0 place-items-center overflow-hidden rounded-control ring-1 ring-border/60"
      style={{
        backgroundColor: 'var(--muted)',
        backgroundImage:
          'repeating-conic-gradient(rgba(127,127,127,0.14) 0% 25%, transparent 0% 50%)',
        backgroundSize: '12px 12px',
      }}
    >
      <canvas ref={ref} width={box} height={box} className="size-[72px] [image-rendering:pixelated]" />
    </div>
  )
}
