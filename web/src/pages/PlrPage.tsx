import { useCallback, useRef, useState, type DragEvent } from 'react'
import { Download, Camera, Rows3, Upload } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
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
import { cacheFor } from '@/lib/playerPage'
import { SaveFormatError } from '@/lib/save/bytes'
import { parsePlrFile } from '@/lib/save/plr'
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
  const { shooting, runShot } = usePlayerShot(dataset, setError)

  /** 在本机解析 .plr（不上传）：解密 + 读字段都在浏览器里完成，结果只用于展示。 */
  const runImport = useCallback(
    async (file: File) => {
      setImporting(true)
      setError(null)
      try {
        const result = parsePlrFile(new Uint8Array(await file.arrayBuffer()))
        setSaveFile(file)
        setSaveLook(result)
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
      {saveLook && (
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
          <Button variant="primary" disabled={busy} onClick={pickImport}>
            {importing ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            {t('players.import')}
          </Button>
          {saveFile && (
            <Button variant="outline" disabled={busy} onClick={exportPlr}>
              <Download data-icon="inline-start" />
              {t('players.exportPlr')}
            </Button>
          )}
          <p className="min-w-0 flex-1 text-2xs text-muted-foreground">{t('players.saveHint')}</p>
          {fileInput}
        </CardBody>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {saveLook ? (
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
