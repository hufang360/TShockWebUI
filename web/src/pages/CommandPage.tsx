import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Activity, BookOpen, History, Package, Star, X } from 'lucide-react'
import { CommandEditor } from '@/components/CommandEditor'
import { CommandPickerPanel } from '@/components/CommandPickerPanel'
import { ItemSearchPanel } from '@/components/ItemSearchPanel'
import { ResultPanel, STATUS_TONE, type ResultEntry } from '@/components/ResultPanel'
import { ServerFeedTab } from '@/components/ServerFeed'
import { TagAssist } from '@/components/TagAssist'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalState } from '@/hooks/useLocalState'
import { inspectCommand, type CommandCheck } from '@/lib/commands'
import { computeCompletions, paramHintFor } from '@/lib/completion'
import type { CompletionItem } from '@/lib/completion'
import { addFavorite, isFavorited, removeFavorite as removeFavoriteEntry, sanitizeFavorites } from '@/lib/favorites'
import { removeItemFavorite, sanitizeItemFavorites } from '@/lib/itemFavorites'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import { resultFromError, type BackendTransport } from '@/lib/tshock'
import type {
  CommandResult,
  Dataset,
  FavoriteEntry,
  HistoryEntry,
  ItemFavorite,
  Settings,
} from '@/types'

const HISTORY_LIMIT = 100
/** 结果卡片保留最近 N 条（更早的自动丢弃）。 */
const RESULT_LIMIT = 20

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
  onOpenInDex,
}: CommandPageProps) {
  const { t } = useI18n()
  const [text, setText] = useLocalState(StorageKeys.draft, '')
  const [history, setHistory] = useLocalState<HistoryEntry[]>(StorageKeys.history, [])
  const [results, setResults] = useState<ResultEntry[]>([])
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<SidebarTab>('items')
  const resultSeq = useRef(0)
  const [insertRequest, setInsertRequest] = useState<{ token: number; text: string } | null>(null)
  const insertSeq = useRef(0)
  // 递增令牌：让指令输入框重新聚焦并把光标移到末尾（载入指令 / 历史时）。
  const [focusSeq, setFocusSeq] = useState(0)
  const focusEnd = useCallback(() => setFocusSeq((n) => n + 1), [])
  // 左列至少铺满 main 的可见高度：输入框是 sticky bottom-0，只有容器真正到屏幕底部，
  // 它才会贴在底部，而不是停在结果卡片下方的屏幕中间（图鉴页同款量法）。
  const leftColRef = useRef<HTMLDivElement>(null)
  const [fillHeight, setFillHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = leftColRef.current
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
  }, [])

  const check = useMemo(() => inspectCommand(text, dataset), [text, dataset])

  // 收藏指令（tswui:favorites）：星标按钮反映当前输入文本是否已收藏。
  const [rawFavorites, setRawFavorites] = useLocalState<FavoriteEntry[]>(StorageKeys.favorites, [])
  const favorites = useMemo(() => sanitizeFavorites(rawFavorites), [rawFavorites])
  const favoriteKey = check.parsed ? check.normalized : ''
  const favorited = isFavorited(favorites, favoriteKey)
  const toggleFavorite = useCallback(() => {
    if (!favoriteKey) return
    setRawFavorites((prev) => {
      const clean = sanitizeFavorites(prev)
      return favorited ? removeFavoriteEntry(clean, favoriteKey) : addFavorite(clean, favoriteKey)
    })
  }, [favoriteKey, favorited, setRawFavorites])

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

  const getCompletions = useCallback(
    (value: string, caret: number): CompletionItem[] =>
      computeCompletions({ dataset, text: value, caret, players, lang: settings.language, runtimeValues }),
    [dataset, players, settings.language, runtimeValues],
  )

  // 当前参数的用法串（TShock 源码原文），显示在编辑器下方（参数提示）。
  const getParamHint = useCallback(
    (value: string, caret: number) => paramHintFor(dataset, value, caret),
    [dataset],
  )

  const pushHistory = useCallback(
    (entry: HistoryEntry) => {
      setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT))
    },
    [setHistory],
  )

  /** 追加一条执行结果（不覆盖上次），最多保留 RESULT_LIMIT 条。 */
  const appendResult = useCallback((command: string, result: CommandResult) => {
    resultSeq.current += 1
    const entry: ResultEntry = { seq: resultSeq.current, ts: Date.now(), command, result }
    setResults((prev) => [...prev, entry].slice(-RESULT_LIMIT))
  }, [])

  const removeResult = useCallback((seq: number) => {
    setResults((prev) => prev.filter((e) => e.seq !== seq))
  }, [])

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
      setHistory((prev) => prev.filter((h) => !(h.ts === entry.ts && h.cmd === entry.cmd)))
    },
    [setHistory],
  )

  const insertText = useCallback((snippet: string) => {
    insertSeq.current += 1
    setInsertRequest({ token: insertSeq.current, text: snippet })
  }, [])

  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"
      // 右栏高度用实测可用高度（而不是 100vh），避免页面多出一点滚动、底部被裁剪。
      style={fillHeight ? ({ '--cmd-fill': `${fillHeight}px` } as CSSProperties) : undefined}
    >
      {/* 主列：结果卡片 + 底部吸附输入框 */}
      <div
        ref={leftColRef}
        style={fillHeight ? { minHeight: fillHeight } : undefined}
        className="flex min-w-0 flex-col gap-4"
      >
        <div className="min-h-[40vh] flex-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-foreground">{t('editor.title')}</h2>
            <div className="flex items-center gap-2">
              {transport.mock && <Badge tone="mock">{t('editor.mockOutput')}</Badge>}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setResults([])}
                disabled={results.length === 0}
              >
                {t('result.clear')}
              </Button>
            </div>
          </div>
          <ResultPanel
            entries={results}
            running={running}
            itemsById={dataset.itemsById}
            prefixesById={dataset.prefixesById}
            atlas={dataset.atlas}
            onRemove={removeResult}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavoriteCommand}
          />
        </div>

        {/* 输入框吸附到底部：滚动正文时始终可见。 */}
        <div className="sticky bottom-0 z-10 -mx-1 bg-background/95 px-1 pt-2 pb-2 backdrop-blur">
          <div className="rounded-xl border border-border bg-card p-3 shadow-lg">
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
            />
            <TagAssist dataset={dataset} text={text} />
          </div>
        </div>
      </div>

      {/* 右侧栏：物品 / 指令 / 历史记录 */}
      <div className="min-w-0 xl:sticky xl:top-4 xl:h-[var(--cmd-fill)]">
        <Card className="flex h-full min-h-0 flex-col">
          <CardHeader>
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
              <ItemSearchPanel dataset={dataset} onInsert={insertText} onOpenInDex={onOpenInDex} />
            )}
            {tab === 'commands' && (
              <CommandPickerPanel
                view="commands"
                dataset={dataset}
                favorites={favorites}
                currentKey={favoriteKey}
                favoritedCurrent={favorited}
                onToggleCurrent={toggleFavorite}
                onRemoveFavorite={removeFavorite}
                onLoad={loadText}
                onRun={(cmd) => void runCommandText(cmd)}
                authenticated={authenticated}
                running={running}
              />
            )}
            {tab === 'favorites' && (
              <CommandPickerPanel
                view="favorites"
                dataset={dataset}
                favorites={favorites}
                itemFavorites={itemFavorites}
                currentKey={favoriteKey}
                favoritedCurrent={favorited}
                onToggleCurrent={toggleFavorite}
                onRemoveFavorite={removeFavorite}
                onRemoveItemFavorite={removeItemFav}
                onInsertItemId={(id) => insertText(` ${id} `)}
                onLoad={loadText}
                onRun={(cmd) => void runCommandText(cmd)}
                authenticated={authenticated}
                running={running}
              />
            )}
            {tab === 'history' && (
              <HistoryPanel
                history={history}
                onLoad={loadText}
                onRemove={removeHistory}
                onClear={() => setHistory([])}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function HistoryPanel({
  history,
  onLoad,
  onRemove,
  onClear,
}: {
  history: HistoryEntry[]
  onLoad: (cmd: string) => void
  onRemove: (entry: HistoryEntry) => void
  onClear: () => void
}) {
  const { t } = useI18n()
  if (history.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('editor.historyEmpty')}</p>
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">{t('editor.historyNote', { n: HISTORY_LIMIT })}</span>
        <Button size="sm" variant="ghost" onClick={onClear}>
          {t('editor.historyClear')}
        </Button>
      </div>
      <ul className="min-h-0 flex-1 flex flex-col gap-1 overflow-y-auto pr-1">
        {history.map((h) => (
          <li key={`${h.ts}-${h.cmd}`} className="flex items-center gap-2 rounded-lg bg-accent/30 px-1.5 py-1">
            {/* 指令在最左；点击替换输入框并把光标移到末尾。异常标红。 */}
            <Button
              variant="ghost"
              onClick={() => onLoad(h.cmd)}
              className="h-auto min-w-0 flex-1 cursor-pointer justify-start px-1 py-0.5 font-pixel text-[11px] font-normal hover:bg-transparent hover:text-primary"
              title={h.cmd}
            >
              <span className={cn('min-w-0 truncate', h.ok ? 'text-foreground' : 'text-destructive')}>
                {h.cmd}
              </span>
            </Button>
            {/* 异常状态 tag 在时间左边 */}
            {!h.ok && <Badge tone={STATUS_TONE[h.status]}>{t(`status.${h.status}`)}</Badge>}
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {new Date(h.ts).toLocaleTimeString()}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              className="shrink-0"
              aria-label={t('result.remove')}
              title={t('result.remove')}
              onClick={() => onRemove(h)}
            >
              <X data-icon="inline-start" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
