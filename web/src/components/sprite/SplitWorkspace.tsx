import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Download, Grid3x3, ImageUp, Scan, Sparkles, Upload } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { IconAction } from '@/components/IconAction'
import { TopBarActions } from '@/components/TopBar'
import { GifPanel } from '@/components/sprite/GifPanel'
import { SliceCanvas } from '@/components/sprite/SliceCanvas'
import { SliceGrid } from '@/components/sprite/SliceGrid'
import { SlicePanel } from '@/components/sprite/SlicePanel'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Card,
  CardBody,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { downloadBlob } from '@/lib/playerPage'
import {
  composeGifFrames,
  isBlank,
  sheetBaseName,
  sliceBlob,
  slicesZipName,
  zipSlices,
  type SliceSource,
} from '@/lib/spriteSheet/export'
import { encodeGif } from '@/lib/spriteSheet/gif'
import { DEMO_SHEET_GRID, DEMO_SHEET_NAME, DEMO_SHEET_URL } from '@/lib/spriteSheet/demo'
import { loadSheet, type LoadedSheet } from '@/lib/spriteSheet/load'
import { getCachedSheet, setCachedSheet } from '@/lib/spriteSheet/sheetCache'
import {
  buildEntries,
  manualKey,
  parseKey,
  sliceFileNames,
  type ManualSlice,
  type SliceEntry,
} from '@/lib/spriteSheet/model'
import {
  cellSize,
  clampRect,
  guessGrid,
  normalizeGrid,
  toInt,
  type SheetSize,
  type SliceGrid as SliceGridModel,
  type SliceRect,
} from '@/lib/spriteSheet/slice'
import { StorageKeys } from '@/lib/storage'

interface SheetPrefs extends SliceGridModel {
  /** 导出时跳过全透明切片。 */
  skipEmpty: boolean
  /** GIF 每帧间隔（毫秒）。 */
  gifDelayMs: number
  /** GIF 是否循环播放。 */
  gifLoop: boolean
}

const DEFAULT_PREFS: SheetPrefs = {
  rows: 1,
  cols: 1,
  margin: 0,
  gap: 0,
  skipEmpty: false,
  gifDelayMs: 100,
  gifLoop: true,
}

const ZOOM_OPTIONS = [
  { value: 'fit', labelKey: 'slice.zoomFit' },
  { value: '0.5', label: '50%' },
  { value: '1', label: '100%' },
  { value: '2', label: '200%' },
  { value: '4', label: '400%' },
  { value: '8', label: '800%' },
] as const

/** 未勾选「跳过全透明」时的空集合（稳定引用，避免每次渲染都换一个 Set）。 */
const EMPTY_BLANKS: ReadonlySet<string> = new Set()

/**
 * 「精灵图 → 分割」：导入本地 PNG 精灵表 → 网格切分 / 鼠标框选 → 命名与微调 → 导出单张 / ZIP / GIF 动画。
 *
 * **公开本地工具**：不读 TShock、不需要登录与权限、文件不上传（`lib/spriteSheet/` 里解码 / 裁切 / 打包）。
 */
export function SplitWorkspace() {
  const { t } = useI18n()
  const [prefsRaw, setPrefs] = useLocalState<SheetPrefs>(StorageKeys.spriteSheet, DEFAULT_PREFS)
  const prefs = useMemo<SheetPrefs>(
    () => ({
      ...normalizeGrid(prefsRaw),
      skipEmpty: prefsRaw.skipEmpty === true,
      gifDelayMs: toInt(prefsRaw.gifDelayMs, DEFAULT_PREFS.gifDelayMs, 10, 5000),
      gifLoop: prefsRaw.gifLoop !== false,
    }),
    [prefsRaw],
  )
  const grid = useMemo<SliceGridModel>(
    () => ({ rows: prefs.rows, cols: prefs.cols, margin: prefs.margin, gap: prefs.gap }),
    [prefs],
  )

  const [sheet, setSheet] = useState<LoadedSheet | null>(() => getCachedSheet())
  const size = useMemo<SheetSize>(
    () => ({ width: sheet?.width ?? 0, height: sheet?.height ?? 0 }),
    [sheet],
  )
  const src = useMemo<SliceSource | null>(
    () => (sheet ? { source: sheet.source, width: sheet.width, height: sheet.height } : null),
    [sheet],
  )

  /** 网格切片的微调（index → 矩形）。 */
  const [overrides, setOverrides] = useState<Map<number, SliceRect>>(() => new Map())
  /** 鼠标框选出来的切片（与网格参数无关，改行列不会被清掉）。 */
  const [manual, setManual] = useState<ManualSlice[]>([])
  const manualIdRef = useRef(1)
  /** `key → 名字`（网格与手动共用一张表）。 */
  const [names, setNames] = useState<Map<string, string>>(() => new Map())

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /** GIF 帧序列（切片 key，按播放顺序）。 */
  const [frameKeys, setFrameKeys] = useState<string[]>([])
  const [mode, setMode] = useState<'grid' | 'marquee'>('grid')
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [blankSet, setBlankSet] = useState<ReadonlySet<string>>(EMPTY_BLANKS)

  const [demoConfirmOpen, setDemoConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const entries = useMemo<SliceEntry[]>(
    () => (sheet ? buildEntries({ size, grid, overrides, manual, names }) : []),
    [sheet, size, grid, overrides, manual, names],
  )
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.key === selectedKey) ?? null,
    [entries, selectedKey],
  )
  const selected = selectedEntry ? selectedEntry.key : null
  /** 帧序列对应的切片（顺序即播放顺序；切片被删掉时自动跳过）。 */
  const frameEntries = useMemo<SliceEntry[]>(
    () =>
      frameKeys
        .map((key) => entries.find((entry) => entry.key === key))
        .filter((entry): entry is SliceEntry => Boolean(entry)),
    [frameKeys, entries],
  )
  /** 合成好的 GIF 帧（尺寸不一致时按最大尺寸居中）。 */
  const gifPreview = useMemo(
    () => (src && frameEntries.length > 0 ? composeGifFrames(src, frameEntries.map((entry) => entry.rect)) : null),
    [src, frameEntries],
  )
  const adjusted = useMemo(() => new Set(overrides.keys()), [overrides])
  const cell = useMemo(() => cellSize(size, grid), [size, grid])
  const blanks = prefs.skipEmpty ? blankSet : EMPTY_BLANKS

  /** 全透明切片统计（只在勾选「跳过全透明」时算；切片很多时推迟到下一帧，避免输入时卡顿）。 */
  useEffect(() => {
    if (!src || !prefs.skipEmpty) return
    let cancelled = false
    const handle = window.setTimeout(() => {
      if (cancelled) return
      const next = new Set<string>()
      for (const entry of entries) {
        if (isBlank(src, entry.rect)) next.add(entry.key)
      }
      if (!cancelled) setBlankSet(next)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [src, prefs.skipEmpty, entries])

  const runImport = useCallback(
    async (file: File, presetGrid?: SliceGridModel) => {
      setImporting(true)
      setError(null)
      try {
        const next = await loadSheet(file)
        setCachedSheet(next)
        setSheet(next)
        setOverrides(new Map())
        setManual([])
        setNames(new Map())
        setSelectedKey(null)
        setFrameKeys([])
        manualIdRef.current = 1
        // Demo 自带切分参数：直接套用，省得用户自己数行列。
        if (presetGrid) setPrefs({ ...prefs, ...normalizeGrid(presetGrid) })
        setNotice(t('slice.loaded', { name: next.name, w: next.width, h: next.height }))
      } catch {
        setError(t('slice.err.read'))
      } finally {
        setImporting(false)
      }
    },
    [prefs, setPrefs, t],
  )

  /** 载入自带的 buff 图集 Demo（本地解码，不经过任何接口），并套用它的切分参数。 */
  const loadDemo = useCallback(async () => {
    setImporting(true)
    setError(null)
    try {
      const res = await fetch(DEMO_SHEET_URL, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      await runImport(new File([blob], DEMO_SHEET_NAME, { type: 'image/png' }), DEMO_SHEET_GRID)
      setNotice(
        t('slice.demoLoaded', {
          cols: DEMO_SHEET_GRID.cols,
          rows: DEMO_SHEET_GRID.rows,
          gap: DEMO_SHEET_GRID.gap,
        }),
      )
    } catch {
      setError(t('slice.err.read'))
    } finally {
      setImporting(false)
    }
  }, [runImport, t])

  /** 已载入图片时先确认是否覆盖（避免手误清掉当前微调 / 命名）。 */
  const requestDemo = () => {
    if (sheet) setDemoConfirmOpen(true)
    else void loadDemo()
  }

  const pickImport = () => importRef.current?.click()

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const dropped = event.dataTransfer?.files?.[0]
    if (dropped) void runImport(dropped)
  }

  /**
   * 改切分参数：立即生效。网格切片的微调与名称会清空（手动框选的切片与名字保留）。
   * 输入框逐字输入时无法弹确认框，所以用「自动清空 + 提示」。
   */
  const onGridChange = useCallback(
    (patch: Partial<SliceGridModel>) => {
      const next = normalizeGrid({ ...grid, ...patch })
      setPrefs({ ...prefs, ...next })
      const gridNameKeys = [...names.keys()].filter((key) => parseKey(key)?.kind === 'grid')
      const cleared = overrides.size + gridNameKeys.length
      if (cleared > 0) {
        setOverrides(new Map())
        setNames((prev) => {
          const kept = new Map<string, string>()
          for (const [key, value] of prev) if (parseKey(key)?.kind !== 'grid') kept.set(key, value)
          return kept
        })
        setNotice(t('slice.regridCleared', { n: cleared }))
      }
      if (selectedKey?.startsWith('g:') && parseKey(selectedKey)!.value >= next.rows * next.cols) {
        setSelectedKey(null)
      }
    },
    [grid, names, overrides, prefs, selectedKey, setPrefs, t],
  )

  const onSkipEmptyChange = useCallback(
    (value: boolean) => setPrefs({ ...prefs, skipEmpty: value }),
    [prefs, setPrefs],
  )

  const onGifDelayChange = useCallback(
    (value: number) => setPrefs({ ...prefs, gifDelayMs: value }),
    [prefs, setPrefs],
  )

  const onGifLoopChange = useCallback(
    (value: boolean) => setPrefs({ ...prefs, gifLoop: value }),
    [prefs, setPrefs],
  )

  const onGuess = useCallback(() => {
    if (!sheet) return
    const guessed = guessGrid(size)
    if (guessed.rows * guessed.cols <= 1) {
      setNotice(t('slice.guessFailed'))
      return
    }
    onGridChange(guessed)
    setNotice(
      t('slice.guessDone', {
        w: Math.round(sheet.width / guessed.cols),
        h: Math.round(sheet.height / guessed.rows),
        cols: guessed.cols,
        rows: guessed.rows,
      }),
    )
  }, [sheet, size, onGridChange, t])

  /** 框选完成 → 追加一张手动切片并选中它。 */
  const onCreate = useCallback((rect: SliceRect) => {
    const id = manualIdRef.current
    manualIdRef.current += 1
    setManual((prev) => [...prev, { id, rect }])
    setSelectedKey(manualKey(id))
    setMode('marquee')
  }, [])

  /** 改选中切片：网格写覆盖表，手动改自己的矩形。 */
  const applyRect = useCallback(
    (patch: Partial<SliceRect>) => {
      if (!selectedEntry) return
      const rect = clampRect({ ...selectedEntry.rect, ...patch }, size)
      const parsed = parseKey(selectedEntry.key)
      if (!parsed) return
      if (parsed.kind === 'manual') {
        setManual((prev) => prev.map((item) => (item.id === parsed.value ? { ...item, rect } : item)))
      } else {
        setOverrides((prev) => new Map(prev).set(parsed.value, rect))
      }
    },
    [selectedEntry, size],
  )

  const onNudge = useCallback(
    (dx: number, dy: number) => {
      if (!selectedEntry) return
      applyRect({ x: selectedEntry.rect.x + dx, y: selectedEntry.rect.y + dy })
    },
    [selectedEntry, applyRect],
  )

  /** 网格切片：删掉微调，回到默认网格。 */
  const onReset = useCallback(() => {
    if (!selectedEntry) return
    const parsed = parseKey(selectedEntry.key)
    if (!parsed || parsed.kind !== 'grid') return
    setOverrides((prev) => {
      if (!prev.has(parsed.value)) return prev
      const next = new Map(prev)
      next.delete(parsed.value)
      return next
    })
  }, [selectedEntry])

  /** 手动切片：从列表移除（连带名字）。 */
  const onDelete = useCallback(() => {
    if (!selectedEntry) return
    const parsed = parseKey(selectedEntry.key)
    if (!parsed || parsed.kind !== 'manual') return
    setManual((prev) => prev.filter((item) => item.id !== parsed.value))
    setNames((prev) => {
      if (!prev.has(selectedEntry.key)) return prev
      const next = new Map(prev)
      next.delete(selectedEntry.key)
      return next
    })
    setFrameKeys((prev) => prev.filter((key) => key !== selectedEntry.key))
    setSelectedKey(null)
  }, [selectedEntry])

  const onRename = useCallback(
    (value: string) => {
      if (!selectedEntry) return
      const key = selectedEntry.key
      setNames((prev) => {
        const next = new Map(prev)
        if (value.trim()) next.set(key, value)
        else next.delete(key)
        return next
      })
    },
    [selectedEntry],
  )

  /** 把当前切片加入帧序列（已在序列里就提示，不重复添加）。 */
  const addFrame = useCallback(() => {
    if (!selectedEntry) return
    const key = selectedEntry.key
    if (frameKeys.includes(key)) {
      setNotice(t('slice.gif.duplicate'))
      return
    }
    setFrameKeys((prev) => [...prev, key])
    setNotice(t('slice.gif.added', { n: frameKeys.length + 1 }))
  }, [selectedEntry, frameKeys, t])

  const removeFrame = useCallback((key: string) => {
    setFrameKeys((prev) => prev.filter((item) => item !== key))
  }, [])

  const clearFrames = useCallback(() => setFrameKeys([]), [])

  const exportOne = useCallback(
    async (key: string) => {
      if (!src) return
      const index = entries.findIndex((entry) => entry.key === key)
      const entry = entries[index]
      if (!entry) return
      setExporting(true)
      setError(null)
      try {
        const file = `${sliceFileNames(entries)[index]}.png`
        downloadBlob(await sliceBlob(src, entry.rect), file)
        setNotice(t('slice.exportedOne', { file }))
      } catch (err) {
        setError(t('slice.err.export', { reason: err instanceof Error ? err.message : String(err) }))
      } finally {
        setExporting(false)
      }
    },
    [src, entries, t],
  )

  const sheetName = sheet?.name ?? 'sheet.png'

  const exportAll = useCallback(async () => {
    if (!src) return
    setExporting(true)
    setError(null)
    try {
      const fileNames = sliceFileNames(entries)
      const items = entries
        .map((entry, index) => ({ name: fileNames[index], rect: entry.rect, key: entry.key }))
        .filter((item) => !prefs.skipEmpty || !isBlank(src, item.rect))
      if (items.length === 0) {
        setError(t('slice.err.empty'))
        return
      }
      downloadBlob(
        await zipSlices(
          src,
          items.map(({ name, rect }) => ({ name, rect })),
        ),
        slicesZipName(sheetName),
      )
      setNotice(t('slice.exported', { n: items.length }))
    } catch (err) {
      setError(t('slice.err.export', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setExporting(false)
    }
  }, [src, entries, prefs.skipEmpty, sheetName, t])

  /** 导出 GIF：合成帧 → 编码 GIF89a → 下载（全程本地）。 */
  const exportGif = useCallback(async () => {
    if (!src || frameEntries.length < 2) {
      setError(t('slice.gif.needTwo'))
      return
    }
    setExporting(true)
    setError(null)
    try {
      const composed = composeGifFrames(src, frameEntries.map((entry) => entry.rect))
      if (!composed) {
        setError(t('slice.gif.err', { reason: 'canvas unavailable' }))
        return
      }
      const bytes = encodeGif(
        composed.frames.map((frame) => ({ data: frame.data })),
        {
          width: composed.width,
          height: composed.height,
          delayMs: prefs.gifDelayMs,
          loop: prefs.gifLoop ? 0 : 1,
        },
      )
      const payload = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const file = `${sheetBaseName(sheetName)}-animation.gif`
      downloadBlob(new Blob([payload], { type: 'image/gif' }), file)
      setNotice(
        t('slice.gif.exported', {
          file,
          n: frameEntries.length,
          ms: prefs.gifDelayMs,
        }),
      )
    } catch (err) {
      setError(t('slice.gif.err', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setExporting(false)
    }
  }, [src, frameEntries, prefs.gifDelayMs, prefs.gifLoop, sheetName, t])

  const stats = prefs.skipEmpty
    ? t('slice.statsBlank', {
        n: entries.length,
        m: adjusted.size,
        k: manual.length,
        q: blankSet.size,
      })
    : t('slice.stats', { n: entries.length, m: adjusted.size, k: manual.length })

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-testid="slice-drop"
    >
      {sheet && src && (
        <TopBarActions
          info={
            <InfoPopover label={t('slice.desc')} title={t('nav.slice')}>
              <p>{t('slice.desc')}</p>
              <p className="mt-1">{t('slice.nudgeHint')}</p>
              <p className="mt-1">{t('slice.marqueeHint')}</p>
            </InfoPopover>
          }
        >
          <IconAction
            label={t('slice.exportAll')}
            icon={Download}
            loading={exporting}
            onClick={() => void exportAll()}
          />
        </TopBarActions>
      )}

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

      <div
        className={cn(
          'grid items-start gap-3',
          sheet && src && '@[1100px]:grid-cols-[minmax(0,1fr)_300px]',
        )}
      >
        <Card>
          <CardBody className="flex flex-col gap-2.5 pt-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={importing} onClick={pickImport}>
                {importing ? (
                  <Spinner aria-hidden data-icon="inline-start" />
                ) : (
                  <Upload data-icon="inline-start" />
                )}
                {t('slice.import')}
              </Button>
              <Button size="sm" variant="outline" disabled={importing} onClick={requestDemo}>
                <Sparkles data-icon="inline-start" />
                {t('slice.demo')}
              </Button>
              {sheet ? (
                <>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    {t('slice.original', { w: sheet.width, h: sheet.height })}
                  </span>
                  <ToggleGroup
                    size="sm"
                    className="h-7 shrink-0"
                    value={mode}
                    onValueChange={(value) => {
                      if (value === 'grid' || value === 'marquee') setMode(value)
                    }}
                    aria-label={t('slice.mode')}
                  >
                    <ToggleGroupItem value="grid" size="sm" aria-label={t('slice.mode.grid')}>
                      <Grid3x3 />
                      {t('slice.mode.grid')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="marquee" size="sm" aria-label={t('slice.mode.marquee')}>
                      <Scan />
                      {t('slice.mode.marquee')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <span className="hidden min-w-0 flex-1 truncate text-2xs text-muted-foreground @[820px]:inline">
                    {mode === 'marquee' ? t('slice.marqueeHint') : t('slice.nudgeHint')}
                  </span>
                  <Select
                    value={typeof zoom === 'number' ? String(zoom) : 'fit'}
                    onValueChange={(value) => setZoom(value === 'fit' ? 'fit' : Number(value))}
                  >
                    <SelectTrigger size="sm" className="ml-auto w-24" aria-label={t('slice.zoom')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ZOOM_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {'labelKey' in option ? t(option.labelKey) : option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
              <input
                ref={importRef}
                id="slice-png-input"
                name="slice-png-input"
                type="file"
                accept="image/png"
                className="hidden"
                data-testid="slice-png-input"
                onChange={(event) => {
                  const picked = event.target.files?.[0]
                  event.target.value = ''
                  if (picked) void runImport(picked)
                }}
              />
            </div>

            {sheet && src ? (
              <SliceCanvas
                src={src}
                entries={entries}
                selected={selected}
                zoom={zoom}
                mode={mode}
                onSelect={setSelectedKey}
                onNudge={onNudge}
                onCreate={onCreate}
                label={t('slice.preview')}
              />
            ) : (
              <Empty className="min-h-32 border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ImageUp />
                  </EmptyMedia>
                  <EmptyTitle>{t('slice.empty')}</EmptyTitle>
                  <EmptyDescription>{t('slice.emptyHint')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardBody>
        </Card>

        {sheet && src && (
          <div className="flex flex-col gap-3">
            <SlicePanel
              src={src}
              size={size}
              grid={grid}
              cell={cell}
              skipEmpty={prefs.skipEmpty}
              entry={selectedEntry}
              onGridChange={onGridChange}
              onSkipEmptyChange={onSkipEmptyChange}
              onGuess={onGuess}
              onRectChange={applyRect}
              onNudge={onNudge}
              onReset={onReset}
              onDelete={onDelete}
              onRename={onRename}
              onExport={() => {
                if (selected) void exportOne(selected)
              }}
              exporting={exporting}
            />
            <GifPanel
              frames={frameEntries.map((entry) => ({
                key: entry.key,
                label: `#${entry.index + 1} ${entry.displayName}`,
              }))}
              preview={gifPreview}
              canAdd={selectedEntry != null && !frameKeys.includes(selectedEntry.key)}
              delayMs={prefs.gifDelayMs}
              loop={prefs.gifLoop}
              onAdd={addFrame}
              onRemove={removeFrame}
              onClear={clearFrames}
              onDelayChange={onGifDelayChange}
              onLoopChange={onGifLoopChange}
              onExport={() => void exportGif()}
              exporting={exporting}
            />
          </div>
        )}
      </div>

      {sheet && src && (
        <Card>
          <CardBody className="flex flex-col gap-1.5 pt-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">{t('slice.list')}</h2>
              <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">{stats}</span>
            </div>
            <SliceGrid
              src={src}
              entries={entries}
              selected={selected}
              blanks={blanks}
              onSelect={setSelectedKey}
              onExport={(key) => void exportOne(key)}
            />
          </CardBody>
        </Card>
      )}
      <Dialog open={demoConfirmOpen} onOpenChange={setDemoConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('slice.demoConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('slice.demoConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDemoConfirmOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDemoConfirmOpen(false)
                void loadDemo()
              }}
            >
              {t('slice.demoConfirmOk')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
