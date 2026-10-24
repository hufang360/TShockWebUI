import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  RefreshCw,
  SlidersHorizontal,
  Terminal,
} from 'lucide-react'
import { COMMAND_CARD_BY_ID, type CommandCardId } from '@/components/home/commandCards'
import {
  EventsCard,
  QuickLinksCard,
  RecentCard,
  ServerStatusCard,
} from '@/components/home/HomeOverviewCards'
import { HomeCardManager } from '@/components/HomeCardManager'
import { CommandCard } from '@/components/CommandCard'
import { LoginGate } from '@/components/LoginGate'
import { DEFAULT_MODULES, type ModulesPrefs } from '@/lib/modules'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Spinner,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import {
  DEFAULT_AUTO_EXEC,
  isManual,
  sanitizeAutoExec,
  setManual,
} from '@/lib/autoExec'
import { useServerFeed } from '@/hooks/useServerFeed'
import { isRefreshDue, lastRefreshedAt, markRefreshed, refreshScope } from '@/lib/refreshGate'
import { useCommandResults } from '@/lib/commandResults'
import { useExecutionQueue } from '@/lib/executionQueue'
import {
  BUILTIN_CARD_META,
  DEFAULT_HOME_CARDS,
  customCardCommand,
  isBuiltinCardId,
  isCustomCardId,
  sanitizeHomeCards,
  upgradeHomeCardsLayout,
  type BuiltinCardId,
  type HomeCardsPrefs,
} from '@/lib/homeCards'
import { useI18n } from '@/lib/i18n'
import { readJson, StorageKeys, writeJson } from '@/lib/storage'
import { resultFromError, TshockRequestError, type BackendTransport, type ServerStatus } from '@/lib/tshock'
import type { CommandResult, Dataset, HistoryEntry, TabId } from '@/types'

/** 右栏「概览」卡片（固定放在右列，顺序：服务器状态 / 服务器动态 / 快捷入口 / 最近执行）。 */
const RIGHT_COLUMN_IDS = new Set<string>(['server', 'events', 'quick', 'recent'])
/** 「最近执行」固定一个合适的高度，内容超出时内部滚动。 */
const RECENT_LIMIT = 5

interface HomePageProps {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  /** 当前登录用户名（用于 /lookbag 等需要玩家名的指令）。 */
  username: string | null
  /** 当前 TShock 上游 id；切换服务器后需重新探测信使插件。 */
  serverId: string
  /** 模块开关（决定快捷入口是否显示鱼店 / 玩家管理）。 */
  modules?: ModulesPrefs
  /** 页面数据自动刷新间隔（毫秒，0 = 不自动刷新）。 */
  refreshInterval: number
  /** 服务器动态刷新间隔（毫秒）。 */
  eventsRefreshInterval: number
  /** token 失效 → 弹出登录框；返回是否重登成功。 */
  onTokenInvalid: () => Promise<boolean>
  /** 未登录时点「登录」打开登录框。 */
  onLogin: () => void
  onNavigate: (tab: TabId) => void
}

export function HomePage({
  dataset,
  transport,
  authenticated,
  username,
  serverId,
  modules = DEFAULT_MODULES,
  refreshInterval,
  eventsRefreshInterval,
  onTokenInvalid,
  onLogin,
  onNavigate,
}: HomePageProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  /** 服务器状态上次刷新时间（卡片底部展示）。 */
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  // 卡片依赖的插件可用性：null = 未知（不隐藏卡片），false = 未安装。
  //   - lookbag 依赖 PlayerManager，有 REST 探测端点（登录后主动探一次）；
  //   - 其它插件指令（/worldinfo、/bossinfo 依赖 WorldModify；/bossdamage、/alldeath 等同理）
  //     没有探测端点：首次执行若返回「指令不存在」（command_not_found）即判定插件未安装。
  const [playerPlugin, setPlayerPlugin] = useState<boolean | null>(null)
  const [missingCards, setMissingCards] = useState<Record<string, boolean>>({})
  // bump 一次 = 重新探测 PlayerManager（手动「刷新全部」时用）。
  const [pluginProbeToken, setPluginProbeToken] = useState(0)
  // 批量执行（「统一执行」）依赖的信使插件；null = 未知。
  const [batchPlugin, setBatchPlugin] = useState<boolean | null>(null)
  // 「页面数据刷新间隔」触发时用来连带刷新服务器动态。
  const [feedToken, setFeedToken] = useState(0)
  // 服务器动态（事件流 + 增强状态）；available=null 未知。
  const {
    events,
    extra,
    available: eventsPlugin,
    refreshedAt: feedRefreshedAt,
    refresh: refreshFeed,
  } = useServerFeed({
    transport,
    authenticated,
    serverId,
    maxEvents: 20,
    refreshInterval: eventsRefreshInterval,
    refreshToken: feedToken,
  })

  // 卡片布局：顺序 / 隐藏 / 自定义卡片（tswui:homeCards）。
  const [rawPrefs, setPrefs] = useLocalState<HomeCardsPrefs>(StorageKeys.homeCards, DEFAULT_HOME_CARDS)
  // sanitize 后再做一次默认布局升级（服务器动态第 2、快捷入口第 3）。
  const prefs = useMemo(() => upgradeHomeCardsLayout(sanitizeHomeCards(rawPrefs)), [rawPrefs])
  // 老布局升级后写回本机，避免每次进入首页都重复迁移。
  useEffect(() => {
    const sanitized = sanitizeHomeCards(rawPrefs)
    if (prefs.layoutVersion !== sanitized.layoutVersion) setPrefs(prefs)
  }, [prefs, rawPrefs, setPrefs])
  // 卡片「手动执行」偏好（tswui:autoExec）；默认全部自动。
  const [rawAutoExec, setAutoExec] = useLocalState(StorageKeys.autoExec, DEFAULT_AUTO_EXEC)
  const autoExec = useMemo(() => sanitizeAutoExec(rawAutoExec), [rawAutoExec])
  const setCardManual = useCallback(
    (id: string, manual: boolean) =>
      setAutoExec((prev) => setManual(sanitizeAutoExec(prev), `home:${id}`, manual)),
    [setAutoExec],
  )
  // 「统一执行」开关（tswui:homeBatch；在「设置」里切换）。
  const [batchMode] = useLocalState(StorageKeys.homeBatch, false)
  // 供 refreshAll 读取而不触发 effect 重建（避免隐藏卡片时整页重跑指令）。
  const prefsRef = useRef(prefs)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])
  // 「统一执行」开关 / 插件可用性也用 ref 传递，避免探测完成或切换开关时重跑指令。
  const batchRef = useRef({ mode: batchMode, plugin: batchPlugin })
  useEffect(() => {
    batchRef.current = { mode: batchMode, plugin: batchPlugin }
  }, [batchMode, batchPlugin])

  /** 卡片依赖的插件未安装时返回 true：首页不渲染，管理弹框里置灰标记。 */
  const pluginMissing = useCallback(
    (id: string): boolean => {
      if (id === 'lookbag') return playerPlugin === false || missingCards[id] === true
      if (id === 'events') return eventsPlugin === false
      return missingCards[id] === true
    },
    [playerPlugin, missingCards, eventsPlugin],
  )
  // 自动 /「刷新全部」/「统一执行」收集指令时跳过缺插件的卡片，
  // 否则卡片虽已隐藏，每次刷新仍会白跑一条必然失败的指令。
  const pluginMissingRef = useRef(pluginMissing)
  useEffect(() => {
    pluginMissingRef.current = pluginMissing
  }, [pluginMissing])

  // 全局执行队列：批量刷新串行执行并展示在侧栏；结果存全局，切页后仍可保留。
  const { enqueue, busy, busyPrefix } = useExecutionQueue()
  const { results: commandResults, setResult } = useCommandResults()

  // 首页每次挂载都重新读取最近执行（CommandPage 的写入存在 tswui:history）。
  // 同一条指令只保留最近一次（历史为最新在前）。
  const recent = useMemo(() => {
    const history = readJson<HistoryEntry[]>(StorageKeys.history, [])
    const seen = new Set<string>()
    const unique: HistoryEntry[] = []
    for (const entry of history) {
      if (seen.has(entry.cmd)) continue
      seen.add(entry.cmd)
      unique.push(entry)
      if (unique.length >= RECENT_LIMIT) break
    }
    return unique
  }, [])
  const withAuth = useCallback(
    async (cmd: string): Promise<CommandResult> => {
      try {
        let res = await transport.runCommand(cmd)
        // token 失效：弹出登录框，登录成功后自动重试一次。
        if (res.status === 'token_invalid') {
          const reauthed = await onTokenInvalid()
          if (reauthed) res = await transport.runCommand(cmd)
        }
        return res
      } catch (err) {
        return resultFromError(err)
      }
    },
    [transport, onTokenInvalid],
  )

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      setStatus(await transport.serverStatus())
      setLastStatusAt(Date.now())
    } finally {
      setLoadingStatus(false)
    }
  }, [transport])

  /**
   * 按执行结果更新「该卡片依赖的插件是否已安装」：
   * 内置指令卡片返回 `command_not_found`（指令不存在）→ 判定插件未安装，
   * 与 `/lookbag` 一致：首页隐藏卡片、管理弹框里置灰标记；之后再执行成功则恢复。
   * 只对内置指令卡片生效（自定义卡片是玩家自己填的指令，交结果区展示即可）。
   */
  const markCardAvailability = useCallback((id: string, res: CommandResult) => {
    if (!COMMAND_CARD_BY_ID.has(id as CommandCardId)) return
    const missing = res.status === 'command_not_found'
    setMissingCards((prev) => {
      if (missing) return prev[id] ? prev : { ...prev, [id]: true }
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const loadCommand = useCallback(
    async (id: string, cmd: string) => {
      const res = await withAuth(cmd)
      setResult(id, res)
      markCardAvailability(id, res)
    },
    [withAuth, setResult, markCardAvailability],
  )

  const queueCommand = useCallback(
    (id: string, command: string) => {
      enqueue({
        key: `home:${id}`,
        labelKey: BUILTIN_CARD_META[id as BuiltinCardId].titleKey,
        label: command,
        command,
        run: () => loadCommand(id, command),
      })
    },
    [enqueue, loadCommand],
  )

  const queueCustomCommand = useCallback(
    (id: string, title: string, command: string) => {
      enqueue({ key: `home:${id}`, label: title, command, run: () => loadCommand(id, command) })
    },
    [enqueue, loadCommand],
  )

  /**
   * 严格按首页实际卡片顺序入队（跳过隐藏、手动执行与无指令的卡片）。
   * `skipMissing=false` 用于手动「刷新全部」：缺插件的卡片也重跑一次，装上插件后能立即恢复。
   */
  const enqueueVisibleCommands = useCallback((skipMissing = true) => {
    const { order, hidden, custom } = prefsRef.current
    const customById = new Map(custom.map((c) => [c.id, c]))
    for (const id of order) {
      if (hidden[id]) continue
      if (skipMissing && pluginMissingRef.current(id)) continue
      if (isManual(autoExec, `home:${id}`)) continue
      if (isBuiltinCardId(id)) {
        const def = COMMAND_CARD_BY_ID.get(id as CommandCardId)
        if (!def) continue
        const cmd = def.cmd(username)
        if (!cmd) continue
        queueCommand(id, cmd)
      } else if (isCustomCardId(id)) {
        const card = customById.get(id)
        if (!card) continue
        const cmd = customCardCommand(card)
        if (!cmd) continue
        queueCustomCommand(card.id, card.name.trim() || cmd, cmd)
      }
    }
  }, [username, queueCommand, queueCustomCommand, autoExec])

  /** 按首页顺序收集所有会执行的指令（key 为结果存储键，与卡片 id 一致）。 */
  const collectBatchEntries = useCallback((skipMissing = true): { key: string; cmd: string }[] => {
    const { order, hidden, custom } = prefsRef.current
    const customById = new Map(custom.map((c) => [c.id, c]))
    const entries: { key: string; cmd: string }[] = []
    for (const id of order) {
      if (hidden[id]) continue
      if (skipMissing && pluginMissingRef.current(id)) continue
      if (isManual(autoExec, `home:${id}`)) continue
      if (isBuiltinCardId(id)) {
        const def = COMMAND_CARD_BY_ID.get(id as CommandCardId)
        if (!def) continue
        const cmd = def.cmd(username)
        if (cmd) entries.push({ key: id, cmd })
      } else if (isCustomCardId(id)) {
        const card = customById.get(id)
        if (!card) continue
        const cmd = customCardCommand(card)
        if (cmd) entries.push({ key: card.id, cmd })
      }
    }
    return entries
  }, [username, autoExec])

  /** 一次请求执行全部卡片指令，并把结果分发回各卡片。 */
  const runBatchEntries = useCallback(
    async (entries: { key: string; cmd: string }[]) => {
      const run = async (): Promise<CommandResult[]> => {
        try {
          return await transport.runBatch(entries.map((e) => e.cmd))
        } catch (err) {
          // token 失效：弹登录框，成功后自动重试一次。
          if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
            const reauthed = await onTokenInvalid()
            if (reauthed) return await transport.runBatch(entries.map((e) => e.cmd))
          }
          throw err
        }
      }
      try {
        const results = await run()
        entries.forEach((entry, i) => {
          const res = results[i]
          if (res) {
            setResult(entry.key, res)
            markCardAvailability(entry.key, res)
          } else setResult(entry.key, { status: 'bad_response', output: [], message: '' })
        })
      } catch (err) {
        const res = resultFromError(err)
        entries.forEach((entry) => setResult(entry.key, res))
      }
    },
    [transport, onTokenInvalid, setResult, markCardAvailability],
  )

  const enqueueBatch = useCallback(
    (skipMissing = true) => {
      const entries = collectBatchEntries(skipMissing)
      if (entries.length === 0) return
      enqueue({
        key: 'home:__batch__',
        labelKey: 'home.batch',
        label: 'home.batch',
        command: entries.map((e) => e.cmd).join('  '),
        run: () => runBatchEntries(entries),
      })
    },
    [collectBatchEntries, enqueue, runBatchEntries],
  )

  // 卡片数据的「上次刷新全部」时间；自动进入时若 2 分钟内刷过则跳过。
  const homeScope = refreshScope(serverId, 'home')
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(() => lastRefreshedAt(homeScope))
  // 切换服务器后显示该服务器上次刷新的时间。
  useEffect(() => {
    setLastRefreshAt(lastRefreshedAt(refreshScope(serverId, 'home')))
  }, [serverId])

  const refresh = useCallback(
    async (force = false) => {
      // 未登录：只拉服务器状态，不受刷新间隔限制、也不记账。
      if (!authenticated) {
        await loadStatus()
        return
      }
      // 自动刷新受「页面数据刷新间隔」门控；手动「刷新全部」始终执行。
      const scope = refreshScope(serverId, 'home')
      if (!force && !isRefreshDue(scope, refreshInterval)) return
      if (force) {
        // 手动「刷新全部」= 重新探测一遍依赖插件的卡片：缺插件的卡片也重跑（下面 skipMissing=false），
        // 并重探 PlayerManager。装上插件后不用刷新整个页面，点一下「刷新全部」卡片就回来；
        // 仍然缺插件的卡片保持原标记（不隐藏再出现，避免闪一下）。
        setPluginProbeToken((n) => n + 1)
      }
      await loadStatus()
      setLastRefreshAt(markRefreshed(scope))
      // 页面数据刷新同时连带刷新服务器动态。
      setFeedToken((n) => n + 1)
      const { mode, plugin } = batchRef.current
      if (mode && plugin === true) enqueueBatch(!force)
      else enqueueVisibleCommands(!force)
    },
    [authenticated, serverId, refreshInterval, loadStatus, enqueueVisibleCommands, enqueueBatch],
  )

  // 「统一执行」已开启但插件可用性还没探测出来时先不刷新（否则首屏会用逐条执行）。
  const batchReady = !batchMode || batchPlugin !== null

  useEffect(() => {
    // 「统一执行」已开启但插件可用性还没探测出来时先等一等，
    // 否则首屏会退化成「逐条执行」。batchMode 关闭时 batchReady 恒为 true，
    // 不会因探测完成而重复刷新。
    if (!batchReady) return
    void refresh(false)
    // refresh 仅在 transport / 登录态 / 用户名变化时重建，避免重复拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, batchReady])

  // 切换服务器 / 重新登录后，「指令是否存在」要重新探测（各服装的插件不同）。
  useEffect(() => {
    setMissingCards({})
  }, [authenticated, transport, serverId])

  // 统一能力矩阵：一次请求同时拿到 PlayerManager（/lookbag 依赖）与批量执行（「统一执行」依赖）。
  // 失败 / 上游不可达时保持「未知」、不隐藏卡片；手动「刷新全部」会 bump pluginProbeToken 重探一次
  //（插件可能是刚装上的）。
  useEffect(() => {
    if (!authenticated) {
      setPlayerPlugin(null)
      setBatchPlugin(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const caps = await transport.capabilities()
        if (cancelled) return
        if (!caps.reachable) {
          // TShock 不可达：保持未知，别把卡片当「插件没装」隐藏掉。
          setPlayerPlugin(null)
          setBatchPlugin(null)
          return
        }
        setPlayerPlugin(caps.player.plugin)
        setBatchPlugin(caps.batch.plugin)
      } catch {
        if (cancelled) return
        setPlayerPlugin(null)
        setBatchPlugin(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authenticated, transport, serverId, pluginProbeToken])

  const openInEditor = useCallback(
    (cmd: string) => {
      // 写入草稿后跳到编辑器：CommandPage 挂载时会读取 tswui:draft。
      writeJson(StorageKeys.draft, cmd)
      onNavigate('editor')
    },
    [onNavigate],
  )

  const customById = useMemo(() => new Map(prefs.custom.map((c) => [c.id, c])), [prefs.custom])
  // 首页有指令在排队 / 执行中（或状态正在刷新）时禁用「刷新」。
  const refreshingAll = loadingStatus || busyPrefix('home:')

  // ---- 卡片渲染 ----

  const commandOutputCard = (opts: {
    id: string
    title: ReactNode
    icon: ReactNode
    command: string | null
    result?: CommandResult
    loading: boolean
    unavailable?: boolean
    unavailableText?: string
    emptyText?: string
    footerNote?: ReactNode
    onRefresh?: () => void
  }) => (
    <CommandCard
      key={opts.id}
      title={opts.title}
      icon={opts.icon}
      command={opts.command}
      result={opts.result}
      loading={opts.loading}
      unavailable={opts.unavailable}
      unavailableText={opts.unavailableText}
      emptyText={opts.emptyText}
      footerNote={opts.footerNote}
      action={isManual(autoExec, `home:${opts.id}`) ? 'run' : 'refresh'}
      collapseKey={`home:${opts.id}`}
      onRefresh={opts.onRefresh}
      className="max-h-[48rem]"
      itemsById={dataset.itemsById}
      prefixesById={dataset.prefixesById}
      atlas={dataset.atlas}
    />
  )

  const renderBuiltinCommandCard = (id: CommandCardId) => {
    const def = COMMAND_CARD_BY_ID.get(id)!
    const meta = BUILTIN_CARD_META[id]
    const cmd = def.cmd(username)
    return commandOutputCard({
      id,
      title: t(meta.titleKey),
      icon: def.icon,
      command: meta.command,
      result: commandResults[id],
      loading: busy(`home:${id}`),
      unavailable: !authenticated || !cmd,
      onRefresh: cmd ? () => queueCommand(id, cmd) : undefined,
      footerNote: def.noteKey ? (
        <span className="text-2xs leading-4 text-muted-foreground">{t(def.noteKey)}</span>
      ) : undefined,
    })
  }

  const renderCustomCard = (id: string) => {
    const card = customById.get(id)!
    const cmd = customCardCommand(card)
    const title = card.name.trim() || cmd || t('home.manageUntitled')
    if (!cmd) {
      return (
        <Card key={id} className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal />
              {title}
            </CardTitle>
          </CardHeader>
          <CardBody className="flex-1">
            <p className="text-xs text-warning">{t('home.customUnset')}</p>
          </CardBody>
        </Card>
      )
    }
    return commandOutputCard({
      id,
      title,
      icon: <Terminal />,
      command: cmd,
      result: commandResults[id],
      loading: busy(`home:${id}`),
      unavailable: !authenticated,
      emptyText: t('home.customClickRefresh'),
      onRefresh: () => queueCustomCommand(id, title, cmd),
    })
  }

  const renderCard = (id: string): ReactNode => {
    if (isBuiltinCardId(id)) {
      switch (id) {
        case 'server':
          return <ServerStatusCard key={id} status={status} lastStatusAt={lastStatusAt} />
        case 'recent':
          return <RecentCard key={id} recent={recent} onOpen={openInEditor} />
        case 'events':
          return (
            <EventsCard
              key={id}
              events={events}
              extra={extra}
              refreshedAt={feedRefreshedAt}
              eventsPlugin={eventsPlugin}
              dataset={dataset}
              onRefresh={refreshFeed}
              onNavigate={onNavigate}
            />
          )
        case 'quick':
          return (
            <QuickLinksCard key={id} modules={modules} serverId={serverId} onNavigate={onNavigate} />
          )
        default:
          return renderBuiltinCommandCard(id as CommandCardId)
      }
    }
    if (isCustomCardId(id) && customById.has(id)) return renderCustomCard(id)
    return null
  }

  const visibleCards = prefs.order.filter((id) => {
    if (prefs.hidden[id]) return false
    if (pluginMissing(id)) return false
    if (isBuiltinCardId(id)) return true
    return isCustomCardId(id) && customById.has(id)
  })
  // 两栏：左 = 指令卡片 + 自定义卡片；右 = 概览卡片（服务器状态 / 动态 / 快捷入口 / 最近执行）。
  // 各自保持 `prefs.order` 里的相对顺序。
  const leftCards = visibleCards.filter((id) => !RIGHT_COLUMN_IDS.has(id))
  const rightCards = visibleCards.filter((id) => RIGHT_COLUMN_IDS.has(id))

  // 未登录：隐藏首页所有卡片（数据都要 token 才能拉取），只留标题 + 登录提示。
  if (!authenticated) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">{t('nav.home')}</h2>
          {transport.mock && <Badge tone="mock">Mock</Badge>}
        </div>
        <LoginGate onLogin={onLogin} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">{t('nav.home')}</h2>
          {transport.mock && <Badge tone="mock">Mock</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshAt && (
            <span
              className="hidden text-2xs text-muted-foreground sm:inline"
              title={new Date(lastRefreshAt).toLocaleString()}
            >
              {t('home.lastRefresh', { time: new Date(lastRefreshAt).toLocaleTimeString() })}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={() => setManageOpen(true)}>
            <SlidersHorizontal data-icon="inline-start" />
            {t('home.manage')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void refresh(true)}
            disabled={refreshingAll}
          >
            {refreshingAll ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {refreshingAll ? t('home.refreshing') : t('home.refreshAll')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左栏：指令卡片（单列，高度随内容并限 min/max） */}
        <div data-testid="home-left" className="flex flex-col gap-4">
          {leftCards.map((id) => renderCard(id))}
        </div>
        {/* 右栏：概览卡片（服务器状态 / 服务器动态 / 快捷入口 / 最近执行） */}
        <div data-testid="home-right" className="flex flex-col gap-4">
          {rightCards.map((id) => renderCard(id))}
        </div>
      </div>

      {transport.mock && (
        <p className="text-center text-2xs text-muted-foreground">{t('home.mockNote')}</p>
      )}

      <HomeCardManager
        open={manageOpen}
        onOpenChange={setManageOpen}
        prefs={prefs}
        onChange={(next) => setPrefs(next)}
        pluginMissing={pluginMissing}
        isManual={(id) => isManual(autoExec, `home:${id}`)}
        onToggleManual={setCardManual}
      />
    </div>
  )
}
