import { useCallback, useRef, useState, type DragEvent } from 'react'
import { Camera, Download, Pencil, Sparkles, Upload, ZoomIn } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { IconAction } from '@/components/IconAction'
import { TopBarActions } from '@/components/TopBar'
import { WorldAnalysis } from '@/components/world/WorldAnalysis'
import { WorldFind, type TileMarkers } from '@/components/world/WorldFind'
import { WorldEditPanel } from '@/components/world/WorldEditPanel'
import { WorldContentEditor } from '@/components/world/WorldContentEditor'
import { WorldTileReplace } from '@/components/world/WorldTileReplace'
import { WorldPanel } from '@/components/world/WorldPanel'
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
import {
  buildWorldEdits,
  draftFromWorld,
  isWorldDraftDirty,
  validateWorldDraft,
  type WorldEditDraft,
} from '@/lib/save/worldEdit'
import { parseWorld, type ParsedWorld, type WorldInfo, type WorldTrack } from '@/lib/save/worldFile'
import { renderWorldThumbnail, type WorldTileStats } from '@/lib/save/worldThumb'
import { replaceTileType } from '@/lib/save/worldTileReplace'
import {
  buildContentEdits,
  draftFromContent,
  validateContentDraft,
  type ChestEdit,
  type SignEdit,
} from '@/lib/save/worldContent'
import { loadItemLimits, type ItemLimits } from '@/lib/itemLimits'
import { useDataset } from '@/lib/datasetContext'
import { parseWorldSections, type WorldSections } from '@/lib/save/worldStats'
import { applyWorldEdits } from '@/lib/save/worldWrite'
import { worldThumbnailBlob, worldImageFilename } from '@/lib/save/worldImage'
import {
  cacheWorld,
  cachedWorld,
  isWorldFileTooLarge,
  loadDemoWorldFile,
  readWorldFile,
  worldErrorMessage,
  type WorldView,
  canExportHiRes,
  renderWorldHiRes,
} from '@/lib/worldPage'

interface WorldPageProps {
  /** 当前上游 id（解析结果按服务器分开缓存，方便切页面回来继续看）。 */
  serverId: string
}

/**
 * 「查看世界」：选择本地 `.wld`（`.wld.bak` / `.wld.bak2` 同格式），看世界缩略图与基本信息，
 * 可导出原文件，也可把缩略图导出成图片。
 *
 * **全程在浏览器本地完成**：文件不上传服务器（解析见 `lib/save/worldFile.ts`，
 * 缩略图渲染见 `lib/save/worldThumb.ts`），因此不需要登录、不依赖任何插件。
 */
export function WorldPage({ serverId }: WorldPageProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  const importRef = useRef<HTMLInputElement>(null)
  /** 箱子物品的校验规则（`item-limits.json`，懒加载；拿不到就不允许保存内容改动）。 */
  const [limits, setLimits] = useState<ItemLimits | null>(null)
  const [limitsFailed, setLimitsFailed] = useState(false)
  /** 箱 / 招牌的原始解析结果（用于和草稿做差异；进编辑态时解析一次）。 */
  const [sections, setSections] = useState<WorldSections | null>(null)

  /** 当前展示的世界（切到别的页面再回来还在，刷新页面则清空）。 */
  const [view, setView] = useState<WorldView | null>(() => cachedWorld(serverId) ?? null)
  /** 原始 `.wld` 文件（仅内存）：用于「导出 .wld」。 */
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [shooting, setShooting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 原始字节（查找图格需要再走一趟图格流；只在本地内存里）。 */
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  /** 查找命中的标记（画在缩略图上）。 */
  const [markers, setMarkers] = useState<TileMarkers | null>(null)
  /** 点查找结果 → 在 1:1 大图里跳到该坐标（`seq` 递增以支持重复点同一处）。 */
  const [focus, setFocus] = useState<{ x: number; y: number; seq: number } | null>(null)
  /** 编辑态：原始字节 + 偏移表 + 解析结果 + 草稿（`null` = 只读）。 */
  const [edit, setEdit] = useState<{
    bytes: Uint8Array
    info: WorldInfo
    track: WorldTrack
    draft: WorldEditDraft
    /** 解析结果与图格统计：图格替换要用（名字 + 「将替换 N 格」的预估值）。 */
    parsed: ParsedWorld
    stats: WorldTileStats
    /** 箱子 / 招牌内容的编辑草稿（W4）。 */
    content: { chests: ChestEdit[]; signs: SignEdit[] }
  } | null>(null)

  /** 本地解析世界存档（不上传）：先读头部，再分块渲染缩略图（不卡界面）。 */
  const runImport = useCallback(
    async (picked: File) => {
      if (isWorldFileTooLarge(picked.size)) {
        setError(t('wld.err.tooLarge'))
        return
      }
      setImporting(true)
      setProgress(0)
      setError(null)
      try {
        const bytes = new Uint8Array(await picked.arrayBuffer())
        const next = await readWorldFile(bytes, { onProgress: setProgress })
        setFile(picked)
        setBytes(bytes)
        setView(next)
        cacheWorld(serverId, next)
        setEdit(null)
        setNotice(null)
        setMarkers(null)
        setFocus(null)
      } catch (err) {
        setError(worldErrorMessage(err, t))
      } finally {
        setImporting(false)
      }
    },
    [serverId, t],
  )

  /** 来个 Demo：取自带的那张空白世界（同样是本地解析，不经过任何接口）。 */
  const runDemo = useCallback(async () => {
    setError(null)
    try {
      await runImport(await loadDemoWorldFile())
    } catch {
      setError(t('wld.err.demoFailed'))
    }
  }, [runImport, t])

  /** 进入编辑态：原始字节 → 解析（顺带记录偏移表）→ 草稿。 */
  const startEdit = useCallback(async () => {
    if (!file) return
    setError(null)
    setNotice(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const track = {} as WorldTrack
      const parsed = parseWorld(bytes, track)
      const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 40_000 })
      const parsedSections = parseWorldSections(bytes, track, parsed.info.release)
      setSections(parsedSections)
      setEdit({
        bytes,
        info: parsed.info,
        track,
        draft: draftFromWorld(parsed.info, track),
        parsed,
        stats: thumb.stats,
        content: draftFromContent(parsedSections.chestList ?? [], parsedSections.signList ?? []),
      })
      if (!limits) {
        try {
          setLimits(await loadItemLimits())
        } catch {
          // 拿不到物品规则时：箱子物品仍可改，但保存会由 limitsFailed 拦（与「查看存档」一致）
          setLimitsFailed(true)
        }
      }
    } catch (err) {
      setError(worldErrorMessage(err, t))
    }
  }, [file, limits, t])

  const issues = edit
    ? validateWorldDraft(edit.draft, { info: edit.info, track: edit.track })
    : []
  const dirty = edit ? isWorldDraftDirty(edit.info, edit.track, edit.draft) : false

  /** 箱子 / 招牌内容校验（只校验改过的）。 */
  const contentIssues = edit
    ? validateContentDraft(edit.content, {
        chests: sections?.chestList ?? [],
        signs: sections?.signList ?? [],
        catalog: {
          hasItem: (id) => dataset?.itemsById.has(id) ?? false,
          maxStack: (id) => limits?.maxStackById.get(id),
          blocked: (id) => limits?.noInventory.has(id) ?? false,
          prefixes: (id) => dataset?.rollablePrefixesById.get(id),
        },
      })
    : []
  /** 箱子 / 招牌是否真的改了（决定要不要 item-limits 校验、以及要不要重排段）。 */
  const contentDirty =
    edit != null &&
    sections != null &&
    Object.keys(
      buildContentEdits(edit.content, {
        chests: sections.chestList ?? [],
        signs: sections.signList ?? [],
      }),
    ).length > 0
  const canSave =
    Boolean(edit) &&
    issues.length === 0 &&
    contentIssues.length === 0 &&
    // 只有「改了箱子物品」才需要 item-limits（数量上限来自它）；没加载到就不让保存内容改动
    (!contentDirty || (limits != null && !limitsFailed))

  /** 保存：生成新字节 → 下载 → 重新解析刷新缩略图与信息（保证看到的就是写出去的）。 */
  const saveEdit = async () => {
    if (!edit || !file || !canSave) return
    const edits = buildWorldEdits(edit.info, edit.track, edit.draft)
    // 箱子 / 招牌的改动是**变长段**，跟字段补丁一起交给 applyWorldEdits（它会按段重建 + 重排指针）
    const contentEdits = sections
      ? buildContentEdits(edit.content, { chests: sections.chestList ?? [], signs: sections.signList ?? [] })
      : {}
    if (contentEdits.chests) edits.chests = contentEdits.chests
    if (contentEdits.signs) edits.signs = contentEdits.signs
    if (Object.keys(edits).length === 0) {
      setNotice(t('wld.edit.noChange'))
      setEdit(null)
      return
    }
    try {
      const out = applyWorldEdits(edit.bytes, edit.track, edits)
      const name = file.name || 'world.wld'
      const payload = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
      downloadBlob(new Blob([payload], { type: 'application/octet-stream' }), name)
      const next = await readWorldFile(out)
      setBytes(out)
      setMarkers(null)
      // 旧坐标是上一个版本的，清掉；否则「跳转高亮」会按旧坐标重新弹出 1:1 大图
      setFocus(null)
      setFile(new File([payload], name, { type: 'application/octet-stream' }))
      setView(next)
      cacheWorld(serverId, next)
      setEdit(null)
      setError(null)
      setNotice(t('wld.edit.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('save.err.readFailed'))
    }
  }

  /**
   * 图格替换：安全子集（长度 / 段指针 / footer 全不变），所以这里**不**走 `applyWorldEdits`，
   * 直接换掉 id 字节 → 下载 → 用新字节刷新预览（保证看到的就是写出去的）。
   */
  const replaceTiles = async (from: number, to: number) => {
    if (!edit || !file) return
    try {
      const res = replaceTileType(edit.bytes, edit.parsed, from, to)
      const name = file.name || 'world.wld'
      const payload = res.bytes.buffer.slice(
        res.bytes.byteOffset,
        res.bytes.byteOffset + res.bytes.byteLength,
      ) as ArrayBuffer
      downloadBlob(new Blob([payload], { type: 'application/octet-stream' }), name)
      const next = await readWorldFile(res.bytes)
      setBytes(res.bytes)
      setMarkers(null)
      setFocus(null)
      setFile(new File([payload], name, { type: 'application/octet-stream' }))
      setView(next)
      cacheWorld(serverId, next)
      // 替换后留在编辑态，并把新的解析结果 / 统计换上（否则下一次替换用的是旧统计）
      setEdit((prev) =>
        prev ? { ...prev, bytes: res.bytes, parsed: next.parsed, stats: next.thumb.stats } : prev,
      )
      setError(null)
      setNotice(t('wld.replace.done', { n: res.replacedCells.toLocaleString() }))
    } catch (err) {
      setError(t('wld.replace.failed', { reason: err instanceof Error ? err.message : String(err) }))
    }
  }

  const pickImport = () => importRef.current?.click()
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const dropped = e.dataTransfer?.files?.[0]
    if (dropped) void runImport(dropped)
  }

  /** 导出原始 `.wld`：把导入时读到的文件原样下载（不经过任何后端）。 */
  const exportWorld = () => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name || 'world.wld'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /** 导出图片：把渲染好的缩略图编码成 PNG 下载（与「查看存档」的导出图片同款）。 */
  const exportImage = useCallback(async () => {
    if (!view) return
    setShooting(true)
    try {
      const blob = await worldThumbnailBlob(view.thumb)
      if (blob) downloadBlob(blob, worldImageFilename(view.info.name))
      else setError(t('players.shotFailed'))
    } catch {
      setError(t('players.shotFailed'))
    } finally {
      setShooting(false)
    }
  }, [view, t])

  /** 高清导出：按 1 图格 = 1 像素重画一次再编码（屏幕上那张缩略图对 8400 宽的世界是 2 图格/像素）。 */
  const exportHiRes = useCallback(async () => {
    if (!view || !bytes) return
    const { width, height, name } = view.info
    if (!canExportHiRes(width, height)) {
      setError(t('wld.hiRes.tooBig'))
      return
    }
    // 大世界 ≈ 20M px ≈ 160 MB：先让人确认一下，避免手机被系统杀掉
    if (width * height > 8_000_000 && !window.confirm(t('wld.hiRes.confirm', { w: width, h: height }))) {
      return
    }
    setShooting(true)
    setError(null)
    try {
      const thumb = await renderWorldHiRes(bytes, view.parsed)
      const blob = await worldThumbnailBlob(thumb)
      if (blob) downloadBlob(blob, worldImageFilename(name).replace(/\.png$/, '-hires.png'))
      else setError(t('players.shotFailed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('players.shotFailed'))
    } finally {
      setShooting(false)
    }
  }, [view, bytes, t])

  return (
    // 整块都可以接收拖入的存档（选中过世界后也能换一个）
    <div
      className="flex flex-col gap-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="world-drop"
    >
      {view && !edit && (
        <TopBarActions>
          <IconAction
            label={t('wld.shot')}
            icon={Camera}
            loading={shooting}
            disabled={importing}
            onClick={() => void exportImage()}
          />
          <IconAction
            label={t('wld.hiRes.action')}
            icon={ZoomIn}
            loading={false}
            disabled={importing || shooting || !bytes}
            onClick={() => void exportHiRes()}
          />
        </TopBarActions>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 pt-4">
          {edit ? (
            <>
              <Button variant="primary" disabled={!canSave} onClick={() => void saveEdit()}>
                <Download data-icon="inline-start" />
                {t('wld.edit.save')}
              </Button>
              {dirty ? (
                <ConfirmButton
                  size="md"
                  variant="outline"
                  confirmLabel={t('wld.edit.discardConfirm')}
                  confirmVariant="danger"
                  onConfirm={() => {
                    setEdit(null)
                    setNotice(null)
                  }}
                >
                  {t('wld.edit.discard')}
                </ConfirmButton>
              ) : (
                <Button variant="outline" onClick={() => setEdit(null)}>
                  {t('wld.edit.discard')}
                </Button>
              )}
              <p
                className="min-w-0 flex-1 text-2xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {issues.length > 0 ? t('wld.edit.err.fixIssues') : t('wld.edit.notice')}
              </p>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={importing} onClick={pickImport}>
                {importing ? (
                  <Spinner aria-hidden data-icon="inline-start" />
                ) : (
                  <Upload data-icon="inline-start" />
                )}
                {t('wld.import')}
              </Button>
              <Button variant="outline" disabled={importing} onClick={() => void runDemo()}>
                <Sparkles data-icon="inline-start" />
                {t('wld.demo')}
              </Button>
              {file && (
                <Button variant="outline" disabled={importing} onClick={exportWorld}>
                  <Download data-icon="inline-start" />
                  {t('wld.export')}
                </Button>
              )}
              {file && view && (
                <Button variant="outline" disabled={importing} onClick={() => void startEdit()}>
                  <Pencil data-icon="inline-start" />
                  {t('wld.edit')}
                </Button>
              )}
              <p
                className="min-w-0 flex-1 text-2xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {importing && progress > 0
                  ? t('wld.rendering', { percent: Math.round(progress * 100) })
                  : t('wld.hint')}
              </p>
            </>
          )}
          <input
            ref={importRef}
            id="world-wld-input"
            name="world-wld-input"
            type="file"
            accept=".wld,.wld.bak,.wld.bak2,application/octet-stream"
            className="hidden"
            data-testid="world-wld-input"
            onChange={(e) => {
              const picked = e.target.files?.[0]
              e.target.value = '' // 允许再次选择同一个文件
              if (picked) void runImport(picked)
            }}
          />
        </CardBody>
      </Card>

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

      {edit ? (
        <>
          <Alert variant="info">
            <AlertDescription>{t('wld.edit.serverWarn')}</AlertDescription>
          </Alert>
          <WorldEditPanel
            info={edit.info}
            track={edit.track}
            draft={edit.draft}
            issues={issues}
            onChange={(draft) => setEdit((prev) => (prev ? { ...prev, draft } : prev))}
          />
          <WorldTileReplace
            world={edit.parsed}
            stats={edit.stats}
            onReplace={(from, to) => void replaceTiles(from, to)}
          />
          <WorldContentEditor
            chests={edit.content.chests}
            signs={edit.content.signs}
            issues={contentIssues}
            limits={limits}
            onChange={(content) => setEdit((prev) => (prev ? { ...prev, content } : prev))}
          />
        </>
      ) : view ? (
        <>
          <WorldPanel
            world={view.info}
            thumb={view.thumb}
            markers={markers}
            focus={focus}
            onFocusClear={() => setFocus(null)}
            bytes={bytes ?? undefined}
            parsed={view.parsed}
          />
          {bytes && (
            <WorldFind
              bytes={bytes}
              parsed={view.parsed}
              onMarkersChange={setMarkers}
              onFocusHit={(hit) => setFocus({ ...hit, seq: Date.now() })}
            />
          )}
          <WorldAnalysis info={view.info} stats={view.thumb.stats} sections={view.sections} />
        </>
      ) : (
        <Empty className="min-h-40 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Upload />
            </EmptyMedia>
            <EmptyTitle>{t('wld.empty')}</EmptyTitle>
            <EmptyDescription>{t('wld.emptyHint')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
