import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Amphora, Fish, PlayingCardsFan, RefreshCw, ShoppingBasket, Terminal, Trophy } from 'lucide-react'
import { CommandCard } from '@/components/CommandCard'
import { IconAction } from '@/components/IconAction'
import { FishNotepad } from '@/components/fishshop/FishNotepad'
import { ModuleCardManagerDialog, type ManageableCard } from '@/components/ModuleCardManagerDialog'
import { TopBarActions } from '@/components/TopBar'
import { useLocalState } from '@/hooks/useLocalState'
import { useModuleCards } from '@/hooks/useModuleCards'
import { DEFAULT_AUTO_EXEC, isManual, sanitizeAutoExec, setManual } from '@/lib/autoExec'
import { useCommandResults } from '@/lib/commandResults'
import { useExecutionQueue } from '@/lib/executionQueue'
import { useI18n } from '@/lib/i18n'
import { formatClock, formatClockWithDate } from '@/lib/clock'

import { isRefreshDue, lastRefreshedAt, markRefreshed, refreshScope } from '@/lib/refreshGate'
import { StorageKeys } from '@/lib/storage'
import { resultFromError, TshockRequestError, type BackendTransport } from '@/lib/tshock'
import type { CommandResult, Dataset } from '@/types'

interface FishCardDef {
  id: string
  titleKey: string
  command: string
  icon: ReactNode
  /** 默认**不显示**：玩家在「管理卡片」里打开「显示」才出现。 */
  defaultHidden?: boolean
  /** 默认**不自动执行**：只能点卡片自己的按钮执行（「自动执行」开关默认关）。 */
  defaultManual?: boolean
}

/**
 * 鱼店指令卡片。它们的输出都没有 REST 端点，只能靠 rawcmd 取回（不依赖鱼店 REST，老插件也能用）。
 *
 * 「钓鱼信息」常显；「鱼罐 / 消费榜 / 鱼篓榜」默认**不显示、也不自动执行** —— 这三张的输出较长、
 * 多数人只在想排行榜时才看，所以交给玩家自己在「管理卡片」里开「显示 / 自动执行」。
 */
const CARDS: FishCardDef[] = [
  { id: 'info', titleKey: 'fish.card.info', command: '/fish info', icon: <Fish /> },
  {
    id: 'jar',
    titleKey: 'fish.card.jar',
    command: '/fish jar',
    icon: <Amphora />,
    defaultHidden: true,
    defaultManual: true,
  },
  {
    id: 'rank',
    titleKey: 'fish.card.rank',
    command: '/fish rank',
    icon: <Trophy />,
    defaultHidden: true,
    defaultManual: true,
  },
  {
    id: 'basket',
    titleKey: 'fish.card.basket',
    command: '/fish basket',
    icon: <ShoppingBasket />,
    defaultHidden: true,
    defaultManual: true,
  },
]

interface FishCommandCardsProps {
  dataset: Dataset | null
  transport: BackendTransport
  authenticated: boolean
  /** 切换服务器后必须重新探测批量执行插件。 */
  serverId: string
  /** 页面数据自动刷新间隔（毫秒，0 = 不自动刷新）。 */
  refreshInterval: number
  /** token 失效 → 弹出登录框；返回是否重登成功。 */
  onTokenInvalid: () => Promise<boolean>
  /**
   * 「刷新全部」被**手动**点下时额外要做的事（鱼店页用它同时刷新货架）。
   *
   * 只在 `force`（人手点击）时调用，自动刷新不会触发 —— 否则进页面会重复拉一次货架。
   */
  onManualRefresh?: () => void
}

/**
 * 鱼店右侧「指令卡片」列：目前只有「钓鱼信息」（`/fish info`）。
 * 与首页卡片一致，支持「统一执行」（批量执行）；未安装批量插件时自动逐条执行。
 * 这些卡片只依赖 rawcmd，**不依赖鱼店 REST API**，因此插件未提供 REST 时仍可用。
 */
export function FishCommandCards({
  dataset,
  transport,
  authenticated,
  serverId,
  refreshInterval,
  onTokenInvalid,
  onManualRefresh,
}: FishCommandCardsProps) {
  const { t, lang } = useI18n()
  const { enqueue, busy, busyPrefix } = useExecutionQueue()
  const { results, setResult } = useCommandResults()
  const [batchMode] = useLocalState(StorageKeys.homeBatch, false)
  const [batchPlugin, setBatchPlugin] = useState<boolean | null>(null)
  // 卡片数据的「上次刷新全部」时间；进入页面时若 2 分钟内刷过则跳过。
  const fishScope = refreshScope(serverId, 'fish')
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(() => lastRefreshedAt(fishScope))
  useEffect(() => {
    setLastRefreshAt(lastRefreshedAt(refreshScope(serverId, 'fish')))
  }, [serverId])

  // 探测批量执行插件（WebUI）；切换服务器重探。
  useEffect(() => {
    if (!authenticated) {
      setBatchPlugin(null)
      return
    }
    let cancelled = false
    void transport
      .batchCapabilities()
      .then((c) => {
        if (!cancelled) setBatchPlugin(c.plugin)
      })
      .catch(() => {
        if (!cancelled) setBatchPlugin(false)
      })
    return () => {
      cancelled = true
    }
  }, [authenticated, transport, serverId])

  /** 执行一条指令（token 失效时弹登录框并重试一次）。 */
  const runOne = useCallback(
    async (key: string, cmd: string) => {
      const runOnce = async (): Promise<CommandResult> => {
        try {
          return await transport.runCommand(cmd)
        } catch (err) {
          return resultFromError(err)
        }
      }
      let res = await runOnce()
      if (res.status === 'token_invalid') {
        const reauthed = await onTokenInvalid()
        if (reauthed) res = await runOnce()
      }
      setResult(`fish:${key}`, res)
    },
    [transport, onTokenInvalid, setResult],
  )

  /** 一次请求执行全部卡片（批量插件），把结果分发回各卡片。 */
  const runBatchEntries = useCallback(
    async (entries: { key: string; command: string }[]) => {
      const run = async (): Promise<CommandResult[]> => {
        try {
          return await transport.runBatch(entries.map((e) => e.command))
        } catch (err) {
          if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
            const reauthed = await onTokenInvalid()
            if (reauthed) return await transport.runBatch(entries.map((e) => e.command))
          }
          throw err
        }
      }
      try {
        const list = await run()
        entries.forEach((entry, i) => {
          setResult(`fish:${entry.key}`, list[i] ?? { status: 'bad_response', output: [], message: '' })
        })
      } catch (err) {
        const res = resultFromError(err)
        entries.forEach((entry) => setResult(`fish:${entry.key}`, res))
      }
    },
    [transport, onTokenInvalid, setResult],
  )

  // 用户为鱼店追加的指令卡片（存 tswui:moduleCards，模块 id = store）。
  const {
    cards: customCards,
    add: addCard,
    update: updateCard,
    remove: removeCard,
  } = useModuleCards(serverId, 'store')
  const [manageOpen, setManageOpen] = useState(false)
  // 自动执行偏好（与首页 / 模块卡片一致）。
  const [rawAutoExec, setAutoExec] = useLocalState(StorageKeys.autoExec, DEFAULT_AUTO_EXEC)
  const autoExec = useMemo(() => sanitizeAutoExec(rawAutoExec), [rawAutoExec])
  const cardManual = useCallback(
    (card: ManageableCard) => isManual(autoExec, card.manualKey, card.defaultManual === true),
    [autoExec],
  )

  // 内置卡片的显示 / 隐藏：`{ [id]: true = 隐藏 }`；没记过的按卡片的 defaultHidden。
  const [rawHidden, setRawHidden] = useLocalState<Record<string, boolean>>(
    StorageKeys.fishHiddenCards,
    {},
  )
  const hiddenMap = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const [id, value] of Object.entries(rawHidden ?? {})) {
      if (typeof value === 'boolean') out[id] = value
    }
    return out
  }, [rawHidden])
  /** 某张内置卡片当前是否隐藏（自定义卡片不看这个）。 */
  const isHidden = useCallback(
    (id: string) => {
      const def = CARDS.find((c) => c.id === id)
      if (!def) return false
      return hiddenMap[id] ?? def.defaultHidden === true
    },
    [hiddenMap],
  )
  const toggleHidden = useCallback(
    (id: string) => {
      setRawHidden((prev) => {
        const next: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(prev ?? {})) {
          if (typeof value === 'boolean') next[key] = value
        }
        next[id] = !(next[id] ?? CARDS.find((c) => c.id === id)?.defaultHidden === true)
        return next
      })
    },
    [setRawHidden],
  )

  const entries = useMemo(
    () => [
      ...CARDS.map((c) => ({
        key: c.id,
        label: t(c.titleKey),
        icon: c.icon as ReactNode,
        command: c.command,
        custom: false,
        defaultManual: c.defaultManual === true,
        hidden: isHidden(c.id),
      })),
      ...customCards.map((c) => ({
        key: c.id,
        label: c.name || c.command,
        icon: <Terminal /> as ReactNode,
        command: c.command,
        custom: true,
        defaultManual: false,
        hidden: false,
      })),
    ],
    [customCards, t, isHidden],
  )

  const refreshAll = useCallback(
    (force = false) => {
      // 自动刷新受 2 分钟闸门限制；手动「刷新全部」始终执行。
      const scope = refreshScope(serverId, 'fish')
      if (!force && !isRefreshDue(scope, refreshInterval)) return
      setLastRefreshAt(markRefreshed(scope))
      // 手动刷新连货架一起刷（顶栏只有一个刷新按钮 —— 输入框那边不再重复放一个）。
      if (force) onManualRefresh?.()
      // 只刷新「显示着的 + 自动执行」的卡片（隐藏的 / 手动的只能点卡片自己的按钮）。
      const runnable = entries.filter(
        (e) => !e.hidden && !isManual(autoExec, `fish:${e.key}`),
      )
      if (batchMode && batchPlugin === true) {
        enqueue({
          key: 'fish:__batch__',
          labelKey: 'home.batch',
          label: 'home.batch',
          command: runnable.map((e) => e.command).join('  '),
          run: () => runBatchEntries(runnable),
        })
        return
      }
      for (const e of runnable) {
        enqueue({
          key: `fish:${e.key}`,
          label: e.label,
          command: e.command,
          run: () => runOne(e.key, e.command),
        })
      }
    },
    [
      autoExec,
      batchMode,
      batchPlugin,
      entries,
      enqueue,
      runBatchEntries,
      runOne,
      serverId,
      refreshInterval,
      onManualRefresh,
    ],
  )

  // 进入鱼店页自动刷新一次（受 2 分钟闸门限制）；批量插件可用性未探测完先等一等。
  const batchReady = !batchMode || batchPlugin !== null
  useEffect(() => {
    if (!authenticated || !batchReady) return
    refreshAll(false)
  }, [authenticated, batchReady, refreshAll])

  const refreshing = busyPrefix('fish:')

  /** 显示着的卡片（隐藏的不渲染）：记事本固定贴在第一张卡（默认 = 钓鱼信息）下面。 */
  const shownCards = useMemo(() => entries.filter((card) => !card.hidden), [entries])

  const manageable: ManageableCard[] = entries.map((e) => ({
    id: e.key,
    name: e.label,
    command: e.command,
    custom: e.custom,
    manualKey: `fish:${e.key}`,
    defaultManual: e.defaultManual,
    hidden: e.hidden,
  }))

  const headerContent = (
    <TopBarActions>
      {lastRefreshAt && (
        <span
          className="hidden text-2xs text-muted-foreground sm:inline"
          title={formatClockWithDate(lang, lastRefreshAt)}
        >
          {t('home.lastRefresh', { time: formatClock(lang, lastRefreshAt) })}
        </span>
      )}
      <IconAction
        label={refreshing ? t('home.refreshing') : t('home.refreshAll')}
        icon={RefreshCw}
        loading={refreshing}
        disabled={!authenticated || shownCards.length === 0}
        onClick={() => refreshAll(true)}
      />
      <IconAction
        label={t('modules.cards.manage')}
        icon={PlayingCardsFan}
        onClick={() => setManageOpen(true)}
      />
    </TopBarActions>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {headerContent}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
        {shownCards.map((card, index) => (
          <Fragment key={card.key}>
            <CommandCard
              title={card.label}
              icon={card.icon}
              command={card.command}
              result={results[`fish:${card.key}`]}
              loading={busy(`fish:${card.key}`)}
              unavailable={!authenticated}
              collapseKey={`fish:${card.key}`}
              onRefresh={authenticated ? () => runOne(card.key, card.command) : undefined}
              itemsById={dataset?.itemsById}
              prefixesById={dataset?.prefixesById}
              atlas={dataset?.atlas}
            />
            {/* 记事本固定贴在第一张卡（默认就是「钓鱼信息」）下面一行。 */}
            {index === 0 && <FishNotepad serverId={serverId} />}
          </Fragment>
        ))}
        {/* 一张卡都没显示（玩家把「钓鱼信息」也隐藏了）时记事本仍然在。 */}
        {shownCards.length === 0 && <FishNotepad serverId={serverId} />}
      </div>

      <ModuleCardManagerDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        cards={manageable}
        isManual={cardManual}
        onToggleManual={(card, manual) =>
          setAutoExec((prev) => setManual(sanitizeAutoExec(prev), card.manualKey, manual))
        }
        onAdd={(name, cmd) => addCard(name, cmd)}
        onUpdate={(id, patch) => updateCard(id, patch)}
        onRemove={(id) => removeCard(id)}
        // 鱼罐 / 消费榜 / 鱼篓榜默认隐藏，玩家在这里打开「显示」才出现。
        visibility={{ isHidden, onToggle: toggleHidden }}
      />
    </div>
  )
}
