import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Fish, RefreshCw, Settings2, Terminal } from 'lucide-react'
import { CommandCard } from '@/components/CommandCard'
import { IconAction } from '@/components/IconAction'
import { ModuleCardManagerDialog, type ManageableCard } from '@/components/ModuleCardManagerDialog'
import { TopBarActions } from '@/components/TopBar'
import { useLocalState } from '@/hooks/useLocalState'
import { useModuleCards } from '@/hooks/useModuleCards'
import { DEFAULT_AUTO_EXEC, isManual, sanitizeAutoExec, setManual } from '@/lib/autoExec'
import { useCommandResults } from '@/lib/commandResults'
import { useExecutionQueue } from '@/lib/executionQueue'
import { useI18n } from '@/lib/i18n'
import { isRefreshDue, lastRefreshedAt, markRefreshed, refreshScope } from '@/lib/refreshGate'
import { StorageKeys } from '@/lib/storage'
import { resultFromError, TshockRequestError, type BackendTransport } from '@/lib/tshock'
import type { CommandResult, Dataset } from '@/types'

interface FishCardDef {
  id: string
  titleKey: string
  command: string
  icon: ReactNode
}

/**
 * 鱼店指令卡片：只保留「钓鱼信息」（`/fish info`）。
 *
 * 它的数据没有 REST 端点，只能靠 rawcmd 取回（且不依赖鱼店 REST，老插件也能用）。
 * 货架 / 鱼罐 / 消费榜 / 鱼篓榜的卡片已移除：货架走 REST，其余不再作为网页入口。
 */
const CARDS: FishCardDef[] = [
  { id: 'info', titleKey: 'fish.card.info', command: '/fish info', icon: <Fish /> },
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
}: FishCommandCardsProps) {
  const { t } = useI18n()
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

  const entries = useMemo(
    () => [
      ...CARDS.map((c) => ({
        key: c.id,
        label: t(c.titleKey),
        icon: c.icon as ReactNode,
        command: c.command,
        custom: false,
      })),
      ...customCards.map((c) => ({
        key: c.id,
        label: c.name || c.command,
        icon: <Terminal /> as ReactNode,
        command: c.command,
        custom: true,
      })),
    ],
    [customCards, t],
  )

  const refreshAll = useCallback(
    (force = false) => {
      // 自动刷新受 2 分钟闸门限制；手动「刷新全部」始终执行。
      const scope = refreshScope(serverId, 'fish')
      if (!force && !isRefreshDue(scope, refreshInterval)) return
      setLastRefreshAt(markRefreshed(scope))
      // 只刷新「自动执行」的卡片（手动卡片只能点自己的按钮）。
      const runnable = entries.filter((e) => !isManual(autoExec, `fish:${e.key}`))
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
    [autoExec, batchMode, batchPlugin, entries, enqueue, runBatchEntries, runOne, serverId, refreshInterval],
  )

  // 进入鱼店页自动刷新一次（受 2 分钟闸门限制）；批量插件可用性未探测完先等一等。
  const batchReady = !batchMode || batchPlugin !== null
  useEffect(() => {
    if (!authenticated || !batchReady) return
    refreshAll(false)
  }, [authenticated, batchReady, refreshAll])

  const refreshing = busyPrefix('fish:')

  const manageable: ManageableCard[] = entries.map((e) => ({
    id: e.key,
    name: e.label,
    command: e.command,
    custom: e.custom,
    manualKey: `fish:${e.key}`,
    defaultManual: false,
  }))

  const headerContent = (
    <TopBarActions>
      {lastRefreshAt && (
        <span
          className="hidden text-2xs text-muted-foreground sm:inline"
          title={new Date(lastRefreshAt).toLocaleString()}
        >
          {t('home.lastRefresh', { time: new Date(lastRefreshAt).toLocaleTimeString() })}
        </span>
      )}
      <IconAction
        label={refreshing ? t('home.refreshing') : t('home.refreshAll')}
        icon={RefreshCw}
        loading={refreshing}
        disabled={!authenticated || entries.length === 0}
        onClick={() => refreshAll(true)}
      />
      <IconAction
        label={t('modules.cards.manage')}
        icon={Settings2}
        onClick={() => setManageOpen(true)}
      />
    </TopBarActions>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {headerContent}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
        {entries.map((card) => (
          <div key={card.key} className="relative">
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
          </div>
        ))}
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
      />
    </div>
  )
}
