import { useCallback, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  History,
  MessageCircle,
  Package,
  PanelRight,
  Star,
  Terminal,
} from 'lucide-react'
import { HistoryPanel } from '@/components/command/HistoryPanel'
import { IconAction } from '@/components/IconAction'
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
  CardHeader,
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
  TabId,
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
  /** 前往其它页面（小抄 tab 里的「数据 ID → NPC」入口）。 */
  onNavigate?: (tab: TabId) => void
}

type SidebarTab = 'items' | 'favorites' | 'history'

/** 页面顶部三个 tab：指令 / 聊天 / 小抄。 */
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
  onNavigate,
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
  const [tab, setTab] = useLocalState<SidebarTab>(StorageKeys.commandTab, 'items')
  // 右栏整列可折叠。
  const [panelOpen, setPanelOpen] = useState(true)
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  // 页面顶部 tab（指令 / 聊天 / 小抄）与底部输入框右侧的切换按钮双向联动。
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
        {/* 工具面板开关收到顶栏右侧；聊天 / 小抄 tab 不需要它。 */}
        <TopBarActions>
          {authenticated && pageTab === 'command' && (
            <IconAction
              label={t('editor.panel')}
              icon={PanelRight}
              pressed={wideLayout ? panelOpen : undefined}
              onClick={() => {
                if (wideLayout) setPanelOpen((value) => !value)
                else setMobileToolsOpen(true)
              }}
            />
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
                <CardHeader className="shrink-0 justify-end">
                  <ConfirmButton
                    onConfirm={clearResults}
                    disabled={results.length === 0}
                    confirmLabel={t('action.clearConfirm')}
                  >
                    {t('result.clear')}
                  </ConfirmButton>
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
                            onClick={() => onNavigate?.('commands')}
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
                  {commandComposer}
                </div>
              </div>

              {/* 桌面右侧工具列（无标题栏，开关在顶栏）。手机端改为 Sheet。 */}
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
                  itemsById={dataset.itemsById}
                  prefixesById={dataset.prefixesById}
                  atlas={dataset.atlas}
                />
              </CardBody>
            </Card>
            <div className="shrink-0 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
