import { useCallback, useRef, useState, type DragEvent } from 'react'
import { Download, Camera, Pencil, Rows3, Sparkles, Upload } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { IconAction } from '@/components/IconAction'
import { PlrEditPanel } from '@/components/player/PlrEditPanel'
import { PlayerLookPanel } from '@/components/player/PlayerLookPanel'
import { TopBarActions } from '@/components/TopBar'
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
import { useLocalState } from '@/hooks/useLocalState'
import { usePlayerShot } from '@/hooks/usePlayerShot'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { loadItemLimits, type ItemLimits } from '@/lib/itemLimits'
import { cacheFor, downloadBlob, loadDemoPlrFile } from '@/lib/playerPage'
import { SaveFormatError } from '@/lib/save/bytes'
import { parsePlr, parsePlrFile, type PlrPlayer, type PlrTrack } from '@/lib/save/plr'
import {
  buildPlrEdits,
  draftFromPlayer,
  isDraftDirty,
  validatePlrDraft,
  type PlrEditDraft,
  type PlrItemCatalog,
} from '@/lib/save/plrEdit'
import { applyPlrEdits } from '@/lib/save/plrWrite'
import { StorageKeys } from '@/lib/storage'
import type { BackendTransport, PlayerLook } from '@/lib/tshock'

interface PlrPageProps {
  /** 当前上游 id（导入结果按服务器分开缓存）。 */
  serverId: string
  transport: BackendTransport
}

/**
 * 「查看存档」：上传本地 `.plr`，看人物 / 属性 / 背包 / 装备，可导出图片。
 *
 * **公开工具**：不读 TShock、不需要登录与任何权限，**也完全不上传服务器** ——
 * `.plr` 的 AES-128-CBC 解密与字段解析都在浏览器里做（`lib/save/plr.ts`），文件不离开本机。
 * 所以它是**独立侧边栏菜单**，不跟「玩家管理」模块开关走（那个依赖 PlayerManager 插件）。
 */
export function PlrPage({ serverId, transport }: PlrPageProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  // 精简视图：开启时隐藏「银行」与「配装」（默认开）。
  const [compact, setCompact] = useLocalState(StorageKeys.playersCompact, true)
  const [collapsed, setCollapsed] = useLocalState<Record<string, boolean>>(
    StorageKeys.playersCollapsed,
    {},
  )
  const toggleCollapsed = useCallback(
    (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] })),
    [setCollapsed],
  )
  const importRef = useRef<HTMLInputElement>(null)

  const cache = cacheFor(transport)
  const cached = cache.get(serverId)
  /** 当前展示的本地存档（切到别的页面再回来还在，刷新页面则清空）。 */
  const [saveLook, setSaveLook] = useState<PlayerLook | null>(cached?.saveLook ?? null)
  /** 原始 .plr 文件（仅内存）：用于「导出 .plr」。 */
  const [saveFile, setSaveFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { shooting, runShot } = usePlayerShot(dataset, setError)

  /** 编辑态：原始字节 + 偏移表 + 解析结果 + 草稿（`null` = 只读）。 */
  const [edit, setEdit] = useState<{
    bytes: Uint8Array
    player: PlrPlayer
    track: PlrTrack
    draft: PlrEditDraft
  } | null>(null)
  /** 物品数量 / 禁入背包规则（进入编辑态时懒加载）。 */
  const [limits, setLimits] = useState<ItemLimits | null>(null)
  const [limitsFailed, setLimitsFailed] = useState(false)

  /** 在本机解析 .plr（不上传）：解密 + 读字段都在浏览器里完成，结果只用于展示。 */
  const runImport = useCallback(
    async (file: File) => {
      setImporting(true)
      setError(null)
      try {
        const result = parsePlrFile(new Uint8Array(await file.arrayBuffer()))
        setSaveFile(file)
        setSaveLook(result)
        setEdit(null)
        setNotice(null)
        const c = cacheFor(transport)
        c.set(serverId, { ...c.get(serverId), saveLook: result })
      } catch (err) {
        setError(err instanceof SaveFormatError ? err.message : t('save.err.readFailed'))
      } finally {
        setImporting(false)
      }
    },
    [transport, serverId, t],
  )

  /** 来个 Demo：取自带的那份角色存档（同样是本地解析，不经过任何接口）。 */
  const runDemo = useCallback(async () => {
    setError(null)
    try {
      await runImport(await loadDemoPlrFile())
    } catch {
      setError(t('players.err.demoFailed'))
    }
  }, [runImport, t])

  /** 进入编辑态：拿原始字节 → 解析（顺带记录偏移表）→ 生成草稿。 */
  const startEdit = useCallback(async () => {
    if (!saveFile) return
    setError(null)
    setNotice(null)
    try {
      const bytes = new Uint8Array(await saveFile.arrayBuffer())
      const track: PlrTrack = { release: 0, boosts: {}, inventory: [], equipment: {}, storage: {}, loadouts: [] }
      const player = parsePlr(bytes, track)
      setEdit({ bytes, player, track, draft: draftFromPlayer(player, track) })
      if (!limits) {
        try {
          setLimits(await loadItemLimits())
          setLimitsFailed(false)
        } catch {
          setLimitsFailed(true)
        }
      }
    } catch (err) {
      setError(err instanceof SaveFormatError ? err.message : t('save.err.readFailed'))
    }
  }, [saveFile, limits, t])

  /** 校验用的物品目录：id 是否存在（dataset）+ 堆叠上限 / 禁入名单（item-limits.json）。 */
  const catalog: PlrItemCatalog = {
    hasItem: (id) => dataset?.itemsById.has(id) ?? false,
    maxStack: (id) => limits?.maxStackById.get(id),
    blocked: (id) => limits?.noInventory.has(id) ?? false,
    prefixes: (id) => dataset?.rollablePrefixesById.get(id),
  }
  const issues = edit ? validatePlrDraft(edit.draft, { catalog, original: edit.player }) : []
  const dirty = edit ? isDraftDirty(edit.player, edit.track, edit.draft) : false
  // `limits` 没就绪时不能保存：堆叠上限 / 禁入背包名单都在里面，缺了校验就会「写进去被游戏截断」。
  // （`limitsFailed` 另外单独拦：加载失败时同样不允许存。）
  const canSave = Boolean(edit) && issues.length === 0 && !limitsFailed && limits != null

  /** 保存：生成新字节 → 下载 → 用**重新解析的结果**刷新预览（保证看到的就是写出去的）。 */
  const saveEdit = () => {
    if (!edit || !saveFile || !canSave) return
    const edits = buildPlrEdits(edit.player, edit.track, edit.draft)
    if (Object.keys(edits).length === 0) {
      setNotice(t('save.edit.noChange'))
      setEdit(null)
      return
    }
    try {
      const out = applyPlrEdits(edit.bytes, edit.track, edits)
      const name = saveFile.name || 'player.plr'
      const payload = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
      downloadBlob(new Blob([payload], { type: 'application/octet-stream' }), name)
      const file = new File([payload], name, { type: 'application/octet-stream' })
      const look = parsePlrFile(out)
      setSaveFile(file)
      setSaveLook(look)
      const c = cacheFor(transport)
      c.set(serverId, { ...c.get(serverId), saveLook: look })
      setEdit(null)
      setError(null)
      setNotice(t('save.edit.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('save.err.readFailed'))
    }
  }

  const pickImport = () => importRef.current?.click()
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) void runImport(file)
  }

  const busy = importing || shooting
  const fileInput = (
    <input
      ref={importRef}
      id="players-plr-input"
      name="players-plr-input"
      type="file"
      accept=".plr,application/octet-stream"
      className="hidden"
      data-testid="players-plr-input"
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = '' // 允许再次选择同一个文件
        if (file) void runImport(file)
      }}
    />
  )

  /** 导出原始 .plr：把导入时读到的文件原样下载（后端不保存）。 */
  const exportPlr = () => {
    if (!saveFile) return
    const url = URL.createObjectURL(saveFile)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = saveFile.name || 'player.plr'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    // 整块都可以接收拖入的 .plr（选中过存档后也能换一个）
    <div
      className="flex flex-col gap-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="players-save-drop"
    >
      {saveLook && !edit && (
        <TopBarActions>
          <IconAction
            label={t('players.shot')}
            icon={Camera}
            loading={shooting}
            disabled={busy}
            onClick={() => void runShot(saveLook, true)}
          />
          <IconAction
            label={t('players.compactView')}
            icon={Rows3}
            pressed={compact}
            onClick={() => setCompact(!compact)}
          />
        </TopBarActions>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 pt-2">
          {edit ? (
            <>
              <Button variant="primary" disabled={!canSave} onClick={saveEdit}>
                <Download data-icon="inline-start" />
                {t('save.edit.save')}
              </Button>
              {dirty ? (
                <ConfirmButton
                  size="md"
                  variant="outline"
                  confirmLabel={t('save.edit.discardConfirm')}
                  confirmVariant="danger"
                  onConfirm={() => {
                    setEdit(null)
                    setNotice(null)
                  }}
                >
                  {t('save.edit.discard')}
                </ConfirmButton>
              ) : (
                <Button variant="outline" onClick={() => setEdit(null)}>
                  {t('save.edit.discard')}
                </Button>
              )}
              <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
                {issues.length > 0
                  ? t('save.edit.err.int')
                  : limitsFailed
                    ? t('save.edit.err.noLimits')
                    : t('save.edit.notice')}
              </p>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={busy} onClick={pickImport}>
                {importing ? (
                  <Spinner aria-hidden data-icon="inline-start" />
                ) : (
                  <Upload data-icon="inline-start" />
                )}
                {t('players.import')}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void runDemo()}>
                <Sparkles data-icon="inline-start" />
                {t('players.demo')}
              </Button>
              {saveFile && (
                <Button variant="outline" disabled={busy} onClick={exportPlr}>
                  <Download data-icon="inline-start" />
                  {t('players.exportPlr')}
                </Button>
              )}
              {saveFile && saveLook && dataset && (
                <Button variant="outline" disabled={busy} onClick={() => void startEdit()}>
                  <Pencil data-icon="inline-start" />
                  {t('save.edit')}
                </Button>
              )}
              <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
                {t('players.saveHint')}
              </p>
            </>
          )}
          {fileInput}
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

      {edit && limitsFailed && (
        <Alert variant="destructive">
          <AlertDescription>{t('save.edit.err.noLimits')}</AlertDescription>
        </Alert>
      )}

      {edit ? (
        <>
          <Alert variant="info">
            <AlertDescription>{t('save.edit.sscc')}</AlertDescription>
          </Alert>
          <PlrEditPanel
            player={edit.player}
            track={edit.track}
            draft={edit.draft}
            issues={issues}
            limits={limits}
            onChange={(draft) => setEdit((prev) => (prev ? { ...prev, draft } : prev))}
          />
        </>
      ) : saveLook ? (
        <PlayerLookPanel
          look={saveLook}
          imported
          compact={compact}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      ) : (
        <Empty className="min-h-40 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Upload />
            </EmptyMedia>
            <EmptyTitle>{t('players.saveEmpty')}</EmptyTitle>
            <EmptyDescription>{t('players.saveEmptyHint')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
