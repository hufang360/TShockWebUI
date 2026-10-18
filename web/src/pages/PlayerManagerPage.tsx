import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, Download, RefreshCw, Search, ShieldAlert, Trash2, Upload } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { CollapseChevron } from '@/components/CollapseChevron'
import { LoginGate } from '@/components/LoginGate'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SearchInput } from '@/components/SearchInput'
import { SlotTooltip } from '@/components/SlotTooltip'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardBody,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
import { cn } from '@/lib/cn'
import { addSearchHistory } from '@/lib/searchHistory'
import { StorageKeys } from '@/lib/storage'
import {
  EQUIP_GROUP_A,
  EQUIP_GROUP_B,
  findGroup,
  GROUP_ICON_IDS,
  loadoutColumns,
  LOADOUT_KEYS,
  PLAYER_SLOT_GROUPS,
  type SlotGroup,
} from '@/lib/playerSlots'
import { useModuleState } from '@/hooks/useModuleState'
import { useDataset } from '@/lib/datasetContext'
import { setSelfAvatar } from '@/lib/selfAvatar'
import { useI18n, type I18n } from '@/lib/i18n'
import { TshockRequestError } from '@/lib/tshock'
import type {
  BackendTransport,
  PlayerCapabilities,
  PlayerItem,
  PlayerLook,
} from '@/lib/tshock'

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
              <p className="rounded-md bg-destructive/15 px-3 py-2 text-xs text-destructive">{error}</p>
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

/** 取分组对应的槽位（数据不足时只返回已有的，库层不对齐不补空格）。 */
function sliceGroup(look: PlayerLook, group: { start: number; count: number }): PlayerItem[] {
  return look.items.slice(group.start, group.start + group.count)
}

/** 分组里非空格子的数量（id <= 0 视为空）。 */
const countItems = (items: PlayerItem[]) => items.filter((it) => it && it.id > 0).length

type LabelKind = 'number' | 'none' | 'trash' | 'armor' | 'vanity' | 'dye' | 'miscEquip'

/** 空格子 tooltip 的文案类型；`none` = 不显示 tooltip（钱币 / 弹药）。 */
function labelKindOf(groupKey: string): LabelKind {
  switch (groupKey) {
    case 'players.group.coins':
    case 'players.group.ammo':
      return 'none'
    case 'players.group.trash':
      return 'trash'
    case 'players.group.armor':
      return 'armor'
    case 'players.group.vanity':
      return 'vanity'
    case 'players.group.dye':
    case 'players.group.miscDye':
      return 'dye'
    case 'players.group.miscEquip':
      return 'miscEquip'
    default:
      return 'number'
  }
}

/** 空格子 tooltip；`null` = 不显示。 */
function slotLabel(t: I18n['t'], kind: LabelKind, index: number): string | null {
  switch (kind) {
    case 'none':
      return null
    case 'trash':
      return t('players.group.trash')
    case 'armor':
    case 'vanity': {
      if (index === 0) return t('players.slot.helmet')
      if (index === 1) return t('players.slot.shirt')
      if (index === 2) return t('players.slot.pants')
      const n = index - 2
      return kind === 'vanity'
        ? t('players.slot.socialAccessory', { n })
        : t('players.slot.accessory', { n })
    }
    case 'dye':
      return t('players.slot.dye', { n: index + 1 })
    case 'miscEquip': {
      const names = [
        t('players.slot.pet'),
        t('players.slot.lightPet'),
        t('players.slot.minecart'),
        t('players.slot.mount'),
        t('players.slot.hook'),
      ]
      return names[index] ?? t('players.slot.number', { n: index + 1 })
    }
    default:
      return t('players.slot.number', { n: index + 1 })
  }
}

/** 可折叠的分组标题（银行 / 配装共用）：chevron + 可选物品图标 + 名称。 */
function CollapsibleTitle({
  label,
  titleIconId,
  open,
}: {
  label: string
  titleIconId?: number
  open: boolean
}) {
  const dataset = useDataset()
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className="group/title flex w-full cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {titleIconId != null && (
          <ItemIcon
            item={dataset?.itemsById.get(titleIconId)}
            atlas={dataset?.atlas}
            size={18}
            tooltip={false}
          />
        )}
        <span className="truncate">{label}</span>
        <CollapseChevron open={open} />
      </button>
    </CollapsibleTrigger>
  )
}

/** 普通分组：标题（可带物品图标）+ 网格（cols 列）。无数据时整块不渲染；支持折叠。 */
function Group({
  group,
  items,
  titleIconId,
  open,
  onToggle,
}: {
  group: SlotGroup
  items: PlayerItem[]
  titleIconId?: number
  open: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  if (items.length === 0) return null
  const kind = labelKindOf(group.key)
  const n = countItems(items)
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="flex flex-col gap-1.5">
      <CollapsibleTitle
        label={n > 0 ? `${t(group.key)}（${n}）` : t(group.key)}
        titleIconId={titleIconId}
        open={open}
      />
      <CollapsibleContent>
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${group.cols}, minmax(0, 1fr))`,
            maxWidth: group.cols * 40,
          }}
        >
          {items.map((it, i) => (
            <Slot key={it.slot} item={it} label={slotLabel(t, kind, i)} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** 单格宽的竖列（钱币 / 弹药 / 装备区每一列）。 */
function ArrowColumn({
  groupKey,
  items,
  dimLast,
  hideLabel,
}: {
  groupKey: string
  items: PlayerItem[]
  /** 恶魔之心未吃时，最后一格（额外配饰槽）半透明。 */
  dimLast?: boolean
  /** 不显示列顶标签（配装块用：直接用「配装 N」作标题）。 */
  hideLabel?: boolean
}) {
  const { t } = useI18n()
  if (items.length === 0) return null
  const kind = labelKindOf(groupKey)
  return (
    <section className="flex flex-col gap-1.5">
      {!hideLabel && (
        <h3 className="text-center text-xs font-medium whitespace-nowrap text-muted-foreground">
          {t(groupKey)}
        </h3>
      )}
      <div className="mx-auto grid gap-1" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 40 }}>
        {items.map((it, i) => (
          <Slot
            key={it.slot}
            item={it}
            label={slotLabel(t, kind, i)}
            dim={dimLast === true && i === items.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * 背包簇（仿游戏）：主格 10×5 + 钱币 / 弹药两列在右侧（列间隔减半），
 * 垃圾桶在主格右下角（最后一列下方），空格时显示半透明垃圾桶图标。
 */
function BackpackCluster({ look }: { look: PlayerLook }) {
  const { t } = useI18n()
  const main = sliceGroup(look, findGroup('players.group.inventory'))
  const coins = sliceGroup(look, findGroup('players.group.coins'))
  const ammo = sliceGroup(look, findGroup('players.group.ammo'))
  const trash = sliceGroup(look, findGroup('players.group.trash'))[0]
  if (main.length === 0) return null

  return (
    // 与右侧配装块顶部对齐；不额外留空行。
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('players.group.inventory')}
        </h3>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', maxWidth: 400 }}
        >
          {main.map((it, i) => (
            <Slot key={it.slot} item={it} label={slotLabel(t, 'number', i)} />
          ))}
          {/* 垃圾桶：主格最后一列正下方（第 6 行、第 10 列）。 */}
          {trash && (
            <Slot
              item={trash}
              label={t('players.group.trash')}
              style={{ gridColumnStart: 10 }}
              emptyIcon={<Trash2 className="size-5 text-muted-foreground/40" />}
            />
          )}
        </div>
      </section>
      {/* 钱币 + 弹药作为一个整体：窄屏时一起换到背包的下一行（列间隔已缩小）。 */}
      <div className="flex items-start gap-x-1">
        <ArrowColumn groupKey="players.group.coins" items={coins} />
        <ArrowColumn groupKey="players.group.ammo" items={ammo} />
      </div>
    </div>
  )
}

/** 恶魔之心未吃时，额外配饰槽那一格（装备/时装/染料竖列的最下面一格）半透明。 */
function accessoryLocked(look: PlayerLook, key: string): boolean {
  if (look.extraSlot) return false
  return key === 'players.group.armor' || key === 'players.group.vanity' || key === 'players.group.dye'
}

/**
 * 装备区：两组、整体**居左**；B组（杂项染料 / 杂项装备）在左，A组（染料 / 时装 / 装备）在右，
 * 组内列间隔减半，两组之间保持原间隔。
 */
function EquipCluster({ look }: { look: PlayerLook }) {
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      <div className="flex items-start gap-x-1">
        {EQUIP_GROUP_B.map((key) => (
          <ArrowColumn key={key} groupKey={key} items={sliceGroup(look, findGroup(key))} />
        ))}
      </div>
      <div className="flex items-start gap-x-1">
        {EQUIP_GROUP_A.map((key) => (
          <ArrowColumn
            key={key}
            groupKey={key}
            items={sliceGroup(look, findGroup(key))}
            dimLast={accessoryLocked(look, key)}
          />
        ))}
      </div>
    </div>
  )
}

/** 配装块：标题 + 3 列（染料 / 时装 / 装备，与装备区 A 组一致）。 */
function LoadoutBlock({
  look,
  groupKey,
  open,
  onToggle,
}: {
  look: PlayerLook
  groupKey: string
  open: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  const cols = loadoutColumns(findGroup(groupKey).start)
  const hasAny = cols.some((c) => sliceGroup(look, c).length > 0)
  if (!hasAny) return null
  const total = cols.reduce((n, c) => n + countItems(sliceGroup(look, c)), 0)
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="flex flex-col gap-1.5">
      <CollapsibleTitle
        label={total > 0 ? `${t(groupKey)}（${total}）` : t(groupKey)}
        open={open}
      />
      <CollapsibleContent>
        <div className="flex items-start gap-x-1.5">
          {cols.map((c) => (
            <ArrowColumn
              key={`${c.key}:${c.start}`}
              groupKey={c.key}
              items={sliceGroup(look, c)}
              dimLast={accessoryLocked(look, c.key)}
              hideLabel
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** 永久增强消耗品（图标 id + 名称 key）。 */
const BOOSTERS: { field: keyof PlayerLook; itemId: number; labelKey: string }[] = [
  { field: 'ateArtisanBread', itemId: 5326, labelKey: 'players.boost.artisanBread' },
  { field: 'usedAegisCrystal', itemId: 5337, labelKey: 'players.boost.aegisCrystal' },
  { field: 'usedAegisFruit', itemId: 5338, labelKey: 'players.boost.aegisFruit' },
  { field: 'usedArcaneCrystal', itemId: 5339, labelKey: 'players.boost.arcaneCrystal' },
  { field: 'usedGalaxyPearl', itemId: 5340, labelKey: 'players.boost.galaxyPearl' },
  { field: 'usedGummyWorm', itemId: 5341, labelKey: 'players.boost.gummyWorm' },
  { field: 'usedAmbrosia', itemId: 5342, labelKey: 'players.boost.ambrosia' },
]

/** 一次性解锁 / 升级类标记。 */
const UNLOCKS: { field: keyof PlayerLook; itemId: number; labelKey: string }[] = [
  { field: 'extraSlot', itemId: 3335, labelKey: 'players.boost.demonHeart' },
  { field: 'unlockedBiomeTorches', itemId: 5043, labelKey: 'players.boost.torchGod' },
  { field: 'unlockedSuperCart', itemId: 5289, labelKey: 'players.boost.superCart' },
]

/** `/pm/look` 额外返回的只读信息：生命 / 魔力 / 渔夫任务 / 重生点 + 永久增强。 */
function PlayerInfoPanel({ look }: { look: PlayerLook }) {
  const { t } = useI18n()
  const dataset = useDataset()
  // 只显示物品图标（名字交给物品 tooltip），不再重复写文字；未使用/未解锁的变淡。
  const itemIcon = (itemId: number, on: boolean) => (
    <ItemIcon
      key={itemId}
      item={dataset?.itemsById.get(itemId)}
      atlas={dataset?.atlas}
      size={20}
      className={on ? undefined : 'opacity-40'}
    />
  )
  const quests = Number(look.questsCompleted ?? 0)
  // 属性行：标签走 muted、数值加重并等宽（tabular-nums），拉开「属性 · 属性值」的层次；
  // 上限 / 单位用 muted 弱化，不再和数值黏成一坨。
  const attr = (label: string, value: ReactNode) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </>
  )
  return (
    <div className="flex flex-col gap-2 text-sm text-foreground">
      <dl className="mt-1 grid w-fit max-w-full grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-1">
        {attr(
          t('players.hp'),
          <>
            {look.health}
            <span className="font-normal text-muted-foreground"> / {look.maxHealth}</span>
          </>,
        )}
        {attr(
          t('players.mp'),
          <>
            {look.mana}
            <span className="font-normal text-muted-foreground"> / {look.maxMana}</span>
          </>,
        )}
        {attr(
          t('players.quests'),
          <>
            {quests}
            <span className="font-normal text-muted-foreground"> {t('players.questsUnit')}</span>
          </>,
        )}
        {look.spawnX >= 0 && attr(t('players.spawn'), <>{look.spawnX}, {look.spawnY}</>)}
      </dl>
      {/* 恶魔之心 / 火把神 / 矿车升级 + 7 个消耗品：都归到「永久增强」下；
          容器只有半宽，图标多时自动换行（`flex-wrap`）。 */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="mr-0.5 text-muted-foreground">{t('players.boost.title')}</span>
        {UNLOCKS.map((b) => itemIcon(b.itemId, look[b.field] === true))}
        {BOOSTERS.map((b) => itemIcon(b.itemId, look[b.field] === true))}
      </div>
    </div>
  )
}

function Slot({
  item,
  label,
  emptyIcon,
  dim,
  style,
}: {
  item: PlayerItem
  /** 空格子提示文案；`null` = 不显示（钱币 / 弹药）；缺省显示「空格子」。 */
  label?: string | null
  /** 空格子时显示的占位图标（如垃圾桶）。 */
  emptyIcon?: ReactNode
  /** 不可用（如未吃恶魔之心的额外配饰槽）：整格半透明。 */
  dim?: boolean
  style?: CSSProperties
}) {
  const { t } = useI18n()
  const dataset = useDataset()
  const prefixName = useMemo(
    () => (item.prefix > 0 ? dataset?.prefixesById.get(item.prefix)?.name ?? null : null),
    [dataset, item.prefix],
  )
  const empty = !item || item.id <= 0
  // 空格子用 shadcn Tooltip；有物品的格子由 ItemIcon 自带的 ItemTooltip 负责。
  const tipLabel = empty ? (label === null ? null : (label ?? t('players.slotEmpty'))) : null
  const frame = (
    <span
      className={cn(
        'group/slot relative inline-block size-9 transition-transform duration-100 ease-out hover:-translate-y-0.5',
        dim && 'opacity-40',
      )}
      style={style}
    >
      <span
        aria-hidden
        data-slot-frame
        className="absolute inset-0 rounded border border-muted-foreground/40 bg-muted/20 transition-colors group-hover/slot:border-foreground/60 group-hover/slot:bg-muted/50"
      />
      {empty ? (
        emptyIcon ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            {emptyIcon}
          </span>
        ) : null
      ) : (
        <ItemIcon
          item={dataset?.itemsById.get(item.id)}
          atlas={dataset?.atlas}
          size={36}
          stack={item.stack}
          prefix={prefixName}
          className="relative"
        />
      )}
    </span>
  )

  return tipLabel ? <SlotTooltip label={tipLabel}>{frame}</SlotTooltip> : frame
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <Alert variant="warning">
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  )
}
