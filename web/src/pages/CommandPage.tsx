import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BookOpen,
  History,
  MessageCircle,
  Package,
  PanelRight,
  ShoppingBasket,
  Star,
  Terminal,
} from 'lucide-react'
import { HistoryPanel } from '@/components/command/HistoryPanel'
import { CollapseChevron } from '@/components/CollapseChevron'
import { CommandEditor } from '@/components/CommandEditor'
import { CommandPickerPanel } from '@/components/CommandPickerPanel'
import { ConfirmButton } from '@/components/ConfirmButton'
import { ItemSearchPanel } from '@/components/ItemSearchPanel'
import { LoginGate } from '@/components/LoginGate'
import { ResultPanel, type ResultEntry } from '@/components/ResultPanel'
import { ServerFeedTab } from '@/components/ServerFeed'
import { TagAssist } from '@/components/TagAssist'
import { WebChatInput } from '@/components/WebChatInput'
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalState } from '@/hooks/useLocalState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageHeight } from '@/hooks/usePageHeight'
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
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  const [composerMode, setComposerMode] = useState<'command' | 'chat'>('command')
  const [chatText, setChatText] = useState('')
  const [feedRefreshToken, setFeedRefreshToken] = useState(0)
  const [insertRequest, setInsertRequest] = useState<{ token: number; text: string } | null>(null)
  const insertSeq = useRef(0)
  // 递增令牌：让指令输入框重新聚焦并把光标移到末尾（载入指令 / 历史时）。
  const [focusSeq, setFocusSeq] = useState(0)
  const focusEnd = useCallback(() => setFocusSeq((n) => n + 1), [])
  const wideLayout = useMediaQuery('(min-width: 1280px)')
  const openTools = useCallback(
    (nextTab: SidebarTab) => {
      setTab(nextTab)
      if (!wideLayout) {
        setMobileToolsOpen(true)
      } else {
        setPanelOpen(true)
      }
    },
    [setTab, wideLayout],
  )
  // 页面始终占满主内容区：结果区自己滚动，输入框固定在页面底部。
  const rootRef = useRef<HTMLDivElement>(null)
  const fillHeight = usePageHeight(rootRef, authenticated)

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

  const emptyState = results.length === 0 && !running
  const modeToggle = (
    <Button
      size="icon"
      variant="ghost"
      className="size-9 shrink-0 rounded-full"
      onClick={() => setComposerMode((mode) => (mode === 'command' ? 'chat' : 'command'))}
      aria-label={
        composerMode === 'command' ? t('editor.mode.switchToChat') : t('editor.mode.switchToCommand')
      }
      title={
        composerMode === 'command' ? t('editor.mode.switchToChat') : t('editor.mode.switchToCommand')
      }
      aria-pressed={composerMode === 'chat'}
    >
      {composerMode === 'command' ? <MessageCircle /> : <Terminal />}
    </Button>
  )
  const composer = (
    <>
      {composerMode === 'command' ? (
        <>
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
            beforeSend={modeToggle}
          />
          <TagAssist dataset={dataset} text={text} />
        </>
      ) : (
        <WebChatInput
          transport={transport}
          value={chatText}
          onValueChange={setChatText}
          onSent={() => setFeedRefreshToken((n) => n + 1)}
          beforeSend={modeToggle}
        />
      )}
    </>
  )

  const toolsContent = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Tabs value={tab} onValueChange={(v) => setTab(v as SidebarTab)} className="w-full gap-0">
        <TabsList className="w-full flex-nowrap justify-start overflow-x-auto">
          <TabsTrigger value="items" className="min-w-14 shrink-0">
            <Package data-icon="inline-start" />
            {t('editor.tab.items')}
          </TabsTrigger>
          <TabsTrigger value="commands" className="min-w-14 shrink-0">
            <BookOpen data-icon="inline-start" />
            {t('editor.tab.commands')}
          </TabsTrigger>
          <TabsTrigger value="favorites" className="min-w-14 shrink-0">
            <Star data-icon="inline-start" />
            {t('editor.tab.favorites')}
          </TabsTrigger>
          <TabsTrigger value="history" className="min-w-14 shrink-0">
            <History data-icon="inline-start" />
            {t('editor.tab.history')}
          </TabsTrigger>
          <TabsTrigger value="events" className="min-w-14 shrink-0">
            <Activity data-icon="inline-start" />
            {t('editor.tab.events')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'events' && (
          <ServerFeedTab
            transport={transport}
            authenticated={authenticated}
            serverId={serverId}
            refreshInterval={settings.eventsRefreshInterval}
            refreshToken={feedRefreshToken}
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
          <CommandPickerPanel
            view="commands"
            dataset={dataset}
            onLoad={loadText}
          />
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
      </div>
    </div>
  )

  return (
    <ItemFavoritesProvider api={favoritesApi}>
      <div
        ref={rootRef}
        data-testid="command-workspace"
        className="flex h-full min-h-[360px] min-w-0 flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_360px]"
        style={fillHeight ? { height: fillHeight } : undefined}
      >
        {/* 主列：头部 + 可滚动结果区 + 始终贴底的输入框。 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CardHeader className="shrink-0">
            <h2 className="text-lg font-semibold text-foreground">{t('editor.title')}</h2>
            <div className="flex items-center gap-1.5">
              {transport.mock && <Badge tone="mock">{t('editor.mockOutput')}</Badge>}
              <Button
                size="icon-sm"
                variant="ghost"
                className="xl:hidden"
                onClick={() => setMobileToolsOpen(true)}
                aria-label={t('editor.openPanel')}
                title={t('editor.openPanel')}
              >
                <PanelRight data-icon="inline-start" />
              </Button>
              <ConfirmButton
                onConfirm={() => setResults(() => [])}
                disabled={results.length === 0}
                confirmLabel={t('action.clearConfirm')}
              >
                {t('result.clear')}
              </ConfirmButton>
            </div>
          </CardHeader>
          <CardBody className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
            {emptyState ? (
              <Empty className="h-full min-h-0 w-full self-center border border-dashed p-5 sm:p-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Terminal />
                  </EmptyMedia>
                  <EmptyTitle>{t('editor.emptyTitle')}</EmptyTitle>
                  <EmptyDescription>{t('editor.emptyHint')}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="max-w-xl">
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openTools('commands')}
                    >
                      <BookOpen data-icon="inline-start" />
                      {t('editor.browseCommands')}
                    </Button>
                    {favorites.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openTools('favorites')}
                      >
                        <Star data-icon="inline-start" />
                        {t('editor.tab.favorites')} · {favorites.length}
                      </Button>
                    )}
                  </div>
                  {history.length > 0 && tab !== 'history' && (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-2xs text-muted-foreground">{t('editor.recentCommands')}</span>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {history.slice(0, 3).map((h) => (
                          <Button
                            key={`${h.ts}:${h.cmd}`}
                            size="sm"
                            variant="ghost"
                            className="max-w-full font-pixel text-xs"
                            title={h.cmd}
                            onClick={() => loadText(h.cmd)}
                          >
                            <span className="truncate">{h.cmd}</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </EmptyContent>
              </Empty>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
              </div>
            )}
          </CardBody>
          <Separator />
          <div className="shrink-0 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-3">
            {composer}
          </div>
        </div>

        {/* 桌面右侧工具列。手机端改为 Sheet，避免挤压输入区。 */}
        <div
          id="command-tools"
          className={cn('hidden min-w-0 scroll-mt-14 xl:block', panelOpen && 'xl:min-h-0')}
        >
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
                <CardBody className="min-h-0 flex-1 pt-0">{toolsContent}</CardBody>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        <Sheet open={mobileToolsOpen} onOpenChange={setMobileToolsOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-3 p-4 sm:max-w-md">
            <SheetHeader className="pr-8">
              <SheetTitle>{t('editor.panel')}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1">{toolsContent}</div>
          </SheetContent>
        </Sheet>
      </div>
    </ItemFavoritesProvider>
  )
}

