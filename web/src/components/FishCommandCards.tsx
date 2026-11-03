import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FishingHook,
  ListRestart,
  NotebookPen,
  PiggyBank,
  PlayingCardsFan,
  Podium,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { CommandCard } from '@/components/CommandCard'
import { IconAction } from '@/components/IconAction'
import { FishNotepad } from '@/components/fishshop/FishNotepad'
import { ModuleCardManagerDialog, type ManageableCard } from '@/components/ModuleCardManagerDialog'
import { TopBarActions } from '@/components/TopBar'
import { useCardLayout } from '@/hooks/useCardLayout'
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
 * 「钓鱼信息」常显；「鱼罐 / 消费榜 / 鱼篓榜 / 重载配置」默认**不显示、也不自动执行** —— 输出较长或不必常看，
 * 所以交给玩家自己在「管理卡片」里开「显示 / 自动执行」。
 */
/** 重载配置卡片 id：执行成功后鱼店页要重新拉一次货架。 */
const CONFIG_RELOAD_CARD = 'reload'

const CARDS: FishCardDef[] = [
  { id: 'info', titleKey: 'fish.card.info', command: '/fish info', icon: <FishingHook /> },
  {
    id: 'jar',
    titleKey: 'fish.card.jar',
    command: '/fish jar',
    icon: <PiggyBank />,
    defaultHidden: true,
    defaultManual: true,
  },
  {
    id: 'rank',
    titleKey: 'fish.card.rank',
    command: '/fish rank',
    icon: <Podium />,
    defaultHidden: true,
    defaultManual: true,
  },
  {
    id: 'basket',
    titleKey: 'fish.card.basket',
    command: '/fish basket',
    icon: <Podium />,
    defaultHidden: true,
    defaultManual: true,
  },
  // `/fish reload` 重载插件配置，需要 `fishshop.reload` 权限（插件 `FishShop.cs` 的 `case "reload"`）；
  // 普通玩家点了会得到「你无权执行重载操作！」。默认隐藏 + 不自动执行（不刷屏）。
  {
    id: CONFIG_RELOAD_CARD,
    titleKey: 'fish.card.reload',
    command: '/fish reload',
    icon: <ListRestart />,
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
  /**
   * 「重载配置」执行成功后回调：服主改完货架，重载完就该重新拉一次货架，
   * 否则页面上还是旧的价格 / 旧的商品。
   */
  onConfigReloaded?: () => void
  /**
   * 「右列是否还有内容」变化时回调（卡片与记事本全被隐藏 → `false`）。
   * 鱼店页据此把右侧一栏收掉，让左边货架铺满整行。
   */
  onContentChange?: (hasContent: boolean) => void
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
  onConfigReloaded,
  onContentChange,
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
      if (key === CONFIG_RELOAD_CARD && res.status === 'ok') onConfigReloaded?.()
    },
    [transport, onTokenInvalid, setResult, onConfigReloaded],
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
        const reloaded = entries.findIndex((entry) => entry.key === CONFIG_RELOAD_CARD)
        if (reloaded >= 0 && list[reloaded]?.status === 'ok') onConfigReloaded?.()
      } catch (err) {
        const res = resultFromError(err)
        entries.forEach((entry) => setResult(`fish:${entry.key}`, res))
      }
    },
    [transport, onTokenInvalid, setResult, onConfigReloaded],
  )

  // 用户为鱼店追加的指令卡片（存 tswui:moduleCards，模块 id = store）。
  const {
    cards: customCards,
    add: addCard,
    update: updateCard,
    remove: removeCard,
    reset: resetCards,
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
  /** 某张卡片当前是否隐藏；内置卡片按 `defaultHidden` 兜底，记事本 / 自定义卡片默认显示。 */
  const isHidden = useCallback(
    (id: string) => {
      const def = CARDS.find((c) => c.id === id)
      return hiddenMap[id] ?? def?.defaultHidden === true
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
        const def = CARDS.find((c) => c.id === id)
        next[id] = !(next[id] ?? def?.defaultHidden === true)
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
        notepad: false,
      })),
      ...customCards.map((c) => ({
        key: c.id,
        label: c.name || c.command,
        icon: <Terminal /> as ReactNode,
        command: c.command,
        custom: true,
        // 用户添加的卡片默认**不自动执行**。
        defaultManual: true,
        hidden: isHidden(c.id),
        notepad: false,
      })),
      // 记事本也是一张「卡片」：可以排序、可以隐藏，但它没有指令、不参与执行。
      {
        key: 'notepad',
        label: t('fish.notepad'),
        icon: <NotebookPen /> as ReactNode,
        command: '',
        custom: false,
        defaultManual: false,
        hidden: isHidden('notepad'),
        notepad: true,
      },
    ],
    [customCards, t, isHidden],
  )

  // 卡片顺序（含记事本）：鱼店只有右列，所以只排顺序，不排宽度。
  const layoutIds = useMemo(() => entries.map((e) => e.key), [entries])
  const { layout, move, reset: resetLayout } = useCardLayout(serverId, 'store', layoutIds)

  const refreshAll = useCallback(
    (force = false) => {
      // 自动刷新受 2 分钟闸门限制；手动「刷新全部」始终执行。
      const scope = refreshScope(serverId, 'fish')
      if (!force && !isRefreshDue(scope, refreshInterval)) return
      setLastRefreshAt(markRefreshed(scope))
      // 手动刷新连货架一起刷（顶栏只有一个刷新按钮 —— 输入框那边不再重复放一个）。
      if (force) onManualRefresh?.()
      // 只刷新「显示着的 + 自动执行」的卡片（隐藏的 / 手动的只能点卡片自己的按钮）。
      // 只刷新「显示着的 + 自动执行 + 有指令」的卡片（隐藏 / 手动 / 记事本都不跑）。
      const runnable = entries.filter(
        (e) =>
          e.command.trim().length > 0 &&
          !e.hidden &&
          !isManual(autoExec, `fish:${e.key}`, e.defaultManual),
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

  /** 显示着的卡片（隐藏的不渲染），按「管理卡片」里排的顺序。 */
  const shownCards = useMemo(() => {
    const byKey = new Map(entries.map((e) => [e.key, e]))
    return layout.order
      .filter((id) => !isHidden(id))
      .flatMap((id) => {
        const entry = byKey.get(id)
        return entry ? [entry] : []
      })
  }, [entries, layout.order, isHidden])

  // 右列空了（卡片 + 记事本都隐藏）就告诉页面收掉这一栏，左边货架铺满。
  const hasContent = shownCards.length > 0
  useEffect(() => {
    onContentChange?.(hasContent)
  }, [hasContent, onContentChange])

  // 鱼店只有右侧一列，所以宽度只能是「右」；小 / 大 在菜单里置灰。
  const widthOf = useCallback(() => 'right' as const, [])

  const manageable: ManageableCard[] = layout.order.flatMap((id) => {
    const entry = entries.find((e) => e.key === id)
    if (!entry) return []
    return [
      {
        id: entry.key,
        icon: entry.icon,
        name: entry.label,
        command: entry.command,
        custom: entry.custom,
        manualKey: `fish:${entry.key}`,
        defaultManual: entry.defaultManual,
        hidden: entry.hidden,
      },
    ]
  })

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
      {/* `[&>*]:shrink-0`：卡片是这条滚动列的 flex 子项，默认 `flex-shrink: 1` ——
          卡片一多就会被压扁（正文被截断、行与行还叠在一起）。卡片数量不确定，
          所以**每张卡保持自身内容高度**，超出的部分交给整列滚动。 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1 [&>*]:shrink-0">
        {shownCards.map((card) => {
          // 手动执行的卡片：按钮是 ▶「执行」（不是「刷新」），左下角常显「执行于 …」。
          const manual = isManual(autoExec, `fish:${card.key}`, card.defaultManual)
          return card.notepad ? (
            <FishNotepad key={card.key} serverId={serverId} />
          ) : (
            <CommandCard
              key={card.key}
              title={card.label}
              icon={card.icon}
              command={card.command}
              result={results[`fish:${card.key}`]}
              loading={busy(`fish:${card.key}`)}
              unavailable={!authenticated}
              action={manual ? 'run' : 'refresh'}
              emptyText={manual ? t('home.customClickRefresh') : undefined}
              collapseKey={`fish:${card.key}`}
              onRefresh={authenticated ? () => runOne(card.key, card.command) : undefined}
              itemsById={dataset?.itemsById}
              prefixesById={dataset?.prefixesById}
              atlas={dataset?.atlas}
            />
          )
        })}
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
        // 鱼罐 / 消费榜 / 鱼篓榜 / 记事本都可以隐藏，玩家在这里打开「是否显示」才出现。
        visibility={{ isHidden, onToggle: toggleHidden }}
        // 恢复默认：顺序 / 隐藏回到内置默认，并清掉自己加的卡片。
        onReset={() => {
          resetLayout()
          setRawHidden({})
          resetCards()
        }}
        ordering={{ onMove: (id, delta) => move(id, delta) }}
        width={{ get: widthOf, set: () => {}, disabled: ['half', 'full'] }}
      />
    </div>
  )
}
