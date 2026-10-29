import { useCallback, useMemo, useRef, useState } from 'react'
import {
  History,
  Library,
  MessageCircle,
  Package,
  Star,
  Terminal,
} from 'lucide-react'
import { HistoryPanel } from '@/components/command/HistoryPanel'
import { CommandEditor } from '@/components/CommandEditor'
import { CommandPickerPanel } from '@/components/CommandPickerPanel'
import { ConfirmButton } from '@/components/ConfirmButton'
import { ItemSearchPanel } from '@/components/ItemSearchPanel'
import { LoginGate } from '@/components/LoginGate'
import { ResultPanel } from '@/components/ResultPanel'
import { ServerFeedTab } from '@/components/ServerFeed'
import { TagAssist } from '@/components/TagAssist'
import { TopBarActions } from '@/components/TopBar'
import { WebChatInput } from '@/components/WebChatInput'
import {
  Button,
  Card,
  CardBody,
  Empty,
  EmptyContent,
  EmptyMedia,
  EmptyHeader,
  EmptyTitle,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useCommandEditing } from '@/hooks/useCommandEditing'
import { useCommandHistory } from '@/hooks/useCommandHistory'
import { useCommandResultsList } from '@/hooks/useCommandResultsList'
import { useCommandRunner } from '@/hooks/useCommandRunner'
import { useLocalState } from '@/hooks/useLocalState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageHeight } from '@/hooks/usePageHeight'
import { addFavorite, isFavorited, removeFavorite as removeFavoriteEntry, sanitizeFavorites } from '@/lib/favorites'
import { addItemFavorite, isItemFavorited, removeItemFavorite, sanitizeItemFavorites } from '@/lib/itemFavorites'
import { ItemFavoritesProvider, type ItemFavoritesApi } from '@/lib/itemFavoritesContext'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import type { BackendTransport } from '@/lib/tshock'
import type {
  Dataset,
  FavoriteEntry,
  ItemFavorite,
  Settings,
} from '@/types'

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

type SidebarTab = 'commands' | 'items' | 'favorites' | 'history'

/** 工具面板 tab 顺序：指令库在最左，其次是物品 / 收藏 / 历史。 */
const SIDEBAR_TABS: readonly SidebarTab[] = ['commands', 'items', 'favorites', 'history']

/** 页面顶部两个 tab：指令 / 聊天。 */
type PageTab = 'command' | 'chat'

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
  // 历史 / 结果与浮动终端共用同一份存储（见 hooks/useCommandHistory、useCommandResultsList）。
  const {
    history,
    push: pushHistory,
    remove: removeHistoryEntry,
    dedupe: dedupeHistory,
    clear: clearHistory,
  } = useCommandHistory()
  const {
    results,
    append: appendResult,
    remove: removeResult,
    toggleCollapse: toggleResultCollapse,
    clear: clearResults,
  } = useCommandResultsList(serverId)
  // 指令执行的唯一入口（与浮动终端共用）：前置校验 / token 失效重试 / 写历史与结果。
  const { running, run: runCommandText } = useCommandRunner({
    dataset,
    transport,
    authenticated,
    ingameAllowed,
    onTokenInvalid,
    appendResult,
    pushHistory,
  })
  // 记忆右侧当前 tab（刷新 / 切页后保持）。
  const [storedTab, setTab] = useLocalState<SidebarTab>(StorageKeys.commandTab, 'items')
  // 旧版本存过的 tab（如已移除的「动态」）回落到「物品」。
  const tab: SidebarTab = SIDEBAR_TABS.includes(storedTab) ? storedTab : 'items'
  // 右栏整列可折叠。
  const [panelOpen, setPanelOpen] = useState(true)
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  // 页面顶部 tab（指令 / 聊天）与底部输入框右侧的切换按钮双向联动。
  const [storedPageTab, setPageTab] = useLocalState<PageTab>(StorageKeys.commandPageTab, 'command')
  // 旧版本可能存了已移除的 `tips`：回落到「指令」。
  const pageTab: PageTab = storedPageTab === 'chat' ? 'chat' : 'command'
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

  // 前端执行策略 / 补全 / 参数提示：与浮动终端共用一份实现。
  const { check, getCompletions, getParamHint } = useCommandEditing({
    dataset,
    text,
    players,
    language: settings.language,
    runtimeValues,
  })

  // 指令真正发出去后清空输入框（与浮动终端一致）；被前置校验拦下时保留原文，方便改后重发。
  // 清空前比对文本：等待期间已经另敲了新内容就不抹掉。
  const execute = useCallback(() => {
    if (running) return
    const sent = text
    void runCommandText(sent).then((outcome) => {
      if (outcome.dispatched) setText((prev) => (prev === sent ? '' : prev))
    })
  }, [running, runCommandText, text, setText])

  const loadText = useCallback(
    (cmd: string) => {
      setText(cmd)
      focusEnd()
    },
    [setText, focusEnd],
  )

  // 历史的删除 / 去重 / 清空由 useCommandHistory 提供（与浮动终端同一份存储）。
  const removeHistory = removeHistoryEntry

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

  const emptyState = results.length === 0 && !running

  /** 底部输入框右侧的「指令 ⇄ 聊天」按钮：与页面顶部 tab 双向联动。 */
  const modeToggle = (
    <Button
      size="icon"
      variant="ghost"
      className="size-9 shrink-0 rounded-full"
      onClick={() => setPageTab(pageTab === 'chat' ? 'command' : 'chat')}
      aria-label={
        pageTab === 'chat' ? t('editor.mode.switchToCommand') : t('editor.mode.switchToChat')
      }
      title={
        pageTab === 'chat' ? t('editor.mode.switchToCommand') : t('editor.mode.switchToChat')
      }
      aria-pressed={pageTab === 'chat'}
    >
      {pageTab === 'chat' ? <Terminal /> : <MessageCircle />}
    </Button>
  )

  /** 切换工具面板：点已打开的那个 tab 再点一下＝收起面板。 */
  const toggleTools = useCallback(
    (next: SidebarTab) => {
      const visible = wideLayout ? panelOpen : mobileToolsOpen
      if (visible && tab === next) {
        if (wideLayout) setPanelOpen(false)
        else setMobileToolsOpen(false)
        return
      }
      openTools(next)
    },
    [wideLayout, panelOpen, mobileToolsOpen, tab, openTools],
  )

  const toolsVisible = wideLayout ? panelOpen : mobileToolsOpen

  /** 输入框左下角的工具按钮（指令库 / 物品 / 收藏 / 历史）。 */
  const toolButtons = (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label={t('editor.panel')}>
      {(
        [
          ['commands', Library, t('editor.tab.commands')],
          ['items', Package, t('editor.tab.items')],
          ['favorites', Star, t('editor.tab.favorites')],
          ['history', History, t('editor.tab.history')],
        ] as const
      ).map(([value, Icon, label]) => {
        const active = toolsVisible && tab === value
        return (
          <Button
            key={value}
            size="icon"
            variant="ghost"
            className={cn(
              'size-8 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground',
              active && 'bg-accent text-foreground',
            )}
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => toggleTools(value)}
          >
            <Icon />
          </Button>
        )
      })}
    </div>
  )

  const commandComposer = (
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
        leading={toolButtons}
        beforeSend={modeToggle}
      />
      <TagAssist dataset={dataset} text={text} />
    </>
  )

  const chatComposer = (
    <WebChatInput
      transport={transport}
      value={chatText}
      onValueChange={setChatText}
      onSent={() => setFeedRefreshToken((n) => n + 1)}
      beforeSend={modeToggle}
    />
  )

  const toolsContent = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Tabs value={tab} onValueChange={(v) => setTab(v as SidebarTab)} className="w-full gap-0">
        <TabsList className="w-full flex-nowrap justify-start overflow-x-auto">
          <TabsTrigger value="commands" className="min-w-14 shrink-0">
            <Library data-icon="inline-start" />
            {t('editor.tab.commands')}
          </TabsTrigger>
          <TabsTrigger value="items" className="min-w-14 shrink-0">
            <Package data-icon="inline-start" />
            {t('editor.tab.items')}
          </TabsTrigger>
          <TabsTrigger value="favorites" className="min-w-14 shrink-0">
            <Star data-icon="inline-start" />
            {t('editor.tab.favorites')}
          </TabsTrigger>
          <TabsTrigger value="history" className="min-w-14 shrink-0">
            <History data-icon="inline-start" />
            {t('editor.tab.history')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'commands' && (
          <CommandPickerPanel view="commands" dataset={dataset} onLoad={loadText} />
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
            onClear={clearHistory}
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
        className="flex h-full min-h-[360px] min-w-0 flex-col gap-3"
        style={fillHeight ? { height: fillHeight } : undefined}
      >
        {/* 清空结果是页面级操作：有结果才出现，位置在顶栏右侧（与首页刷新 / 管理一致）。
            工具面板的开关不在这里——它现在是输入框左侧的四个按钮。 */}
        <TopBarActions>
          {authenticated && pageTab === 'command' && results.length > 0 && (
            <ConfirmButton onConfirm={clearResults} confirmLabel={t('action.clearConfirm')}>
              {t('result.clear')}
            </ConfirmButton>
          )}
        </TopBarActions>

        <Tabs
          value={pageTab}
          onValueChange={(v) => setPageTab(v as PageTab)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList variant="line" aria-label={t('editor.pages')} className="w-full shrink-0 justify-start">
            <TabsTrigger value="command" variant="line" className="flex-none">
              {t('editor.page.command')}
            </TabsTrigger>
            <TabsTrigger value="chat" variant="line" className="flex-none">
              {t('editor.page.chat')}
            </TabsTrigger>
          </TabsList>

          {/* 指令：可滚动结果区 + 贴底输入框 + 右侧工具面板。 */}
          <TabsContent value="command" className="min-h-0 flex-1">
            {!authenticated ? (
              <LoginGate onLogin={onLogin} />
            ) : (
            <div
              className={cn(
                'flex h-full min-h-0 flex-col gap-3',
                panelOpen &&
                  'xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-[minmax(0,1fr)]',
              )}
            >
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <CardBody className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
                  {emptyState ? (
                    /* 空态不画框：工作区本身就是画布，引导块居中，输入框照旧贴底。 */
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
                      <Empty className="py-2">
                        <EmptyHeader className="max-w-xl">
                          {/* 主工作区的空态与右侧面板同构（图标 + 标题），但多出主操作，
                              层次上仍然是「主角」。 */}
                          <EmptyMedia variant="icon">
                            <Terminal />
                          </EmptyMedia>
                          <EmptyTitle>{t('editor.emptyTitle')}</EmptyTitle>
                        </EmptyHeader>
                        <EmptyContent className="max-w-xl">
                        <div className="flex flex-wrap justify-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openTools('commands')}
                          >
                            <Library data-icon="inline-start" />
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
                            <span className="text-2xs text-muted-foreground">
                              {t('editor.recentCommands')}
                            </span>
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
                    </div>
                  ) : (
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
                  )}
                </CardBody>
                <Separator />
                <div className="shrink-0 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-3">
                  {commandComposer}
                </div>
              </div>

              {/* 桌面右侧工具列（无标题栏，开关是输入框左侧那四个按钮）。手机端改为 Sheet。 */}
              {panelOpen && (
                <div
                  id="command-tools"
                  className="hidden min-h-0 min-w-0 scroll-mt-14 overflow-hidden xl:block"
                >
                  <Card className="flex h-full min-h-0 flex-col">
                    <CardBody className="min-h-0 flex-1 pt-2">{toolsContent}</CardBody>
                  </Card>
                </div>
              )}
            </div>
            )}
          </TabsContent>

          {/* 聊天：服务器动态 + 发言输入框（原先在工具面板的「动态」tab）。 */}
          <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col gap-3">
            {!authenticated ? (
              <LoginGate onLogin={onLogin} />
            ) : (
            <>
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardBody className="flex min-h-0 flex-1 flex-col pt-2">
                <ServerFeedTab
                  transport={transport}
                  authenticated={authenticated}
                  serverId={serverId}
                  refreshInterval={settings.eventsRefreshInterval}
                  refreshToken={feedRefreshToken}
                  onTokenInvalid={onTokenInvalid}
                  itemsById={dataset.itemsById}
                  prefixesById={dataset.prefixesById}
                  atlas={dataset.atlas}
                />
              </CardBody>
            </Card>
            <div className="shrink-0 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-3">
              {chatComposer}
            </div>
            </>
            )}
          </TabsContent>

        </Tabs>

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
