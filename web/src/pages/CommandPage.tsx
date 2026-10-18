import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Activity, BookOpen, History, Package, ShoppingBasket, Star } from 'lucide-react'
import { BatchDeleteControls } from '@/components/BatchDeleteControls'
import { CollapseChevron } from '@/components/CollapseChevron'
import { CommandEditor } from '@/components/CommandEditor'
import { CommandPickerPanel } from '@/components/CommandPickerPanel'
import { ConfirmButton } from '@/components/ConfirmButton'
import { ItemSearchPanel } from '@/components/ItemSearchPanel'
import { LoginGate } from '@/components/LoginGate'
import { ResultPanel, STATUS_TONE, type ResultEntry } from '@/components/ResultPanel'
import { SelectIndicator } from '@/components/SelectIndicator'
import { ServerFeedTab } from '@/components/ServerFeed'
import { SearchInput } from '@/components/SearchInput'
import { TagAssist } from '@/components/TagAssist'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useBatchSelect } from '@/hooks/useBatchSelect'
import { useLocalState } from '@/hooks/useLocalState'
import { inspectCommand, type CommandCheck } from '@/lib/commands'
import { computeCompletions, paramHintFor } from '@/lib/completion'
import type { CompletionItem } from '@/lib/completion'
import { addFavorite, isFavorited, removeFavorite as removeFavoriteEntry, sanitizeFavorites } from '@/lib/favorites'
import { HISTORY_LIMIT, sanitizeHistory } from '@/lib/history'
import { addItemFavorite, isItemFavorited, removeItemFavorite, sanitizeItemFavorites } from '@/lib/itemFavorites'
import { ItemFavoritesProvider, type ItemFavoritesApi } from '@/lib/itemFavoritesContext'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import { resultFromError, type BackendTransport } from '@/lib/tshock'
import type {
  CommandResult,
  CommandStatus,
  Dataset,
  FavoriteEntry,
  HistoryEntry,
  ItemFavorite,
  Settings,
} from '@/types'

/** 结果卡片保留最近 N 条（更早的自动丢弃）。 */
const RESULT_LIMIT = 20

/** 从本机恢复结果卡片：丢弃非法项，只保留合法的 output / status。 */
function sanitizeResults(value: unknown): ResultEntry[] {
  if (!Array.isArray(value)) return []
  const out: ResultEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const seq = (raw as { seq?: unknown }).seq
    const command = (raw as { command?: unknown }).command
    const result = (raw as { result?: unknown }).result
    if (typeof seq !== 'number' || typeof command !== 'string') continue
    if (!result || typeof result !== 'object') continue
    const r = result as Record<string, unknown>
    if (typeof r.status !== 'string') continue
    const output = Array.isArray(r.output)
      ? r.output.filter((line): line is string => typeof line === 'string')
      : []
    const ts = (raw as { ts?: unknown }).ts
    const collapsed = (raw as { collapsed?: unknown }).collapsed
    out.push({
      seq,
      ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now(),
      command,
      collapsed: collapsed === true,
      result: {
        status: r.status as CommandStatus,
        output,
        message: typeof r.message === 'string' ? r.message : undefined,
      },
    })
  }
  return out.slice(-RESULT_LIMIT)
}

interface CommandPageProps {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  settings: Settings
  /** 当前 TShock 上游 id；右侧「动态」tab 切换服务器后需重新拉取。 */
  serverId: string
  players: string[]
  /** 是否允许执行 allowServer=false 的指令（走插件真实玩家模式）。 */
  ingameAllowed: boolean
  /** 运行时补全数据（区域 / 传送点，来自信使插件 /api/data）。 */
  runtimeValues?: { regions?: string[]; warps?: string[] }
  /** token 失效时被调用；返回 Promise，登录成功 resolve(true)，取消 resolve(false)。 */
  onTokenInvalid: () => Promise<boolean>
  /** 未登录时点「登录」打开登录框。 */
  onLogin: () => void
  /** 前往物品图鉴并显示该物品。 */
  onOpenInDex?: (itemId: number) => void
}

type T = (key: string, vars?: Record<string, string | number>) => string
type SidebarTab = 'items' | 'commands' | 'favorites' | 'history' | 'events'

function rejectedMessage(check: CommandCheck, t: T): string {
  if (check.reason === 'empty') return t('reason.empty')
  if (check.reason === 'unverified') return t('reason.unverified', { token: check.parsed?.token ?? '' })
  if (check.reason === 'in_game_only') {
    return t('reason.inGameOnly', { name: check.def?.name ?? check.parsed?.token ?? '' })
  }
  return check.message
}

export function CommandPage({
  dataset,
  transport,
  authenticated,
  settings,
  serverId,
  players,
  ingameAllowed,
  runtimeValues,
  onTokenInvalid,
  onLogin,
  onOpenInDex,
}: CommandPageProps) {
  const { t } = useI18n()
  const [text, setText] = useLocalState(StorageKeys.draft, '')
  const [rawHistory, setRawHistory] = useLocalState<HistoryEntry[]>(StorageKeys.history, [])
  const history = useMemo(() => sanitizeHistory(rawHistory), [rawHistory])
  // 最近几条结果卡片（含输出内容）存本机，刷新后仍在；**按服务器分开**（不同服务器结果不一样）。
  const [rawResultsByServer, setRawResultsByServer] = useLocalState<Record<string, ResultEntry[]>>(
    StorageKeys.commandResults,
    {},
  )
  const results = useMemo(
    () => sanitizeResults(rawResultsByServer[serverId]),
    [rawResultsByServer, serverId],
  )
  /** 更新当前服务器的结果列表（每次都做一次 sanitize）。 */
  const setResults = useCallback(
    (updater: (prev: ResultEntry[]) => ResultEntry[]) => {
      setRawResultsByServer((prev) => ({
        ...prev,
        [serverId]: updater(sanitizeResults(prev[serverId])),
      }))
    },
    [serverId, setRawResultsByServer],
  )
  const [running, setRunning] = useState(false)
  // 记忆右侧当前 tab（刷新 / 切页后保持）。
  const [tab, setTab] = useLocalState<SidebarTab>(StorageKeys.commandTab, 'items')
  // 右栏整列可折叠。
  const [panelOpen, setPanelOpen] = useState(true)
  const [insertRequest, setInsertRequest] = useState<{ token: number; text: string } | null>(null)
  const insertSeq = useRef(0)
  // 递增令牌：让指令输入框重新聚焦并把光标移到末尾（载入指令 / 历史时）。
  const [focusSeq, setFocusSeq] = useState(0)
  const focusEnd = useCallback(() => setFocusSeq((n) => n + 1), [])
  // 左列至少铺满 main 的可见高度：输入框是 sticky bottom-0，只有容器真正到屏幕底部，
  // 它才会贴在底部，而不是停在结果卡片下方的屏幕中间（图鉴页同款量法）。
  const rootRef = useRef<HTMLDivElement>(null)
  const [fillHeight, setFillHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = rootRef.current
    const scroller = el?.closest('main')
    if (!el || !(scroller instanceof HTMLElement)) return
    const measure = () => {
      const box = scroller.getBoundingClientRect()
      const top = el.getBoundingClientRect().top - box.top + scroller.scrollTop
      // 内容区外层（AppShell 的 p-3 / md:p-6 包裹层）的底边距。
      let wrap: HTMLElement | null = el
      while (wrap && wrap.parentElement !== scroller) wrap = wrap.parentElement
      const padBottom = wrap ? Number.parseFloat(getComputedStyle(wrap).paddingBottom) || 0 : 0
      setFillHeight(Math.max(280, Math.round(scroller.clientHeight - top - padBottom)))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(scroller)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
    // 依赖 authenticated：未登录时先渲染 LoginGate，rootRef 尚未挂载；登录后需重新量高。
  }, [authenticated])

  const check = useMemo(() => inspectCommand(text, dataset), [text, dataset])

  // 收藏指令（tswui:favorites）：收藏 tab 展示、结果卡片星标增删。
  const [rawFavorites, setRawFavorites] = useLocalState<FavoriteEntry[]>(StorageKeys.favorites, [])
  const favorites = useMemo(() => sanitizeFavorites(rawFavorites), [rawFavorites])

  const removeFavorite = useCallback(
    (cmd: string) => {
      setRawFavorites((prev) => sanitizeFavorites(prev).filter((f) => f.cmd !== cmd))
    },
    [setRawFavorites],
  )

  /** 收藏 / 取消收藏任意一条已执行成功的指令（结果卡片用）。 */
  const toggleFavoriteCommand = useCallback(
    (cmd: string) => {
      setRawFavorites((prev) => {
        const clean = sanitizeFavorites(prev)
        return isFavorited(clean, cmd) ? removeFavoriteEntry(clean, cmd) : addFavorite(clean, cmd)
      })
    },
    [setRawFavorites],
  )
  const isFavorite = useCallback((cmd: string) => isFavorited(favorites, cmd), [favorites])

  // 物品收藏（图鉴里收藏的物品，在本模块「收藏」tab 展示）。
  const [rawItemFavs, setRawItemFavs] = useLocalState<ItemFavorite[]>(
    StorageKeys.itemFavorites,
    [],
  )
  const itemFavorites = useMemo(() => sanitizeItemFavorites(rawItemFavs), [rawItemFavs])
  const removeItemFav = useCallback(
    (id: number) => {
      setRawItemFavs((prev) => removeItemFavorite(sanitizeItemFavorites(prev), id))
    },
    [setRawItemFavs],
  )
  const toggleItemFav = useCallback(
    (id: number) => {
      setRawItemFavs((prev) => {
        const clean = sanitizeItemFavorites(prev)
        return isItemFavorited(clean, id) ? removeItemFavorite(clean, id) : addItemFavorite(clean, id)
      })
    },
    [setRawItemFavs],
  )
  const clearFavorites = useCallback(() => {
    setRawFavorites([])
    setRawItemFavs([])
  }, [setRawFavorites, setRawItemFavs])
  const favoritesApi = useMemo<ItemFavoritesApi>(
    () => ({
      isFavorited: (id) => isItemFavorited(itemFavorites, id),
      toggle: toggleItemFav,
    }),
    [itemFavorites, toggleItemFav],
  )

  const getCompletions = useCallback(
    (value: string, caret: number): CompletionItem[] =>
      computeCompletions({ dataset, text: value, caret, players, lang: settings.language, runtimeValues }),
    [dataset, players, settings.language, runtimeValues],
  )

  // 当前参数的用法串（TShock 源码原文），显示在编辑器下方（参数提示）。
  const getParamHint = useCallback(
    (value: string, caret: number) => paramHintFor(dataset, value, caret, settings.language),
    [dataset, settings.language],
  )

  const pushHistory = useCallback(
    (entry: HistoryEntry) => {
      setRawHistory((prev) => [entry, ...sanitizeHistory(prev)].slice(0, HISTORY_LIMIT))
    },
    [setRawHistory],
  )

  /** 追加一条执行结果（不覆盖上次），最多保留 RESULT_LIMIT 条；seq 接着当前服务器已有结果。 */
  const appendResult = useCallback(
    (command: string, result: CommandResult) => {
      setResults((prev) => {
        const seq = (prev.length ? Math.max(...prev.map((e) => e.seq)) : 0) + 1
        const entry: ResultEntry = { seq, ts: Date.now(), command, result }
        return [...prev, entry].slice(-RESULT_LIMIT)
      })
    },
    [setResults],
  )

  const removeResult = useCallback(
    (seq: number) => {
      setResults((prev) => prev.filter((e) => e.seq !== seq))
    },
    [setResults],
  )

  /** 记忆某条结果卡片的折叠状态（切换模块回来时仍保持）。 */
  const toggleResultCollapse = useCallback(
    (seq: number, collapsed: boolean) => {
      setResults((prev) => prev.map((e) => (e.seq === seq ? { ...e, collapsed } : e)))
    },
    [setResults],
  )

  /** 执行任意指令文本（收藏 / 首页等入口复用），追加结果卡片与历史。 */
  const runCommandText = useCallback(
    async (cmd: string) => {
      const inspected = inspectCommand(cmd, dataset)
      if (!inspected.parsed) {
        appendResult(inspected.normalized || '—', {
          status: 'rejected',
          output: [],
          message: t('reason.empty'),
        })
        return
      }
      if (inspected.executability === 'in_game_only' && !ingameAllowed) {
        const message = rejectedMessage(inspected, t)
        appendResult(inspected.normalized, { status: 'rejected', output: [], message })
        pushHistory({ cmd: inspected.normalized, ts: Date.now(), ok: false, status: 'rejected' })
        return
      }
      if (!authenticated) {
        appendResult(inspected.normalized, {
          status: 'rejected',
          output: [],
          message: t('editor.notLoggedIn'),
        })
        return
      }
      setRunning(true)
      const runOnce = async (): Promise<CommandResult> => {
        try {
          // allowServer=false 的指令走插件「真实在线玩家」模式；其余走 rawcmd。
          return await transport.runCommand(inspected.normalized, inspected.executability === 'in_game_only')
        } catch (err) {
          return resultFromError(err)
        }
      }
      try {
        let res = await runOnce()
        // token 失效（TShock 或 WebUI 容器重启）：弹出登录框，登录成功后自动重试一次
        // （该指令上次并未真正执行，重试是安全的）。
        if (res.status === 'token_invalid') {
          const reauthed = await onTokenInvalid()
          if (reauthed) res = await runOnce()
        }
        appendResult(inspected.normalized, res)
        pushHistory({
          cmd: inspected.normalized,
          ts: Date.now(),
          ok: res.status === 'ok',
          status: res.status,
        })
      } finally {
        setRunning(false)
      }
    },
    [dataset, authenticated, transport, onTokenInvalid, pushHistory, appendResult, t, ingameAllowed],
  )

  const execute = useCallback(() => {
    if (running) return
    void runCommandText(text)
  }, [running, runCommandText, text])

  const loadText = useCallback(
    (cmd: string) => {
      setText(cmd)
      focusEnd()
    },
    [setText, focusEnd],
  )

  const removeHistory = useCallback(
    (entry: HistoryEntry) => {
      setRawHistory((prev) =>
        sanitizeHistory(prev).filter((h) => !(h.ts === entry.ts && h.cmd === entry.cmd)),
      )
    },
    [setRawHistory],
  )

  /** 历史去重：同一指令只保留最新一条（history 为最新在前）。 */
  const dedupeHistory = useCallback(() => {
    setRawHistory((prev) => {
      const seen = new Set<string>()
      return sanitizeHistory(prev).filter((h) => {
        if (seen.has(h.cmd)) return false
        seen.add(h.cmd)
        return true
      })
    })
  }, [setRawHistory])

  const insertText = useCallback((snippet: string) => {
    insertSeq.current += 1
    setInsertRequest({ token: insertSeq.current, text: snippet })
  }, [])

  /** 把物品 ID 追加到指令末尾（收藏 tab 点击物品条目用），并把焦点移回输入框。 */
  const appendItemId = useCallback(
    (id: number) => {
      setText((prev) => {
        const base = prev.replace(/\s+$/, '')
        return base ? `${base} ${id} ` : `${id} `
      })
      focusEnd()
    },
    [setText, focusEnd],
  )

  // 未登录：隐藏编辑器 / 结果 / 侧栏，只留标题 + 登录提示（执行与数据拉取都要 token）。
  if (!authenticated) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">{t('editor.title')}</h2>
        <LoginGate onLogin={onLogin} />
      </div>
    )
  }

  return (
    <ItemFavoritesProvider api={favoritesApi}>
    <div
      ref={rootRef}
      // 两列锁到实测可用高度：左卡片内结果区滚动、输入框贴卡片底部（图鉴/鱼店同款量法）。
      className="grid gap-4 xl:h-[var(--cmd-fill)] xl:grid-cols-[minmax(0,1fr)_360px]"
      style={fillHeight ? ({ '--cmd-fill': `${fillHeight}px` } as CSSProperties) : undefined}
    >
      {/* 主列：单卡片 = 头部 + 可滚动结果区 + 底部输入框（透明底、无投影） */}
      <Card className="flex min-w-0 flex-col bg-transparent shadow-none xl:min-h-0">
        <CardHeader className="shrink-0">
          <h2 className="text-lg font-semibold text-foreground">{t('editor.title')}</h2>
          <div className="flex items-center gap-2">
            {transport.mock && <Badge tone="mock">{t('editor.mockOutput')}</Badge>}
            <ConfirmButton
              onConfirm={() => setResults(() => [])}
              disabled={results.length === 0}
              confirmLabel={t('action.clearConfirm')}
            >
              {t('result.clear')}
            </ConfirmButton>
          </div>
        </CardHeader>
        <CardBody className="flex min-h-0 flex-1 flex-col pt-0">
          <ResultPanel
            entries={results}
            running={running}
            itemsById={dataset.itemsById}
            prefixesById={dataset.prefixesById}
            atlas={dataset.atlas}
            onRemove={removeResult}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavoriteCommand}
            onToggleCollapse={toggleResultCollapse}
          />
        </CardBody>
        <Separator />
        {/* 输入框贴在卡片底部（固定高度时不动，只滚动上方结果区）。 */}
        <div className="shrink-0 px-4 py-3">
          <CommandEditor
            value={text}
            onChange={setText}
            computeCompletions={getCompletions}
            getParamHint={getParamHint}
            onExecute={execute}
            busy={running}
            atlas={dataset.atlas}
            fontSize={settings.fontSize}
            invalid={check.executability === 'in_game_only' && !ingameAllowed}
            insertRequest={insertRequest}
            onInsertHandled={() => setInsertRequest(null)}
            focusRequest={focusSeq}
            history={history.map((h) => h.cmd)}
          />
          <TagAssist dataset={dataset} text={text} />
        </div>
      </Card>

      {/* 右侧栏：物品 / 指令 / 收藏 / 历史 / 动态；整列可折叠 */}
      <div className={cn('min-w-0', panelOpen && 'xl:min-h-0')}>
        <Card className={cn('flex min-h-0 flex-col', panelOpen && 'h-full')}>
          <Collapsible
            open={panelOpen}
            onOpenChange={setPanelOpen}
            className="flex min-h-0 flex-1 flex-col"
          >
          <CardHeader className="shrink-0">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group/title flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              >
                <ShoppingBasket className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-semibold tracking-wide text-foreground">
                  {t('editor.panel')}
                </span>
                <CollapseChevron open={panelOpen} className="ml-auto" />
              </button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="shrink-0 border-t border-border/60">
            <Tabs value={tab} onValueChange={(v) => setTab(v as SidebarTab)} className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="items">
                  <Package data-icon="inline-start" />
                  {t('editor.tab.items')}
                </TabsTrigger>
                <TabsTrigger value="commands">
                  <BookOpen data-icon="inline-start" />
                  {t('editor.tab.commands')}
                </TabsTrigger>
                <TabsTrigger value="favorites">
                  <Star data-icon="inline-start" />
                  {t('editor.tab.favorites')}
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History data-icon="inline-start" />
                  {t('editor.tab.history')}
                </TabsTrigger>
                <TabsTrigger value="events">
                  <Activity data-icon="inline-start" />
                  {t('editor.tab.events')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardBody className="min-h-0 flex-1 pt-0">
            {tab === 'events' && (
              <ServerFeedTab
                transport={transport}
                authenticated={authenticated}
                serverId={serverId}
                refreshInterval={settings.eventsRefreshInterval}
                itemsById={dataset.itemsById}
                prefixesById={dataset.prefixesById}
                atlas={dataset.atlas}
              />
            )}
            {tab === 'items' && (
              <ItemSearchPanel
                dataset={dataset}
                onInsert={insertText}
                onOpenInDex={onOpenInDex}
                favorites={itemFavorites}
                onInsertFavorite={(id) => {
                  appendItemId(id)
                  removeItemFav(id)
                }}
              />
            )}
            {tab === 'commands' && (
              <CommandPickerPanel view="commands" dataset={dataset} onLoad={loadText} />
            )}
            {tab === 'favorites' && (
              <CommandPickerPanel
                view="favorites"
                dataset={dataset}
                favorites={favorites}
                onRemoveFavorite={removeFavorite}
                onClearFavorites={clearFavorites}
                onLoad={loadText}
              />
            )}
            {tab === 'history' && (
              <HistoryPanel
                history={history}
                onLoad={loadText}
                onRemove={removeHistory}
                onDedupe={dedupeHistory}
                onClear={() => setRawHistory([])}
              />
            )}
          </CardBody>
          </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>
    </div>
    </ItemFavoritesProvider>
  )
}

function HistoryPanel({
  history,
  onLoad,
  onRemove,
  onDedupe,
  onClear,
}: {
  history: HistoryEntry[]
  onLoad: (cmd: string) => void
  onRemove: (entry: HistoryEntry) => void
  onDedupe: () => void
  onClear: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const batch = useBatchSelect()
  const keyword = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (keyword ? history.filter((h) => h.cmd.toLowerCase().includes(keyword)) : history),
    [history, keyword],
  )

  const handleBatchDelete = () => {
    for (const key of batch.selected) {
      const sep = key.indexOf('|')
      const ts = Number(key.slice(0, sep))
      const cmd = key.slice(sep + 1)
      const entry = history.find((h) => h.ts === ts && h.cmd === cmd)
      if (entry) onRemove(entry)
    }
    batch.cancel()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('editor.historySearch')}
        aria-label={t('editor.historySearch')}
      />

      {history.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History />
            </EmptyMedia>
            <EmptyTitle>{t('editor.historyEmpty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {batch.active ? t('batch.hint') : t('editor.historyNote', { n: HISTORY_LIMIT })}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {!batch.active && (
                <ConfirmButton onConfirm={onDedupe} confirmLabel={t('action.dedupeConfirm')}>
                  {t('editor.historyDedupe')}
                </ConfirmButton>
              )}
              <BatchDeleteControls
                active={batch.active}
                count={batch.count}
                disabled={history.length === 0}
                onEnter={batch.enter}
                onCancel={batch.cancel}
                onConfirm={handleBatchDelete}
              />
              {!batch.active && (
                <ConfirmButton onConfirm={onClear} confirmLabel={t('action.clearConfirm')}>
                  {t('editor.historyClear')}
                </ConfirmButton>
              )}
            </div>
          </div>
          <ul className="min-h-0 flex-1 flex flex-col gap-1 overflow-y-auto pr-1">
            {filtered.map((h) => {
              // 旧数据可能缺 status：按 ok 兜底，避免渲染出 `status.undefined`。
              const status = h.status ?? (h.ok ? 'ok' : 'command_error')
              const key = `${h.ts}|${h.cmd}`
              const checked = batch.has(key)
              return (
                <li key={key}>
                  <Button
                    variant="ghost"
                    aria-pressed={batch.active ? checked : undefined}
                    title={batch.active ? undefined : t('favorites.load')}
                    onClick={() => {
                      if (batch.active) {
                        batch.toggle(key)
                        return
                      }
                      onLoad(h.cmd)
                    }}
                    className={cn(
                      'h-auto w-full cursor-pointer justify-start gap-2 rounded-lg bg-accent/40 px-1.5 py-1 font-pixel text-[11px] font-normal hover:bg-accent',
                      checked && 'bg-accent',
                    )}
                  >
                    {batch.active && <SelectIndicator checked={checked} />}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-left',
                        h.ok ? 'text-foreground' : 'text-destructive',
                      )}
                    >
                      {h.cmd}
                    </span>
                    {!h.ok && <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>}
                    <span className="shrink-0 font-sans text-[10px] text-muted-foreground">
                      {new Date(h.ts).toLocaleTimeString()}
                    </span>
                  </Button>
                </li>
              )
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-2 text-[11px] text-muted-foreground">
                {t('editor.historyNoMatch')}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}
