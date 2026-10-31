import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Camera, RefreshCw, Rows3, Search, ShieldAlert } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { LoginGate } from '@/components/LoginGate'
import { Notice } from '@/components/Notice'
import { PlayerLookPanel } from '@/components/player/PlayerLookPanel'
import { SearchInput } from '@/components/SearchInput'
import { TopBarActions } from '@/components/TopBar'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardBody,
  Skeleton,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { useModuleState } from '@/hooks/useModuleState'
import { usePlayerShot } from '@/hooks/usePlayerShot'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import { cacheFor, downloadBlob, playerErrorMessage } from '@/lib/playerPage'
import { addSearchHistory } from '@/lib/searchHistory'
import { setSelfAvatar } from '@/lib/selfAvatar'
import { StorageKeys } from '@/lib/storage'
import { TshockRequestError } from '@/lib/tshock'
import type { BackendTransport, PlayerCapabilities, PlayerLook } from '@/lib/tshock'

/**
 * 玩家管理（侧边栏「玩家管理」）：查 TShock 在线 / 离线玩家的背包与存档导出。
 *
 * 依赖 TShock 第三方插件 PlayerManager（`/pm/look`、`/pm/export`），权限由服务器判定：
 *   - 未安装插件 → 404 → 界面提示「未安装」
 *   - 无 playermanager 权限 → 403 → 界面提示「无权限」
 *
 * 「玩家存档」（上传本地 .plr）是**公开工具**，已独立为侧边栏菜单
 * （`pages/PlrPage.tsx`），不受本模块开关影响。
 * 两个页面都能把角色「导出图片」（`hooks/usePlayerShot.ts`）。
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
  /** 模块是否启用（设置 → 激活模块里的开关）。 */
  moduleEnabled?: boolean
  onTokenInvalid: () => void
  onLogin: () => void
}

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

  // 从内存缓存初始化：切换页面回来时不再重新探测/拉取（刷新页面则重新探测）。
  const cache = cacheFor(transport)
  const cached = cache.get(serverId)
  const [capability, setCapability] = useState<PlayerCapabilities | null>(cached?.capability ?? null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [checking, setChecking] = useState(cached?.capability == null)
  const [look, setLook] = useState<PlayerLook | null>(
    cached?.look && cached.name === name ? cached.look : null,
  )
  const [busy, setBusy] = useState<'look' | 'export' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { shooting, runShot } = usePlayerShot(dataset, setError)
  // 导出图片与查询共用同一套「忙碌」判断（任一进行中就禁用按钮）。
  const busyNow = busy ?? (shooting ? 'shot' : null)
  // 自动查一次「自己」的背包：只做一次，切换页面回来走缓存不重拉。
  const autoLoaded = useRef(false)

  // 实时探测插件可用性（已登录 + 模块已启用时探测）。
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
        setProbeError(playerErrorMessage(err, t))
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverId, authenticated, moduleEnabled, transport, onTokenInvalid, t])

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
        // 写回内存缓存：切换页面回来直接展示，不再重拉。
        const c = cacheFor(transport)
        c.set(serverId, { ...c.get(serverId), name: who, look: result })
      } catch (err) {
        if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
          onTokenInvalid()
        }
        setLook(null)
        setError(playerErrorMessage(err, t))
      } finally {
        setBusy(null)
      }
    },
    [name, serverId, transport, onTokenInvalid, t, rememberName],
  )

  // 默认查看自己的背包：进入页面且没有缓存时自动拉一次（只拉一次，不随输入变化重复拉）。
  useEffect(() => {
    if (!moduleEnabled || autoLoaded.current || !canUse || !name) return
    autoLoaded.current = true
    const hit = cacheFor(transport).get(serverId)
    if (hit?.look && hit.name === name) {
      setLook(hit.look)
      return
    }
    void runLook()
  }, [moduleEnabled, canUse, name, serverId, transport, runLook])

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
      setError(playerErrorMessage(err, t))
    } finally {
      setBusy(null)
    }
  }, [name, transport, onTokenInvalid, t])

  return (
    <div className="flex flex-col gap-4">
      {moduleEnabled && authenticated && (
        <TopBarActions>
          {canUse && (
            <IconAction
              label={t('players.compactView')}
              icon={Rows3}
              pressed={compact}
              onClick={() => setCompact(!compact)}
            />
          )}
          {look && (
            <IconAction
              label={t('players.shot')}
              icon={Camera}
              loading={shooting}
              disabled={busyNow != null}
              onClick={() => void runShot(look, false)}
            />
          )}
        </TopBarActions>
      )}

      {!moduleEnabled && (
        <Notice icon={<AlertTriangle />} title={t('players.moduleOff')}>
          {t('players.moduleOffHint')}
        </Notice>
      )}

      {moduleEnabled && !authenticated && <LoginGate onLogin={onLogin} />}

      {moduleEnabled && authenticated && checking && (
        <Card>
          <CardBody className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
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
          <CardBody className="flex flex-col gap-2 pt-2">
            {/* 查询行：输入 + 带文字按钮（下载 / 刷新 / 查看） */}
            <TooltipProvider delayDuration={150}>
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                  className="h-8 max-w-xs md:h-7"
                  inputClassName="text-xs"
                  value={name}
                  placeholder={t('players.namePlaceholder')}
                  leadingIcon={<Search className="size-4 text-muted-foreground" />}
                  shortcut
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
                      disabled={busyNow != null}
                      onClick={() => void runExport()}
                    >
                      {busyNow === 'export' ? (
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
                      disabled={busyNow != null}
                      onClick={() => void runLook(look?.name || name)}
                    >
                      {busyNow === 'look' ? (
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
                    <Button size="sm" variant="primary" disabled={busyNow != null} onClick={() => void runLook()}>
                      {busyNow === 'look' ? (
                        <Spinner aria-hidden data-icon="inline-start" />
                      ) : (
                        <Search data-icon="inline-start" />
                      )}
                      {t('players.look')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('players.look')}</TooltipContent>
                </Tooltip>
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

      {moduleEnabled && authenticated && busyNow === 'look' && !look && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" role="status" aria-busy="true">
          <span className="sr-only">{t('app.pageLoading')}</span>
          <Skeleton className="h-80 rounded-container" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-32 rounded-container" />
            <Skeleton className="h-72 rounded-container" />
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
        />
      )}
    </div>
  )
}
