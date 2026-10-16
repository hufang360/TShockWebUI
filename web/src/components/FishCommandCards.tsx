import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Fish, Package, Plus, RefreshCw, ShoppingBasket, Terminal, Trash2, Trophy } from 'lucide-react'
import { CommandCard } from '@/components/CommandCard'
import { Button, Field, FieldLabel, Input, Spinner } from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { useModuleCards } from '@/hooks/useModuleCards'
import { useCommandResults } from '@/lib/commandResults'
import { useExecutionQueue } from '@/lib/executionQueue'
import { normalizeCustomCommand } from '@/lib/homeCards'
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

/** 鱼店指令卡片：这些指令即使鱼店插件没开 REST API 也能执行（走 rawcmd）。 */
const CARDS: FishCardDef[] = [
  { id: 'info', titleKey: 'fish.card.info', command: '/fish info', icon: <Fish /> },
  { id: 'jar', titleKey: 'fish.card.jar', command: '/fish jar', icon: <Package /> },
  { id: 'rank', titleKey: 'fish.card.rank', command: '/fish rank', icon: <Trophy /> },
  { id: 'basket', titleKey: 'fish.card.basket', command: '/fish basket', icon: <ShoppingBasket /> },
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
 * 鱼店右侧「指令卡片」列：钓鱼信息 / 鱼罐 / 消费榜 / 鱼篓榜。
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
  const { cards: customCards, add: addCard, remove: removeCard } = useModuleCards(serverId, 'store')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')

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
      if (batchMode && batchPlugin === true) {
        enqueue({
          key: 'fish:__batch__',
          labelKey: 'home.batch',
          label: 'home.batch',
          command: entries.map((e) => e.command).join('  '),
          run: () => runBatchEntries(entries),
        })
        return
      }
      for (const e of entries) {
        enqueue({
          key: `fish:${e.key}`,
          label: e.label,
          command: e.command,
          run: () => runOne(e.key, e.command),
        })
      }
    },
    [batchMode, batchPlugin, entries, enqueue, runBatchEntries, runOne, serverId, refreshInterval],
  )

  // 进入鱼店页自动刷新一次（受 2 分钟闸门限制）；批量插件可用性未探测完先等一等。
  const batchReady = !batchMode || batchPlugin !== null
  useEffect(() => {
    if (!authenticated || !batchReady) return
    refreshAll(false)
  }, [authenticated, batchReady, refreshAll])

  const refreshing = busyPrefix('fish:')

  const submitAdd = () => {
    const cmd = normalizeCustomCommand(newCommand)
    if (!cmd) return
    addCard(newName.trim(), cmd)
    setNewName('')
    setNewCommand('')
    setAdding(false)
  }

  return (
    // `xl:contents`：xl 下本组件的表头与卡片列表脱离包裹层，直接成为鱼店页两列网格的
    // 「第 1 行右格 / 第 2 行右格」，从而与左列页头 / 内容共行对齐（见 docs/插件-鱼店.md）。
    <div className="flex h-full min-h-0 flex-col gap-4 xl:contents">
      <div className="flex shrink-0 items-center justify-between gap-2 xl:col-start-2 xl:row-start-1">
        <h3 className="text-sm font-semibold text-foreground">{t('fish.cards')}</h3>
        <div className="flex items-center gap-2">
          {lastRefreshAt && (
            <span
              className="text-[11px] text-muted-foreground"
              title={new Date(lastRefreshAt).toLocaleString()}
            >
              {t('home.lastRefresh', { time: new Date(lastRefreshAt).toLocaleTimeString() })}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)}>
            <Plus data-icon="inline-start" />
            {t('modules.cards.add')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => refreshAll(true)}
            disabled={!authenticated || refreshing}
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
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1 xl:col-start-2 xl:row-start-2 xl:min-h-0">
        {adding && (
          <div className="flex flex-col gap-2 rounded-xl bg-accent/40 p-3 sm:flex-row sm:items-end">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="fish-card-name">{t('modules.cards.name')}</FieldLabel>
              <Input
                id="fish-card-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('modules.cards.namePlaceholder')}
                className="h-8 text-xs"
              />
            </Field>
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="fish-card-command">{t('modules.cards.command')}</FieldLabel>
              <Input
                id="fish-card-command"
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd()
                }}
                placeholder={t('modules.cards.commandPlaceholder')}
                className="h-8 font-pixel text-xs"
              />
            </Field>
            <Button size="sm" variant="primary" onClick={submitAdd}>
              <Plus data-icon="inline-start" />
              {t('modules.cards.create')}
            </Button>
          </div>
        )}
        {entries.map((card) => (
          <div key={card.key} className="relative">
          <CommandCard
            title={card.label}
            icon={card.icon}
            command={card.command}
            result={results[`fish:${card.key}`]}
            loading={busy(`fish:${card.key}`)}
            unavailable={!authenticated}
            onRefresh={authenticated ? () => runOne(card.key, card.command) : undefined}
            itemsById={dataset?.itemsById}
            prefixesById={dataset?.prefixesById}
            atlas={dataset?.atlas}
          />
            {card.custom && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="absolute top-2 right-11"
                aria-label={t('modules.cards.remove')}
                title={t('modules.cards.remove')}
                onClick={() => removeCard(card.key)}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
