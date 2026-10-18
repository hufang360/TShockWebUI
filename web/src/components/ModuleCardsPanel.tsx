import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Settings2 } from 'lucide-react'
import { CommandCard } from '@/components/CommandCard'
import { ModuleCardManagerDialog, type ManageableCard } from '@/components/ModuleCardManagerDialog'
import { Button, Spinner } from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { DEFAULT_AUTO_EXEC, isManual, sanitizeAutoExec, setManual } from '@/lib/autoExec'
import { useCommandResults } from '@/lib/commandResults'
import { useExecutionQueue } from '@/lib/executionQueue'
import { useI18n } from '@/lib/i18n'
import { isRefreshDue, lastRefreshedAt, markRefreshed, refreshScope } from '@/lib/refreshGate'
import { StorageKeys } from '@/lib/storage'
import { resultFromError, TshockRequestError, type BackendTransport } from '@/lib/tshock'
import type { CommandResult, Dataset } from '@/types'

export interface PanelCard {
  id: string
  name: string
  command: string
  /** 用户添加的卡片（可删除）。 */
  custom?: boolean
  /** 自动执行偏好 key（tswui:autoExec）。 */
  manualKey: string
  /** 未设置偏好时的默认值（true = 默认手动）。 */
  defaultManual?: boolean
}

interface ModuleCardsPanelProps {
  dataset: Dataset | null
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  refreshInterval: number
  onTokenInvalid: () => Promise<boolean>
  /** 结果 key 前缀（如 `world:` / `m:<id>:`）。 */
  keyPrefix: string
  title: string
  cards: PanelCard[]
  /** 允许「管理卡片」时提供。 */
  onAddCard?: (name: string, command: string) => void
  onUpdateCard?: (id: string, patch: { name?: string; command?: string }) => void
  onRemoveCard?: (id: string) => void
}

/**
 * 模块「指令卡片」面板：统一执行、逐条刷新、批量执行、按间隔自动刷新。
 * 支持「管理卡片」（同首页交互）：自动执行开关 / 添加 / 删除。
 */
export function ModuleCardsPanel({
  dataset,
  transport,
  authenticated,
  serverId,
  refreshInterval,
  onTokenInvalid,
  keyPrefix,
  title,
  cards,
  onAddCard,
  onUpdateCard,
  onRemoveCard,
}: ModuleCardsPanelProps) {
  const { t } = useI18n()
  const { enqueue, busy, busyPrefix } = useExecutionQueue()
  const { results, setResult } = useCommandResults()
  const [batchMode] = useLocalState(StorageKeys.homeBatch, false)
  const [batchPlugin, setBatchPlugin] = useState<boolean | null>(null)
  const [rawAutoExec, setAutoExec] = useLocalState(StorageKeys.autoExec, DEFAULT_AUTO_EXEC)
  const autoExec = useMemo(() => sanitizeAutoExec(rawAutoExec), [rawAutoExec])
  const [manageOpen, setManageOpen] = useState(false)

  const scope = refreshScope(serverId, `panel:${keyPrefix}`)
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(() => lastRefreshedAt(scope))
  useEffect(() => {
    setLastRefreshAt(lastRefreshedAt(scope))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, keyPrefix])

  const cardManual = useCallback(
    (card: PanelCard) => isManual(autoExec, card.manualKey, card.defaultManual === true),
    [autoExec],
  )
  const toggleManual = (card: PanelCard, manual: boolean) =>
    setAutoExec((prev) => setManual(sanitizeAutoExec(prev), card.manualKey, manual))

  // 探测批量执行信使插件（跟随服务器）。
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

  const resultKey = (id: string) => `${keyPrefix}${id}`

  const runOne = useCallback(
    async (card: PanelCard) => {
      const run = async (): Promise<CommandResult> => {
        try {
          return await transport.runCommand(card.command)
        } catch (err) {
          return resultFromError(err)
        }
      }
      let res = await run()
      if (res.status === 'token_invalid') {
        const reauthed = await onTokenInvalid()
        if (reauthed) res = await run()
      }
      setResult(resultKey(card.id), res)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transport, onTokenInvalid, setResult, keyPrefix],
  )

  const runBatch = useCallback(
    async (list: PanelCard[]) => {
      const run = async (): Promise<CommandResult[]> => {
        try {
          return await transport.runBatch(list.map((c) => c.command))
        } catch (err) {
          if (err instanceof TshockRequestError && (err.kind === 'token' || err.kind === 'auth')) {
            const reauthed = await onTokenInvalid()
            if (reauthed) return await transport.runBatch(list.map((c) => c.command))
          }
          throw err
        }
      }
      try {
        const out = await run()
        list.forEach((c, i) => {
          setResult(resultKey(c.id), out[i] ?? { status: 'bad_response', output: [], message: '' })
        })
      } catch (err) {
        const res = resultFromError(err)
        list.forEach((c) => setResult(resultKey(c.id), res))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transport, onTokenInvalid, setResult, keyPrefix],
  )

  // 只有「自动执行」的卡片参与自动刷新 / 刷新全部（手动卡片只能点自己的按钮）。
  const runnable = useMemo(
    () => cards.filter((c) => c.command.trim().length > 0 && !cardManual(c)),
    [cards, cardManual],
  )

  const refreshAll = useCallback(
    (force = false) => {
      if (!force && !isRefreshDue(scope, refreshInterval)) return
      setLastRefreshAt(markRefreshed(scope))
      if (batchMode && batchPlugin === true) {
        enqueue({
          key: `${keyPrefix}__batch__`,
          labelKey: 'home.batch',
          label: 'home.batch',
          command: runnable.map((c) => c.command).join('  '),
          run: () => runBatch(runnable),
        })
        return
      }
      for (const card of runnable) {
        enqueue({
          key: resultKey(card.id),
          label: card.name || card.command,
          command: card.command,
          run: () => runOne(card),
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, refreshInterval, batchMode, batchPlugin, enqueue, runBatch, runOne, keyPrefix, runnable],
  )

  const batchReady = !batchMode || batchPlugin !== null
  useEffect(() => {
    if (!authenticated || !batchReady) return
    refreshAll(false)
  }, [authenticated, batchReady, refreshAll])

  const refreshing = busyPrefix(keyPrefix)
  const manageable: ManageableCard[] = cards.map((c) => ({
    id: c.id,
    name: c.name,
    command: c.command,
    custom: c.custom === true,
    manualKey: c.manualKey,
    defaultManual: c.defaultManual,
  }))

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-2">
          {lastRefreshAt && (
            <span
              className="text-[11px] text-muted-foreground"
              title={new Date(lastRefreshAt).toLocaleString()}
            >
              {t('home.lastRefresh', { time: new Date(lastRefreshAt).toLocaleTimeString() })}
            </span>
          )}
          {onAddCard && (
            <Button size="sm" variant="ghost" onClick={() => setManageOpen(true)}>
              <Settings2 data-icon="inline-start" />
              {t('modules.cards.manage')}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => refreshAll(true)}
            disabled={!authenticated || refreshing || runnable.length === 0}
          >
            {refreshing ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {refreshing ? t('home.refreshing') : t('home.refreshAll')}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {cards.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('modules.cards.empty')}</p>
        ) : (
          cards.map((card) => (
            <CommandCard
              key={card.id}
              title={card.name || card.command}
              command={card.command}
              result={results[resultKey(card.id)]}
              loading={busy(resultKey(card.id))}
              unavailable={!authenticated}
              action={cardManual(card) ? 'run' : 'refresh'}
              collapseKey={resultKey(card.id)}
              onRefresh={authenticated ? () => void runOne(card) : undefined}
              itemsById={dataset?.itemsById}
              prefixesById={dataset?.prefixesById}
              atlas={dataset?.atlas}
            />
          ))
        )}
      </div>

      {onAddCard && (
        <ModuleCardManagerDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          cards={manageable}
          isManual={cardManual}
          onToggleManual={toggleManual}
          onAdd={onAddCard}
          onUpdate={onUpdateCard ?? (() => {})}
          onRemove={onRemoveCard ?? (() => {})}
        />
      )}
    </div>
  )
}
