import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, Download, ImageDown, RefreshCw, Rows3, Search, ShieldAlert, Upload } from 'lucide-react'
import { LoginGate } from '@/components/LoginGate'
import { Notice } from '@/components/Notice'
import { PlayerLookPanel } from '@/components/player/PlayerLookPanel'
import { SearchInput } from '@/components/SearchInput'
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
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { useModuleState } from '@/hooks/useModuleState'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { addSearchHistory } from '@/lib/searchHistory'
import { setSelfAvatar } from '@/lib/selfAvatar'
import { StorageKeys } from '@/lib/storage'
import { EQUIP_GROUP_A, EQUIP_GROUP_B } from '@/lib/playerSlots'
import { playerShotFilename, renderPlayerShot } from '@/lib/playerShot'
import { TshockRequestError } from '@/lib/tshock'
import type { BackendTransport, PlayerCapabilities, PlayerLook } from '@/lib/tshock'

/**
 * 玩家管理：**查看存档**（本地 .plr，不需要登录）+ **玩家管理**（TShock 在线 / 离线玩家背包与存档导出）。
 *
 * 「玩家管理」tab 依赖 TShock 第三方插件 PlayerManager（`/pm/look`、`/pm/export`），权限由服务器判定：
 *   - 未安装插件 → 404 → 界面提示「未安装」
 *   - 无 playermanager 权限 → 403 → 界面提示「无权限」
 * 「查看存档」tab 把 .plr 上传给后端解析后立即丢弃（`POST /api/player/import`，公开端点、
 * 按 IP 限流、不落盘），谁都能上传自己的存档看人物 / 属性 / 背包。
 *
 * 两个 tab 都能把当前角色「导出图片」（人物全身图 + 属性 + 背包 / 装备，PNG）。
 * 浏览器不持有 token，所有请求经后端同源 `/api/*` 转发。
 */
interface PlayerManagerPageProps {
  /** 当前上游 id：界面状态按服务器分开记忆。 */
  serverId: string
  transport: BackendTransport
  authenticated: boolean
  /** 当前登录用户名；没有记忆过玩家名时默认查看自己。 */
  username: string | null
  /** 在线玩家名（用于输入建议；离线玩家可手输）。 */
  players: string[]
  /** 「玩家管理」tab 是否可用（设置 → 激活模块里的开关；「查看存档」恒可用）。 */
  moduleEnabled?: boolean
  onTokenInvalid: () => void
  onLogin: () => void
}

/** tab：查看存档（本地 .plr）/ 玩家管理（TShock）。 */
type PlayerTabId = 'save' | 'manage'

/**
 * 按「上游 + transport」缓存探测结果与上次查看的背包（**内存**，刷新页面即清空）。
 *
 * 目的：侧栏切到别的模块再回来时，组件会重新挂载，但**不再重新探测/重新拉取**，
 * 直接显示上次的结果；需要最新数据时用结果区的刷新按钮手动刷新。
 * 用 `WeakMap<BackendTransport, ...>` 做外层键，保证测试里每个 transport 互相隔离。
 */
interface PlayerCache {
  capability?: PlayerCapabilities
  /** 上次查看的玩家名（用于判断缓存是否对应输入的玩家）。 */
  name?: string
  look?: PlayerLook
  /** 上次导入的本地存档（「查看存档」tab）。 */
  saveLook?: PlayerLook
}

const playerCaches = new WeakMap<BackendTransport, Map<string, PlayerCache>>()

function cacheFor(transport: BackendTransport): Map<string, PlayerCache> {
  let cache = playerCaches.get(transport)
  if (!cache) {
    cache = new Map()
    playerCaches.set(transport, cache)
  }
  return cache
}

/** 触发浏览器下载（导出 .plr / 导出图片共用）。 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 导出图片时需要翻译的分组标题（与 `lib/playerShot.ts` 的版面对应）。 */
const SHOT_GROUP_KEYS = [
  'players.group.inventory',
  'players.group.coins',
  'players.group.ammo',
  'players.group.trash',
  ...EQUIP_GROUP_B,
  ...EQUIP_GROUP_A,
]

export function PlayerManagerPage({
  serverId,
  transport,
  authenticated,
  username,
  players,
  moduleEnabled = true,
  onTokenInvalid,
  onLogin,
}: PlayerManagerPageProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  // 记住玩家名，刷新页面后自动恢复（tswui:moduleState；按服务器分开）。
  // 没记忆过时默认查看自己（当前登录用户名）。
  const [uiState, setUiState] = useModuleState<{
    name: string
    touched?: boolean
    recent?: string[]
    tab?: PlayerTabId
  } & Record<string, unknown>>(serverId, 'players', { name: '' })
  // `touched` 用来区分「从未填过」（默认自己）与「手动清空」（就显示空）。
  const name = uiState.name || (uiState.touched ? '' : username || '')
  const setName = useCallback((value: string) => setUiState({ name: value, touched: true }), [setUiState])
  // 最近查询过的玩家名（统一规则：最多 10 条、窄区域显示 5 条；见 lib/searchHistory.ts）；按服务器记忆。
  const recent = useMemo(() => uiState.recent ?? [], [uiState.recent])
  const rememberName = useCallback(
    (displayName: string) => {
      const n = displayName.trim()
      if (!n) return
      const next = addSearchHistory(recent, n)
      setUiState({ recent: next })
    },
    [recent, setUiState],
  )
  // 「查看存档」不需要登录 / 插件，所以是默认 tab；「玩家管理」tab 恒在（模块没启用时里面给出提示）。
  const tab: PlayerTabId = uiState.tab === 'manage' ? 'manage' : 'save'
  const setTab = useCallback((next: PlayerTabId) => setUiState({ tab: next }), [setUiState])
  // 精简视图：开启时隐藏「银行」与「配装」（默认开）。
  const [compact, setCompact] = useLocalState(StorageKeys.playersCompact, true)
  // 各分区（银行 / 配装）的折叠状态（按 key）。
  const [collapsed, setCollapsed] = useLocalState<Record<string, boolean>>(
    StorageKeys.playersCollapsed,
    {},
  )
  const toggleCollapsed = useCallback(
    (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] })),
    [setCollapsed],
  )
  const importRef = useRef<HTMLInputElement>(null)

  // 从内存缓存初始化：切换模块回来时不再重新探测/拉取（刷新页面则重新探测）。
  const cache = cacheFor(transport)
  const cached = cache.get(serverId)
  const [capability, setCapability] = useState<PlayerCapabilities | null>(cached?.capability ?? null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [checking, setChecking] = useState(cached?.capability == null)
  const [look, setLook] = useState<PlayerLook | null>(
    cached?.look && cached.name === name ? cached.look : null,
  )
  /** 「查看存档」tab 当前展示的本地存档（切换 tab 回来还在）。 */
  const [saveLook, setSaveLook] = useState<PlayerLook | null>(cached?.saveLook ?? null)
  const [busy, setBusy] = useState<'look' | 'export' | 'import' | 'shot' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 自动查一次「自己」的背包：只做一次，切换模块回来走缓存不重拉。
  const autoLoaded = useRef(false)

  const kindMessage = useCallback(
    (err: unknown): string => {
      if (err instanceof TshockRequestError) {
        switch (err.kind) {
          case 'token':
          case 'auth':
            return t('app.tokenInvalid')
          case 'permission':
            return t('players.err.permission')
          case 'plugin_missing':
            return t('players.err.pluginMissing')
          case 'rate_limited':
            return t('players.err.rateLimited')
          case 'timeout':
            return t('players.err.timeout')
          case 'unavailable':
            return t('players.err.unavailable')
          case 'validation':
            // 后端把上游 4xx（如 PlayerManager「未找到玩家」）的原文透传过来，直接展示具体原因。
            return err.message || t('players.err.badResponse')
          default:
            return t('players.err.badResponse')
        }
      }
      return err instanceof Error ? err.message : t('players.err.badResponse')
    },
    [t],
  )

  // 切 tab 时清掉提示，避免上一个 tab 的错误留在另一个 tab 里。
  useEffect(() => {
    setError(null)
  }, [tab])

  // 实时探测插件可用性（已登录 + 模块已启用时探测）。「查看存档」不需要登录 / 插件，也就不探测。
  useEffect(() => {
    if (!authenticated || !moduleEnabled) {
      setCapability(null)
      setProbeError(null)
      setLook(null)
      // 未登录（含登出/换账号）：缓存失效，下次登录必须重新探测（权限随用户组变化）。
      cacheFor(transport).delete(serverId)
      return
    }
    // 已有缓存（刚从这个模块切走又切回）→ 直接用 useState 初始化好的值，不再打探测请求。
    const hit = cacheFor(transport).get(serverId)
    if (hit?.capability) return
    let cancelled = false
    setChecking(true)
    setProbeError(null)
    void (async () => {
      try {
        const cap = await transport.playerCapabilities()
        if (cancelled) return
        setCapability(cap)
        const c = cacheFor(transport)
        c.set(serverId, { ...c.get(serverId), capability: cap })
      } catch (err) {
        if (cancelled) return
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
        }
        setCapability(null)
        setProbeError(kindMessage(err))
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverId, authenticated, moduleEnabled, transport, onTokenInvalid, kindMessage])

  const canUse = capability?.plugin === true && capability.permission === true
  // 最近查询的快捷按钮：不重复展示当前正在看的名字。
  const recentChips = recent.filter((n) => n.toLowerCase() !== (look?.name ?? '').toLowerCase())
  // 输入框下拉候选：最近查过的名字在前，再补上在线玩家（去重）。
  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const n of [...recentChips, ...players]) {
      const key = n.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(n)
    }
    return out
  }, [recentChips, players])

  // 联动侧栏头像：查到的是「当前登录账号本人」时，记下外观供账号卡片画全身图。
  useEffect(() => {
    if (!look || !username) return
    if (look.name.trim().toLowerCase() === username.trim().toLowerCase()) {
      setSelfAvatar(serverId, look)
    }
  }, [look, username, serverId])

  const runLook = useCallback(
    async (target?: string) => {
      const who = (target ?? name).trim()
      if (!who) {
        setError(t('players.err.needName'))
        return
      }
      setBusy('look')
      setError(null)
      try {
        const result = await transport.playerLook(who)
        setLook(result)
        rememberName(result.name || who)
        // 写回内存缓存：切换模块回来直接展示，不再重拉。
        const c = cacheFor(transport)
        c.set(serverId, { ...c.get(serverId), name: who, look: result })
      } catch (err) {
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
        }
        setLook(null)
        setError(kindMessage(err))
      } finally {
        setBusy(null)
      }
    },
    [name, serverId, transport, onTokenInvalid, kindMessage, t, rememberName],
  )

  // 默认查看自己的背包：进入到「玩家管理」tab 且没有缓存时自动拉一次（只拉一次，不随输入变化重复拉）。
  useEffect(() => {
    if (tab !== 'manage' || !moduleEnabled || autoLoaded.current || !canUse || !name) return
    autoLoaded.current = true
    const hit = cacheFor(transport).get(serverId)
    if (hit?.look && hit.name === name) {
      setLook(hit.look)
      return
    }
    void runLook()
  }, [tab, moduleEnabled, canUse, name, serverId, transport, runLook])

  /** 导入本地 .plr（不需要登录）：解析结果只用于展示，后端不保存。 */
  const runImport = useCallback(
    async (file: File) => {
      setBusy('import')
      setError(null)
      try {
        const result = await transport.importPlayer(await file.arrayBuffer())
        setSaveLook(result)
        const c = cacheFor(transport)
        c.set(serverId, { ...c.get(serverId), saveLook: result })
      } catch (err) {
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
        }
        setError(kindMessage(err))
      } finally {
        setBusy(null)
      }
    },
    [transport, serverId, onTokenInvalid, kindMessage],
  )

  const runExport = useCallback(async () => {
    const target = name.trim()
    if (!target) {
      setError(t('players.err.needName'))
      return
    }
    setBusy('export')
    setError(null)
    try {
      const { filename, blob } = await transport.playerExport(target)
      downloadBlob(blob, filename)
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        onTokenInvalid()
      }
      setError(kindMessage(err))
    } finally {
      setBusy(null)
    }
  }, [name, transport, onTokenInvalid, kindMessage, t])

  /**
   * 导出图片：把当前角色（人物全身图 + 属性 + 背包 / 装备）画成 PNG。
   * 见 `lib/playerShot.ts`（角色图与物品图标都是 canvas，不能直接截 DOM）。
   */
  const runShot = useCallback(
    async (target: PlayerLook, imported: boolean) => {
      setBusy('shot')
      setError(null)
      try {
        const blob = await renderPlayerShot(
          target,
          {
            status: imported
              ? t('players.imported')
              : target.online
                ? t('players.online')
                : t('players.offline'),
            info: [
              `${t('players.hp')} ${target.health} / ${target.maxHealth}`,
              `${t('players.mp')} ${target.mana} / ${target.maxMana}`,
              `${t('players.quests')} ${Number(target.questsCompleted ?? 0)} ${t('players.questsUnit')}`,
              ...(target.spawnX >= 0 ? [`${t('players.spawn')} ${target.spawnX}, ${target.spawnY}`] : []),
            ],
            groups: Object.fromEntries(SHOT_GROUP_KEYS.map((key) => [key, t(key)])),
          },
          dataset,
        )
        downloadBlob(blob, playerShotFilename(target.name))
      } catch {
        setError(t('players.shotFailed'))
      } finally {
        setBusy(null)
      }
    },
    [dataset, t],
  )

  const shotButton = (target: PlayerLook, imported: boolean) => (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            disabled={busy != null}
            onClick={() => void runShot(target, imported)}
          >
            {busy === 'shot' ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <ImageDown data-icon="inline-start" />
            )}
            {t('players.shot')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('players.shotHint')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  /** 选择 / 拖入 .plr 文件（隐藏的 file input 与拖拽共用）。 */
  const pickImport = () => importRef.current?.click()
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) void runImport(file)
  }

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

  const compactToggle = (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={compact ? 'secondary' : 'ghost'}
            aria-label={t('players.compactView')}
            aria-pressed={compact}
            onClick={() => setCompact(!compact)}
          >
            <Rows3 data-icon="inline-start" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('players.compactView')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as PlayerTabId)} className="gap-4">
        <TabsList
          aria-label={t('players.tabs')}
          variant="line"
          className="w-full justify-start"
        >
          <TabsTrigger value="save" variant="line" className="flex-none">
            {t('players.tab.save')}
          </TabsTrigger>
          <TabsTrigger value="manage" variant="line" className="flex-none">
            {t('players.tab.manage')}
          </TabsTrigger>
        </TabsList>

        {/* ── 查看存档：本地 .plr，不需要登录 / 插件 ───────────────────────── */}
        <TabsContent value="save" className="flex flex-col gap-4">
          {/* 整块都可以接收拖入的 .plr（选中过存档后也能换一个） */}
          <div
            className="flex flex-col gap-4"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            data-testid="players-save-drop"
          >
            <Card>
              <CardBody className="flex flex-wrap items-center gap-3 pt-4">
                <Button variant="primary" disabled={busy != null} onClick={pickImport}>
                  {busy === 'import' ? (
                    <Spinner aria-hidden data-icon="inline-start" />
                  ) : (
                    <Upload data-icon="inline-start" />
                  )}
                  {t('players.import')}
                </Button>
                <p className="min-w-0 flex-1 text-2xs text-muted-foreground">{t('players.saveHint')}</p>
                {saveLook && <div className="ml-auto">{compactToggle}</div>}
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
                actions={shotButton(saveLook, true)}
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
        </TabsContent>

        {/* ── 玩家管理：TShock 在线 / 离线玩家（需登录 + PlayerManager） ─────── */}
        <TabsContent value="manage" className="flex flex-col gap-4">
          {!moduleEnabled && (
            <Notice icon={<AlertTriangle />} title={t('players.moduleOff')}>
              {t('players.moduleOffHint')}
            </Notice>
          )}

          {moduleEnabled && !authenticated && <LoginGate onLogin={onLogin} />}

          {moduleEnabled && authenticated && checking && (
            <Card>
              <CardBody className="flex items-center gap-2 pt-4 text-sm text-muted-foreground">
                <Spinner />
                {t('players.checking')}
              </CardBody>
            </Card>
          )}

          {moduleEnabled && authenticated && !checking && capability === null && probeError && (
            <Notice icon={<AlertTriangle />} title={t('players.probeFailed')}>
              {probeError}
            </Notice>
          )}

          {moduleEnabled && authenticated && !checking && capability?.plugin === false && (
            <Notice icon={<AlertTriangle />} title={t('players.pluginMissing')}>
              {t('players.pluginMissingHint')}
            </Notice>
          )}

          {moduleEnabled &&
            authenticated &&
            !checking &&
            capability?.plugin === true &&
            !capability.permission && (
              <Notice icon={<ShieldAlert />} title={t('players.noPermission')}>
                {t('players.noPermissionHint')}
              </Notice>
            )}

          {moduleEnabled && authenticated && canUse && (
            <Card>
              {/* 顶部多留一点边距：用户名（输入框）上方不贴卡边 */}
              <CardBody className="flex flex-col gap-3 pt-6">
                {/* 查询行：输入 + 带文字按钮（下载 / 刷新 / 查看） */}
                <TooltipProvider delayDuration={150}>
                  <div className="flex flex-wrap items-center gap-2">
                    <SearchInput
                      className="h-9 max-w-xs"
                      inputClassName="text-sm"
                      value={name}
                      placeholder={t('players.namePlaceholder')}
                      history={suggestions}
                      historyHeader={t('players.nameSuggest')}
                      onValueChange={(v) => {
                        setName(v)
                        // 输入时清掉上一次的错误，避免边打字边被“无法解析”打扰。
                        setError(null)
                      }}
                      onHistorySelect={(n) => {
                        setName(n)
                        void runLook(n)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void runLook()
                      }}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="secondary"
                          disabled={busy != null}
                          onClick={() => void runExport()}
                        >
                          {busy === 'export' ? (
                            <Spinner aria-hidden data-icon="inline-start" />
                          ) : (
                            <Download data-icon="inline-start" />
                          )}
                          {t('players.export')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('players.export')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="secondary"
                          disabled={busy != null}
                          onClick={() => void runLook(look?.name || name)}
                        >
                          {busy === 'look' ? (
                            <Spinner aria-hidden data-icon="inline-start" />
                          ) : (
                            <RefreshCw data-icon="inline-start" />
                          )}
                          {t('players.refresh')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('players.refresh')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="primary"
                          disabled={busy != null}
                          onClick={() => void runLook()}
                        >
                          {busy === 'look' ? (
                            <Spinner aria-hidden data-icon="inline-start" />
                          ) : (
                            <Search data-icon="inline-start" />
                          )}
                          {t('players.look')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('players.look')}</TooltipContent>
                    </Tooltip>
                    {capability?.plugin === true && <div className="ml-auto">{compactToggle}</div>}
                  </div>
                </TooltipProvider>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </CardBody>
            </Card>
          )}

          {moduleEnabled && authenticated && busy === 'look' && !look && (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" role="status" aria-busy="true">
              <span className="sr-only">{t('app.pageLoading')}</span>
              <Skeleton className="h-80 rounded-xl" />
              <div className="flex flex-col gap-3">
                <Skeleton className="h-32 rounded-xl" />
                <Skeleton className="h-72 rounded-xl" />
              </div>
            </div>
          )}

          {moduleEnabled && authenticated && look && dataset && (
            <PlayerLookPanel
              look={look}
              imported={false}
              compact={compact}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapsed}
              actions={shotButton(look, false)}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
