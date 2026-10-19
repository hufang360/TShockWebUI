import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, RefreshCw, Search, ShieldAlert, Upload } from 'lucide-react'
import { LoginGate } from '@/components/LoginGate'
import { Notice } from '@/components/Notice'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SearchInput } from '@/components/SearchInput'
import {
  BackpackCluster,
  EquipCluster,
  Group,
  LoadoutBlock,
  PlayerInfoPanel,
  sliceGroup,
} from '@/components/player/PlayerLookView'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardBody,
  Field,
  FieldLabel,
  Separator,
  Spinner,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { addSearchHistory } from '@/lib/searchHistory'
import { StorageKeys } from '@/lib/storage'
import {
  GROUP_ICON_IDS,
  LOADOUT_KEYS,
  PLAYER_SLOT_GROUPS,
} from '@/lib/playerSlots'
import { useModuleState } from '@/hooks/useModuleState'
import { useDataset } from '@/lib/datasetContext'
import { setSelfAvatar } from '@/lib/selfAvatar'
import { useI18n } from '@/lib/i18n'
import { TshockRequestError } from '@/lib/tshock'
import type { BackendTransport, PlayerCapabilities, PlayerLook } from '@/lib/tshock'

/**
 * 玩家管理：查看玩家背包、导出角色存档（.plr）。
 *
 * 依赖 TShock 第三方插件 PlayerManager（`/pm/look`、`/pm/export`），权限由服务器判定：
 *   - 未安装插件 → 404 → 界面提示「未安装」
 *   - 无 playermanager 权限 → 403 → 界面提示「无权限」
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
  onTokenInvalid: () => void
  onLogin: () => void
}

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
  /** 上次的 look 是否来自本地 .plr 导入。 */
  imported?: boolean
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

export function PlayerManagerPage({
  serverId,
  transport,
  authenticated,
  username,
  players,
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
  const [imported, setImported] = useState(cached?.imported === true)
  const [busy, setBusy] = useState<'look' | 'export' | 'import' | null>(null)
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

  // 实时探测插件可用性（登录后 / 切换服务器后重探）。
  useEffect(() => {
    if (!authenticated) {
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
  }, [serverId, authenticated, transport, onTokenInvalid, kindMessage])

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
        setImported(false)
        rememberName(result.name || who)
        // 写回内存缓存：切换模块回来直接展示，不再重拉。
        const c = cacheFor(transport)
        c.set(serverId, { ...c.get(serverId), name: who, look: result, imported: false })
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

  // 默认查看自己的背包：首次进入且没有缓存时自动拉一次（只拉一次，不随输入变化重复拉）。
  useEffect(() => {
    if (autoLoaded.current || !canUse || !name) return
    autoLoaded.current = true
    const hit = cacheFor(transport).get(serverId)
    if (hit?.look && hit.name === name) {
      setLook(hit.look)
      setImported(hit.imported === true)
      return
    }
    void runLook()
  }, [canUse, name, serverId, transport, runLook])

  const runImport = useCallback(
    async (file: File) => {
      setBusy('import')
      setError(null)
      try {
        const result = await transport.importPlayer(await file.arrayBuffer())
        setLook(result)
        setImported(true)
        setUiState({ name: result.name, touched: true })
        rememberName(result.name)
        const c = cacheFor(transport)
        c.set(serverId, { ...c.get(serverId), name: result.name, look: result, imported: true })
      } catch (err) {
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
        }
        setError(kindMessage(err))
      } finally {
        setBusy(null)
      }
    },
    [transport, serverId, setUiState, rememberName, onTokenInvalid, kindMessage],
  )

  const runExport = useCallback(async () => {
    if (imported) {
      setError(t('players.importHint'))
      return
    }
    const target = name.trim()
    if (!target) {
      setError(t('players.err.needName'))
      return
    }
    setBusy('export')
    setError(null)
    try {
      const { filename, blob } = await transport.playerExport(target)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
        onTokenInvalid()
      }
      setError(kindMessage(err))
    } finally {
      setBusy(null)
    }
  }, [name, imported, transport, onTokenInvalid, kindMessage, t])

  const heading = (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">{t('page.players.title')}</h2>
      <p className="text-xs text-muted-foreground">{t('page.players.desc')}</p>
    </div>
  )

  if (!authenticated) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <LoginGate onLogin={onLogin} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {heading}

      {checking && (
        <Card>
          <CardBody className="flex items-center gap-2 pt-4 text-sm text-muted-foreground">
            <Spinner />
            {t('players.checking')}
          </CardBody>
        </Card>
      )}

      {!checking && capability === null && probeError && (
        <Notice icon={<AlertTriangle />} title={t('players.probeFailed')}>
          {probeError}
        </Notice>
      )}

      {!checking && capability?.plugin === false && (
        <Notice icon={<AlertTriangle />} title={t('players.pluginMissing')}>
          {t('players.pluginMissingHint')}
        </Notice>
      )}

      {!checking && capability?.plugin === true && !capability.permission && (
        <Notice icon={<ShieldAlert />} title={t('players.noPermission')}>
          {t('players.noPermissionHint')}
        </Notice>
      )}

      {canUse && (
        <Card>
          {/* 顶部多留一点边距：用户名（输入框）上方不贴卡边 */}
          <CardBody className="flex flex-col gap-3 pt-6">
            {/* 查询行：输入 + 带文字按钮（下载 / 刷新 / 查看）+ 分隔线 + 导入 .plr */}
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
                      size="sm"
                      variant="secondary"
                      disabled={busy != null || imported}
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
                      size="sm"
                      variant="secondary"
                      disabled={busy != null || imported}
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
                    <Button size="sm" variant="primary" disabled={busy != null} onClick={() => void runLook()}>
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
                <Separator orientation="vertical" className="mx-1 h-6" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy != null}
                      onClick={() => importRef.current?.click()}
                    >
                      {busy === 'import' ? (
                        <Spinner aria-hidden data-icon="inline-start" />
                      ) : (
                        <Upload data-icon="inline-start" />
                      )}
                      {t('players.import')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('players.importHint')}</TooltipContent>
                </Tooltip>
                <input
                  ref={importRef}
                  type="file"
                  accept=".plr,application/octet-stream"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = '' // 允许再次选择同一个文件
                    if (file) void runImport(file)
                  }}
                />
              </div>
            </TooltipProvider>

            {/* 简约视图 + 最近查询结果走输入框下拉（见上方 SearchInput） */}
            <div className="flex flex-wrap items-center gap-2">
              <Field orientation="horizontal" className="w-auto flex-nowrap gap-1.5">
                <Switch
                  id="players-compact"
                  checked={compact}
                  onCheckedChange={setCompact}
                  aria-label={t('players.compactView')}
                />
                <FieldLabel htmlFor="players-compact" className="font-normal text-muted-foreground">
                  {t('players.compactView')}
                </FieldLabel>
              </Field>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardBody>
        </Card>
      )}

      {look && dataset && (
        <div className="flex flex-col gap-4">
          {/* 角色总览：**左侧全身图 + 右侧属性**作为一组，占内容区一半宽度；窄屏整行。 */}
          <div className="flex w-full items-start gap-5 @[820px]:w-1/2">
            {/* 角色全身图：只画皮肤 / 衣服 / 头发（不含盔甲饰品）。 */}
            <PlayerAvatar look={look} />
            {/* 属性区：左边留出间隔，名字加大、与属性行拉开，整体高度与人物接近。 */}
            <div className="flex min-w-0 flex-1 flex-col gap-3 pt-2 pl-2">
              <div className="flex items-center gap-2 text-lg font-semibold">
                {look.name}
                {imported ? (
                  <Badge tone="mock">{t('players.imported')}</Badge>
                ) : (
                  <Badge tone={look.online ? 'success' : 'neutral'}>
                    {look.online ? t('players.online') : t('players.offline')}
                  </Badge>
                )}
              </div>
              <PlayerInfoPanel look={look} />
            </div>
          </div>

          <Separator />

          {/* 左右两组（用容器查询，`@container` 在 AppShell 内容区，兼顾侧栏/compact）：
              左组 = 背包（含钱币/弹药）+ 下方仓储（银行）；
              右组 = 装备区（杂项 + 染料/时装/装备）与配装泡在同一行，**配装在右侧**。
              内容够宽才并排；窄屏则左组在上、右组在下。 */}
          <div className="grid items-start gap-x-8 gap-y-6 @[1150px]:grid-cols-[auto_auto]">
            {/* 左组 */}
            <div className="flex flex-col gap-5">
              <BackpackCluster look={look} />
              {/* 银行：放到背包下方（精简视图下隐藏） */}
              {!compact && (
                <div className="flex flex-col gap-4">
                  {PLAYER_SLOT_GROUPS.filter((g) => g.column === 2).map((group) => (
                    <Group
                      key={group.key}
                      group={group}
                      items={sliceGroup(look, group)}
                      titleIconId={GROUP_ICON_IDS[group.key]}
                      open={!collapsed[group.key]}
                      onToggle={() => toggleCollapsed(group.key)}
                    />
                  ))}
                </div>
              )}
            </div>
            {/* 右组：装备区 + 配装（配装在右，排在同一行；精简视图下隐藏配装） */}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-5">
              <EquipCluster look={look} />
              {!compact && (
                <div className="flex flex-wrap items-start gap-x-2 gap-y-5">
                  {LOADOUT_KEYS.map((key) => (
                    <LoadoutBlock
                      key={key}
                      look={look}
                      groupKey={key}
                      open={!collapsed[key]}
                      onToggle={() => toggleCollapsed(key)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

