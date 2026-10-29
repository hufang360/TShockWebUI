import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Settings2 } from 'lucide-react'
import { CommandCard } from '@/components/CommandCard'
import { IconAction } from '@/components/IconAction'
import { InfoPopover } from '@/components/InfoPopover'
import { ModuleCardManagerDialog, type ManageableCard } from '@/components/ModuleCardManagerDialog'
import { Notice } from '@/components/Notice'
import { TopBarActions } from '@/components/TopBar'
import { Button, Empty, EmptyDescription, Spinner } from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { DEFAULT_AUTO_EXEC, isManual, sanitizeAutoExec, setManual } from '@/lib/autoExec'
import { useCommandResults } from '@/lib/commandResults'
import { useExecutionQueue } from '@/lib/executionQueue'
import { useI18n } from '@/lib/i18n'
import { formatClock, formatClockWithDate } from '@/lib/clock'

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
  /** 固定卡片（来自依赖插件，不可删除）。 */
  fixed?: boolean
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
  desc?: string
  cards: PanelCard[]
  /** 允许「管理卡片」时提供。 */
  onAddCard?: (name: string, command: string) => void
  onUpdateCard?: (id: string, patch: { name?: string; command?: string }) => void
  onRemoveCard?: (id: string) => void
  /**
   * 固定卡片依赖的第三方插件名（如 `WorldModify`）。
   * 任一固定卡片执行返回「指令不存在」即判定插件未安装（`no_permission` 不算）。
   */
  pluginName?: string
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
  desc,
  cards,
  onAddCard,
  onUpdateCard,
  onRemoveCard,
  pluginName,
}: ModuleCardsPanelProps) {
  const { t, lang } = useI18n()
  const { enqueue, busy, busyPrefix } = useExecutionQueue()
  const { results, setResult, clearResult } = useCommandResults()
  const [batchMode] = useLocalState(StorageKeys.homeBatch, false)
  const [batchPlugin, setBatchPlugin] = useState<boolean | null>(null)
  const [rawAutoExec, setAutoExec] = useLocalState(StorageKeys.autoExec, DEFAULT_AUTO_EXEC)
  const autoExec = useMemo(() => sanitizeAutoExec(rawAutoExec), [rawAutoExec])
  const [manageOpen, setManageOpen] = useState(false)
  /** 「重新检测」正在跑（不在执行队列里，避免占队列条目）。 */
  const [probing, setProbing] = useState(false)

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
    async (card: PanelCard): Promise<CommandResult> => {
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
      return res
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

  /**
   * 固定卡片都由同一个插件提供：用第一张固定卡片（只读的 `/wi`）做探测 ——
   * 返回「指令不存在」即判定插件未安装。不用全部固定卡片判定，否则「重新检测」只跑一条时，
   * 其余卡片的历史失败结果会让提示一直消不掉。
   * `no_permission` 不算：TShock 先查指令再查权限（`Commands.HandleCommand`），
   * 所以「有指令但没权限」会返回权限不足，只有插件没装才会「指令不存在」。
   */
  const probeCard = useMemo(
    () => cards.find((c) => c.fixed === true && c.command.trim().length > 0),
    [cards],
  )
  const pluginMissing = Boolean(
    pluginName &&
      probeCard &&
      results[`${keyPrefix}${probeCard.id}`]?.status === 'command_not_found',
  )
  /** 插件没装时，所有固定卡片都换成「插件未安装」（它们的指令来自同一个插件）。 */
  const missingFixedIds = useMemo(
    () => new Set(pluginMissing ? cards.filter((c) => c.fixed === true).map((c) => c.id) : []),
    [cards, pluginMissing],
  )

  /** 「重新检测」：重跑探测指令；成功后顺手清掉其余固定卡片上次的「指令不存在」结果。 */
  const recheckPlugin = async () => {
    if (!probeCard || probing) return
    setProbing(true)
    try {
      const res = await runOne(probeCard)
      if (res.status === 'command_not_found') return
      for (const c of cards) {
        if (c.fixed !== true || c.id === probeCard.id) continue
        if (results[`${keyPrefix}${c.id}`]?.status !== 'command_not_found') continue
        clearResult(`${keyPrefix}${c.id}`)
      }
    } finally {
      setProbing(false)
    }
  }

  const refreshAll = useCallback(
    (force = false) => {
      if (!force && !isRefreshDue(scope, refreshInterval)) return
      setLastRefreshAt(markRefreshed(scope))
      // 已判定缺插件的固定卡片不参与自动 / 批量刷新（避免每次白跑必失败的指令）；
      // 手动「刷新全部」（force）仍会重跑，装上插件后点一下就能恢复。
      const targets = force
        ? runnable
        : runnable.filter((c) => !(pluginMissing && c.fixed === true))
      if (targets.length === 0) return
      if (batchMode && batchPlugin === true) {
        enqueue({
          key: `${keyPrefix}__batch__`,
          labelKey: 'home.batch',
          label: 'home.batch',
          command: targets.map((c) => c.command).join('  '),
          run: () => runBatch(targets),
        })
        return
      }
      for (const card of targets) {
        enqueue({
          key: resultKey(card.id),
          label: card.name || card.command,
          command: card.command,
          run: async () => {
            await runOne(card)
          },
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      scope,
      refreshInterval,
      batchMode,
      batchPlugin,
      enqueue,
      runBatch,
      runOne,
      keyPrefix,
      runnable,
      pluginMissing,
    ],
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
    <div className="flex min-h-0 flex-col gap-2">
      <TopBarActions
        info={
          desc ? (
            <InfoPopover label={t('home.pageInfo')} title={title}>
              {desc}
            </InfoPopover>
          ) : undefined
        }
      >
        {lastRefreshAt && (
          <span
            className="hidden text-2xs text-muted-foreground tabular-nums sm:inline"
            title={formatClockWithDate(lang, lastRefreshAt)}
          >
            {t('home.lastRefresh', { time: formatClock(lang, lastRefreshAt) })}
          </span>
        )}
        <IconAction
          label={refreshing ? t('home.refreshing') : t('home.refreshAll')}
          icon={RefreshCw}
          loading={refreshing}
          disabled={!authenticated || runnable.length === 0}
          onClick={() => refreshAll(true)}
        />
        {onAddCard && (
          <IconAction
            label={t('modules.cards.manage')}
            icon={Settings2}
            onClick={() => setManageOpen(true)}
          />
        )}
      </TopBarActions>

      {pluginName && pluginMissing && (
        <Notice
          icon={<AlertTriangle />}
          title={t('panel.pluginMissing', { name: pluginName })}
          action={
            <Button
              size="sm"
              variant="outline"
              className="bg-card"
              disabled={!authenticated || !probeCard || probing}
              onClick={() => void recheckPlugin()}
            >
              {probing ? (
                <Spinner aria-hidden data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {t('modules.recheck')}
            </Button>
          }
        >
          {t('panel.pluginMissingHint', { name: pluginName })}
        </Notice>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {cards.length === 0 ? (
          <Empty size="sm">
            <EmptyDescription>{t('modules.cards.empty')}</EmptyDescription>
          </Empty>
        ) : (
          cards.map((card) => (
            <CommandCard
              key={card.id}
              title={card.name || card.command}
              command={card.command}
              result={results[resultKey(card.id)]}
              loading={busy(resultKey(card.id))}
              unavailable={!authenticated || missingFixedIds.has(card.id)}
              unavailableText={missingFixedIds.has(card.id) ? t('panel.pluginMissingCard') : undefined}
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
          pluginMissing={(id) => missingFixedIds.has(id)}
        />
      )}
    </div>
  )
}
