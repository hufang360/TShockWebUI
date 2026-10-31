import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  History,
  Library,
  Star,
  Terminal,
  Trash2,
} from 'lucide-react'
import {
  CommandToolsDialog,
  type ToolTab,
  type ToolsAnchorRect,
} from '@/components/command/CommandToolsDialog'
import { CommandEditor } from '@/components/CommandEditor'
import { ConfirmButton } from '@/components/ConfirmButton'
import { IconAction } from '@/components/IconAction'
import { LoginGate } from '@/components/LoginGate'
import { ResultPanel } from '@/components/ResultPanel'
import { TagAssist } from '@/components/TagAssist'
import { TopBarActions } from '@/components/TopBar'
import {
  Button,
  CardBody,
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyHeader,
  EmptyTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useCommandEditing } from '@/hooks/useCommandEditing'
import { useCommandHistory } from '@/hooks/useCommandHistory'
import { useCommandResultsList } from '@/hooks/useCommandResultsList'
import { useCommandRunner } from '@/hooks/useCommandRunner'
import { useItemFavoritesState } from '@/hooks/useItemFavoritesState'
import { useLocalState } from '@/hooks/useLocalState'
import { usePageHeight } from '@/hooks/usePageHeight'
import { addFavorite, isFavorited, removeFavorite as removeFavoriteEntry, sanitizeFavorites } from '@/lib/favorites'
import { consumeEditorFocus } from '@/lib/editorFocus'
import { ItemFavoritesProvider } from '@/lib/itemFavoritesContext'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import type { BackendTransport } from '@/lib/tshock'
import type {
  Dataset,
  FavoriteEntry,
  Settings,
} from '@/types'

interface CommandPageProps {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  settings: Settings
  /** 当前 TShock 上游 id；结果列表按服务器分开。 */
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
    setAllCollapsed,
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
  // 工具弹框：开关 + 当前 tab（每次点按钮都会把 tab 点到对应的那个，不需要记忆）。
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tab, setTab] = useState<ToolTab>('items')
  const [insertRequest, setInsertRequest] = useState<{ token: number; text: string } | null>(null)
  const insertSeq = useRef(0)
  // 递增令牌：让指令输入框重新聚焦并把光标移到末尾（载入指令 / 历史时）。
  const [focusSeq, setFocusSeq] = useState(0)
  const focusEnd = useCallback(() => setFocusSeq((n) => n + 1), [])
  // 从首页「最近执行」跳过来：草稿已填好，再把焦点与光标交给输入框。
  // 这里必须「读完外部一次性信号 → 更新令牌」，属于与外部信号同步的正当用法：
  // 令牌在 render 里递增会让 StrictMode 的双次渲染各消费一次（第二次读不到信号）。
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 消费跨页跳转的一次性聚焦信号
    if (consumeEditorFocus()) focusEnd()
  }, [focusEnd])
  // 工具弹框是 popover：贴在点开的那个按钮旁边展开，所以要记下按钮的位置。
  const [toolsAnchor, setToolsAnchor] = useState<ToolsAnchorRect | null>(null)
  const openTools = useCallback(
    (nextTab: ToolTab, anchor?: ToolsAnchorRect | null) => {
      if (anchor) setToolsAnchor(anchor)
      setTab(nextTab)
      setToolsOpen(true)
    },
    [setTab],
  )
  /** 关掉弹框就把焦点还给指令输入框（否则焦点会掉到 body / 触发按钮上）。 */
  const closeTools = useCallback(() => {
    setToolsOpen(false)
    focusEnd()
  }, [focusEnd])
  // 页面不固定高度：内容少时刚好一屏（输入框贴底、空态居中），结果多了就把页面撑高、
  // 由 AppShell 的 `<main>` 整页滚动（浏览器右侧那条滚动条）。
  // `usePageHeight` 仍用来拿「一屏高」当 `min-height`，并顺带把主内容区滚回顶部。
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
  // 状态由 `useItemFavoritesState` 统一管理：提示里的 ⭐ 与「物品」tab 用的是同一份数据。
  const {
    list: itemFavorites,
    api: favoritesApi,
    clear: clearItemFavorites,
  } = useItemFavoritesState()
  const clearFavorites = useCallback(() => {
    setRawFavorites([])
    clearItemFavorites()
  }, [setRawFavorites, clearItemFavorites])

  // 前端执行策略 / 补全 / 参数提示：与浮动终端共用一份实现。
  const { check, getCompletions, getHelp } = useCommandEditing({
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
      // 从弹框里选完就收起弹框，把焦点交回输入框（空态里的「最近指令」按钮也走这里，本来就关着）。
      setToolsOpen(false)
      focusEnd()
    },
    [setText, focusEnd],
  )

  // 历史的删除 / 去重 / 清空由 useCommandHistory 提供（与浮动终端同一份存储）。
  const removeHistory = removeHistoryEntry

  const insertText = useCallback((snippet: string) => {
    insertSeq.current += 1
    setInsertRequest({ token: insertSeq.current, text: snippet })
    setToolsOpen(false)
  }, [])

  /** 把物品 ID 追加到指令末尾（物品 tab 里点收藏物品用），并把焦点移回输入框。 */
  const appendItemId = useCallback(
    (id: number) => {
      setText((prev) => {
        const base = prev.replace(/\s+$/, '')
        return base ? `${base} ${id} ` : `${id} `
      })
      setToolsOpen(false)
      focusEnd()
    },
    [setText, focusEnd],
  )

  const emptyState = results.length === 0 && !running
  // 顶栏「展开全部 / 折叠全部」：按当前折叠情况决定哪个可点。
  const anyCollapsed = results.some((entry) => entry.collapsed)
  const anyExpanded = results.some((entry) => !entry.collapsed)

  /** 切换工具弹框：点已打开的那个 tab 再点一下＝收起。 */
  const toggleTools = useCallback(
    (next: ToolTab, anchor: ToolsAnchorRect) => {
      if (toolsOpen && tab === next) {
        closeTools()
        return
      }
      openTools(next, anchor)
    },
    [toolsOpen, tab, openTools, closeTools],
  )

  /** 从点击事件里取出按钮在视口里的位置（popover 的锚点）。 */
  const anchorFrom = (el: HTMLElement): ToolsAnchorRect => {
    const rect = el.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }

  /** 一个工具按钮（打开 / 收起对应面板），悬停出 Tooltip。 */
  const toolButton = ([value, Icon, label]: readonly [ToolTab, LucideIcon, string]) => {
    const active = toolsOpen && tab === value
    return (
      <Tooltip key={value}>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              // 方形控制块（不是圆钮）；图标小一号，视觉重量和输入框里的文字更接近。
              'size-7 shrink-0 rounded-control text-muted-foreground hover:bg-accent hover:text-foreground',
              '[&_svg]:size-3',
              active && 'bg-accent text-foreground',
            )}
            aria-label={label}
            aria-pressed={active}
            aria-haspopup="dialog"
            onClick={(event) => toggleTools(value, anchorFrom(event.currentTarget))}
          >
            <Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  }

  /** 输入框**左下角**：指令库 / 物品（写指令时查与插）。图标与侧栏「物品 ID」统一。 */
  const toolButtons = (
    <TooltipProvider delayDuration={200}>
      <div
        // `p-1 -m-1`：`overflow-x-auto` 会裁掉聚焦光圈（2px 画在按钮外面），留出余量就不切边了。
        className="flex min-w-0 items-center gap-1 overflow-x-auto p-1 -m-1"
        role="group"
        aria-label={t('editor.panel')}
      >
        {(
          [
            ['commands', Library, t('editor.tab.commands')],
            ['items', BookOpen, t('editor.tab.items')],
          ] as const
        ).map(toolButton)}
      </div>
    </TooltipProvider>
  )

  /** **发送键旁边**：收藏 / 历史（回翻自己存过的东西，属于发送前顺手做的事）。 */
  const trailingToolButtons = (
    <TooltipProvider delayDuration={200}>
      <div className="flex shrink-0 items-center gap-1">
        {(
          [
            ['favorites', Star, t('editor.tab.favorites')],
            ['history', History, t('editor.tab.history')],
          ] as const
        ).map(toolButton)}
      </div>
    </TooltipProvider>
  )

  const commandComposer = (
    <>
      <CommandEditor
        value={text}
        onChange={setText}
        computeCompletions={getCompletions}
        getHelp={getHelp}
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
        trailing={trailingToolButtons}
        slashToFocus
      />
      <TagAssist dataset={dataset} text={text} />
    </>
  )

  return (
    <ItemFavoritesProvider api={favoritesApi}>
      <div
        ref={rootRef}
        data-testid="command-workspace"
        className="flex min-h-[360px] min-w-0 flex-col gap-3"
        style={fillHeight ? { minHeight: fillHeight } : undefined}
      >
        {/* 页面级动作都在内容区顶栏右侧（与首页刷新 / 管理同规）：
            展开全部 / 折叠全部，最右是「清空结果」——有结果才出现，仍需二次确认。 */}
        <TopBarActions>
          {authenticated && results.length > 0 && (
            <>
              <IconAction
                label={t('result.expandAll')}
                icon={ChevronsUpDown}
                disabled={!anyCollapsed}
                onClick={() => setAllCollapsed(false)}
              />
              <IconAction
                label={t('result.collapseAll')}
                icon={ChevronsDownUp}
                disabled={!anyExpanded}
                onClick={() => setAllCollapsed(true)}
              />
              <ConfirmButton
                size="icon-sm"
                // 与旁边两个 IconAction 同一档灰（不可删除时禁用态自己会淡下去）。
                className="text-muted-foreground hover:text-foreground"
                onConfirm={clearResults}
                confirmLabel={t('action.clearConfirm')}
                icon={<Trash2 data-icon="inline-start" />}
                aria-label={t('result.clear')}
                title={t('result.clear')}
              />
            </>
          )}
        </TopBarActions>

        {!authenticated ? (
          <LoginGate onLogin={onLogin} />
        ) : (
          /* 结果区（整页滚动）+ 贴底输入框（工具在弹框里，不占宽度）。 */
          <div className="flex min-w-0 flex-1 flex-col">
            <CardBody className="flex min-w-0 flex-1 flex-col">
              {emptyState ? (
                /* 空态不画框：工作区本身就是画布，引导块居中，输入框照旧贴底。
                   不再摆「打开指令库」大按钮与「最近执行」小标签：工具入口就在输入框左下角，
                   重复一遍只会让清空后的页面显得很吵。 */
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
                  <Empty className="py-2">
                    <EmptyHeader className="max-w-md">
                      <EmptyMedia variant="icon">
                        <Terminal />
                      </EmptyMedia>
                      <EmptyTitle>{t('editor.emptyTitle')}</EmptyTitle>
                      <EmptyDescription>{t('editor.emptyHint')}</EmptyDescription>
                    </EmptyHeader>
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
                  onFillCommand={loadText}
                  onToggleCollapse={toggleResultCollapse}
                  pageScroll
                />
              )}
            </CardBody>
            {/* 吸底：结果（页面）往上滚，这一块钉在视口底部；`-mb-2` 抵消 AppShell 的 `p-2`，
                滚到最底时不会突然多出 8px 空隙。 */}
            <div className="sticky bottom-0 z-10 -mb-2 shrink-0 bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {commandComposer}
            </div>
          </div>
        )}

        <CommandToolsDialog
          open={toolsOpen}
          anchorRect={toolsAnchor}
          onOpenChange={(next) => (next ? setToolsOpen(true) : closeTools())}
          tab={tab}
          dataset={dataset}
          favorites={favorites}
          itemFavorites={itemFavorites}
          history={history}
          onLoad={loadText}
          onInsert={insertText}
          onOpenInDex={
            onOpenInDex
              ? (itemId) => {
                  setToolsOpen(false)
                  onOpenInDex(itemId)
                }
              : undefined
          }
          onInsertItemFavorite={(id) => {
            // 只把 ID 追到指令里；**不**删收藏（同一件东西常常要发好几次）。
            appendItemId(id)
          }}
          onRemoveFavorite={removeFavorite}
          onClearFavorites={clearFavorites}
          onRemoveHistory={removeHistory}
          onDedupeHistory={dedupeHistory}
          onClearHistory={clearHistory}
        />
      </div>
    </ItemFavoritesProvider>
  )
}
