import { useCallback, useRef, useState, type DragEvent } from 'react'
import { Camera, Download, Sparkles, ShieldCheck, Upload } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { TopBarActions } from '@/components/TopBar'
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
import { worldThumbnailBlob, worldImageFilename } from '@/lib/save/worldImage'
import {
  cacheWorld,
  cachedWorld,
  isWorldFileTooLarge,
  loadDemoWorldFile,
  readWorldFile,
  worldErrorMessage,
  type WorldView,
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
  const importRef = useRef<HTMLInputElement>(null)

  /** 当前展示的世界（切到别的页面再回来还在，刷新页面则清空）。 */
  const [view, setView] = useState<WorldView | null>(() => cachedWorld(serverId) ?? null)
  /** 原始 `.wld` 文件（仅内存）：用于「导出 .wld」。 */
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [shooting, setShooting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        setView(next)
        cacheWorld(serverId, next)
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

  return (
    // 整块都可以接收拖入的存档（选中过世界后也能换一个）
    <div
      className="flex flex-col gap-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="world-drop"
    >
      {view && (
        <TopBarActions>
          <IconAction
            label={t('wld.shot')}
            icon={Camera}
            loading={shooting}
            disabled={importing}
            onClick={() => void exportImage()}
          />
        </TopBarActions>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 pt-4">
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
          <p className="min-w-0 flex-1 text-2xs text-muted-foreground" role="status" aria-live="polite">
            {importing && progress > 0
              ? t('wld.rendering', { percent: Math.round(progress * 100) })
              : t('wld.hint')}
          </p>
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

      <Alert variant="info">
        <ShieldCheck />
        <AlertDescription>{t('wld.localNotice')}</AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {view ? (
        <WorldPanel world={view.info} thumb={view.thumb} />
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
