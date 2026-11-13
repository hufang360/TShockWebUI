import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  Library,
  Terminal,
  Trash2,
} from 'lucide-react'
import {
  CommandToolsDialog,
  type ToolGroup,
  type ToolsAnchorRect,
} from '@/components/command/CommandToolsDialog'
import { IconAction } from '@/components/IconAction'
import { EditorToolButton } from '@/components/command/EditorToolButton'
import { CommandEditor } from '@/components/CommandEditor'
import { ConfirmButton } from '@/components/ConfirmButton'
import { LoginGate } from '@/components/LoginGate'
import { ResultPanel } from '@/components/ResultPanel'
import { ServerFeedTab } from '@/components/ServerFeed'
import { SendPreview } from '@/components/SendPreview'
import {
  CardBody,
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyHeader,
  EmptyTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { useChatSend } from '@/hooks/useChatSend'
import { useCommandEditing } from '@/hooks/useCommandEditing'
import { useCommandHistory } from '@/hooks/useCommandHistory'
import { useCommandResultsList } from '@/hooks/useCommandResultsList'
import { useCommandRunner } from '@/hooks/useCommandRunner'
import { useItemFavoritesState } from '@/hooks/useItemFavoritesState'
import { useLocalState } from '@/hooks/useLocalState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageHeight } from '@/hooks/usePageHeight'
import { cn } from '@/lib/cn'
import {
  addFavorite,
  isFavorited,
  removeFavorite as removeFavoriteEntry,
  sanitizeFavorites,
} from '@/lib/favorites'
import { consumeEditorFocus } from '@/lib/editorFocus'
import { clearEditorViewRequest, useEditorViewRequest } from '@/lib/editorView'
import { ItemFavoritesProvider } from '@/lib/itemFavoritesContext'
import { formatItemTag } from '@/lib/items'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import type { BackendTransport } from '@/lib/tshock'
import type { CompletionItem } from '@/lib/completion'
import type {
  Dataset,
  FavoriteEntry,
  Settings,
} from '@/types'

/** 聊天发言的字数上限：插件 `MaxChatLength`（`plugin/WebUI/Extras.cs`）与 `/api/chat` 一致。 */
const CHAT_MAX_LENGTH = 200

interface CommandPageProps {
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  settings: Settings
  /** 当前 TShock 上游 id；结果列表 / 聊天事件流按服务器分开。 */
  serverId: string
  players: string[]
  /** 是否允许执行 allowServer=false 的指令（走插件真实玩家模式）。 */
  ingameAllowed: boolean
  /** 当前登录玩家名（聊天预览里显示「谁说的」）。 */
  username?: string | null
  /** 运行时补全数据（区域 / 传送点，来自信使插件 /api/data）。 */
  runtimeValues?: { regions?: string[]; warps?: string[] }
  /** token 失效时被调用；返回 Promise，登录成功 resolve(true)，取消 resolve(false)。 */
  onTokenInvalid: () => Promise<boolean>
  /** 未登录时点「登录」打开登录框。 */
  onLogin: () => void
  /** 前往物品图鉴并显示该物品。 */
  onOpenInDex?: (itemId: number) => void
}

/** 宽屏阈值：与 `useMediaQuery` / Tailwind 的 `xl` 一致（`ItemsPage` / `DataIdPage` 同口径）。 */
const WIDE_QUERY = '(min-width: 1280px)'

/** 宽屏两栏的默认比例（结果 / 聊天，百分比）。拖动后会存在本机。 */
const SPLIT_DEFAULT: [number, number] = [65, 35]
/** 分栏比例的存储键：`react-resizable-panels` 自己会在 `autoSaveId` 前加库前缀。 */
const SPLIT_SAVE_ID = 'tswui:cmdSplit'
const SPLIT_STORAGE_KEY = `react-resizable-panels:${SPLIT_SAVE_ID}`

const NO_COMPLETIONS: CompletionItem[] = []

/**
 * 指令工作区（`#/cmd`）：**指令结果 + 聊天**共用一个输入框。
 *
 * 结构与游戏内一致——一个输入框，`/` 开头执行指令、其它文本发到游戏内聊天：
 * - 宽屏（≥1280px）：上面左右两栏（左结果 / 右聊天），两个面板各自滚动、各自贴底；
 * - 窄屏：顶部 tab 切「结果 / 聊天」，输入框两栏共用；
 * - 输入框上方一行：左侧是结果区动作（展开 / 折叠 / 清空），右侧是聊天的世界徽标 + 类型筛选。
 *
 * 聊天始终挂在页面上（窄屏只是 `hidden`），所以切 tab 不会重连事件流、也不会丢「最新一条」位置。
 */
export function CommandPage({
  dataset,
  transport,
  authenticated,
  settings,
  serverId,
  players,
  ingameAllowed,
  username,
  runtimeValues,
  onTokenInvalid,
  onLogin,
  onOpenInDex,
}: CommandPageProps) {
  const { t } = useI18n()
  // 宽屏并排、窄屏 tab：只影响「看哪块」，输入框与模式判定两边完全一致。
  const wide = useMediaQuery(WIDE_QUERY)
  const [view, setView] = useState<'results' | 'chat'>('results')
  // 聊天发送成功后让事件流立刻刷新（自己发的话马上上屏）。
  const [refreshToken, setRefreshToken] = useState(0)
  const [text, setText] = useLocalState(StorageKeys.draft, '')
  // 历史 / 结果与浮动终端共用同一份存储（见 hooks/useCommandHistory、useCommandResultsList）。
  const {
    history,
    push: pushHistory,
    remove: removeHistoryEntry,
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
  // 网页发言（`POST /api/chat`）：与「聊天」页同一套错误归类与成功提示。
  const chat = useChatSend({ transport, onSent: () => setRefreshToken((n) => n + 1) })
  // 工具弹框：开关 + 当前入口（指令库 / 物品）。每个入口内部的 tab 由弹框自己管。
  const [toolsOpen, setToolsOpen] = useState(false)
  const [group, setGroup] = useState<ToolGroup>('items')
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

  // 从首页「最新动态」/ 老地址 `#/chat` 过来：窄屏要直接落在聊天那一块（宽屏两栏同屏，无所谓）。
  // 用订阅而不是在 effect 里消费一次：信号可能在页面挂载**之前**就发出（冷启动打开 `#/chat`），
  // 也可能在挂载**之后**（就停在指令页时点首页的箭头）。
  useEditorViewRequest(setView)
  // 工具弹框是 popover：贴在点开的那个按钮旁边展开，所以要记下按钮的位置。
  const [toolsAnchor, setToolsAnchor] = useState<ToolsAnchorRect | null>(null)
  const openTools = useCallback(
    (nextGroup: ToolGroup, anchor?: ToolsAnchorRect | null) => {
      if (anchor) setToolsAnchor(anchor)
      setGroup(nextGroup)
      setToolsOpen(true)
    },
    [setGroup],
  )
  /** 关掉弹框就把焦点还给指令输入框（否则焦点会掉到 body / 触发按钮上）。 */
  const closeTools = useCallback(() => {
    setToolsOpen(false)
    focusEnd()
  }, [focusEnd])
  // 宽屏用 `height`（页面不滚，两栏各自滚）；窄屏用 `minHeight`（内容撑高、由 AppShell 整页滚）。
  const rootRef = useRef<HTMLDivElement>(null)
  const fillHeight = usePageHeight(rootRef, authenticated)
  // 聊天底部信息区（状态 / 筛选）与两块内容区的「↓ 最新」浮按钮挂载点：
  // 窄屏投到吸底输入区上方（页面级滚动时按钮才看得见），宽屏就地由各列表自己定位。
  // 分栏手柄：双击回到默认比例（拖坏了不用去清缓存）。
  const splitRef = useRef<ImperativePanelGroupHandle>(null)
  const resetSplit = useCallback(() => {
    try {
      localStorage.removeItem(SPLIT_STORAGE_KEY)
    } catch {
      /* 清不掉也不影响：下面直接设回去 */
    }
    splitRef.current?.setLayout([...SPLIT_DEFAULT])
  }, [])
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null)
  const [jumpSlot, setJumpSlot] = useState<HTMLElement | null>(null)
  const [resultsJumpSlot, setResultsJumpSlot] = useState<HTMLElement | null>(null)

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
  const { list: itemFavorites, api: favoritesApi } = useItemFavoritesState()

  // 前端执行策略 / 补全 / 参数提示：与浮动终端共用一份实现。
  const { check, getCompletions, getHelp } = useCommandEditing({
    dataset,
    text,
    players,
    language: settings.language,
    runtimeValues,
  })

  /**
   * 输入模式：与游戏内判定一致 —— 首字符 `/` 是指令，其余都是聊天。
   *
   * 空 / 纯空白按**指令**处理（这是指令模块的默认视角，占位文案与发送键也随之）。
   * `.` 目前**不**当指令：TShock 的 `CommandSilentSpecifier` 默认是 `.`（静默指令前缀），
   * 但 WebUI 只把 `/` 归一化成指令（`lib/commands.ts`），`.xx` 在这里按聊天发出去。
   */
  const chatMode = text.trim().length > 0 && !text.startsWith('/')

  /** 指令真正发出去后清空输入框（与浮动终端一致）；被前置校验拦下时保留原文，方便改后重发。 */
  const executeCommand = useCallback(() => {
    if (running) return
    const sent = text
    void runCommandText(sent).then((outcome) => {
      if (outcome.dispatched) setText((prev) => (prev === sent ? '' : prev))
    })
  }, [running, runCommandText, text, setText])

  /** 唯一的提交动作（Enter / Ctrl+Enter / 发送键）：按模式分派到执行指令或发到游戏内聊天。 */
  const submit = useCallback(() => {
    if (!chatMode) {
      executeCommand()
      return
    }
    const value = text.trim()
    if (!value || chat.sending) return
    void chat.send(value).then((ok) => {
      // 发送途中又敲了字就不清空（与「聊天」页一致）。
      if (ok) setText((prev) => (prev.trim() === value ? '' : prev))
    })
  }, [chat, chatMode, executeCommand, setText, text])

  const loadText = useCallback(
    (cmd: string) => {
      setText(cmd)
      // 从弹框里选完就收起弹框，把焦点交回输入框（空态里的「最近执行」按钮也走这里，本来就关着）。
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

  /** 把物品追加到输入末尾（物品 tab 里点收藏物品用），并把焦点移回输入框。 */
  const appendItem = useCallback(
    (snippet: string) => {
      setText((prev) => {
        const base = prev.replace(/\s+$/, '')
        return base ? `${base} ${snippet} ` : `${snippet} `
      })
      setToolsOpen(false)
      focusEnd()
    },
    [setText, focusEnd],
  )

  /** 合成表收藏里点一条 → 接在现有文本后面（前面有内容先补一个空格），焦点交回输入框。 */
  const appendRecipeText = useCallback(
    (snippet: string) => {
      setText((prev) => `${prev}${prev && !/\s$/.test(prev) ? ' ' : ''}${snippet}`)
      focusEnd()
    },
    [setText, focusEnd],
  )

  const emptyState = results.length === 0 && !running
  // 输入框上方「展开全部 / 折叠全部」：按当前折叠情况决定哪个可点。
  const anyCollapsed = results.some((entry) => entry.collapsed)
  const anyExpanded = results.some((entry) => !entry.collapsed)

  /** 切换工具弹框：点已打开的那个入口再点一下＝收起。 */
  const toggleTools = useCallback(
    (next: ToolGroup, anchor: ToolsAnchorRect) => {
      if (toolsOpen && group === next) {
        closeTools()
        return
      }
      openTools(next, anchor)
    },
    [toolsOpen, group, openTools, closeTools],
  )

  /** 从点击事件里取出按钮在视口里的位置（popover 的锚点）。 */
  const anchorFrom = (el: HTMLElement): ToolsAnchorRect => {
    const rect = el.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }

  /** 一个工具按钮（打开 / 收起对应面板），悬停出 Tooltip。 */
  const toolButton = ([value, Icon, label]: readonly [ToolGroup, LucideIcon, string]) => {
    const active = toolsOpen && group === value
    return (
      <EditorToolButton
        key={value}
        label={label}
        icon={Icon}
        active={active}
        pressed={active}
        aria-haspopup="dialog"
        onClick={(event) => toggleTools(value, anchorFrom(event.currentTarget))}
      />
    )
  }

  /** 输入框**左下角**：指令库 / 物品（写指令时查与插；聊天模式下物品只插 `[i:ID]`）。 */
  const toolButtons = (
    <div
      // `p-1 -m-1`：`overflow-x-auto` 会裁掉聚焦光圈（2px 画在按钮外面），留出余量就不切边了。
      className="-m-1 flex min-w-0 items-center gap-1 overflow-x-auto p-1"
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
  )

  /** 聊天发言失败：红字 + 「重试」，放在输入框左下角（不另起一行把输入区顶高）。 */
  const chatStatus = chat.error ? (
    <p className="flex min-w-0 flex-1 items-center gap-2 text-2xs text-destructive">
      <span className="min-w-0 truncate" title={chat.error}>
        {chat.error}
      </span>
      {text.trim().length > 0 && !chat.sending && (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-chip underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={submit}
        >
          {t('feed.chatRetry')}
        </button>
      )}
    </p>
  ) : null

  const commandComposer = (
    <>
      {/* 发送内容预览（贴在输入框上面）：指令把标签渲染成图标，聊天多出前缀 + 名字。 */}
      <SendPreview
        dataset={dataset}
        text={text}
        mode={chatMode ? 'chat' : 'command'}
        username={username}
        chatPrefix={chat.prefix}
      />
      <CommandEditor
        value={text}
        onChange={setText}
        // 聊天不需要补全 / 幽灵文字 / ↑↓ 回翻：传空实现，输入框行为完全回到普通打字。
        computeCompletions={chatMode ? () => NO_COMPLETIONS : getCompletions}
        getHelp={chatMode ? undefined : getHelp}
        onExecute={submit}
        busy={chatMode ? chat.sending : running}
        mode={chatMode ? 'chat' : 'command'}
        placeholder={chatMode ? t('feed.chatPlaceholder') : undefined}
        maxLength={chatMode ? CHAT_MAX_LENGTH : undefined}
        atlas={dataset.atlas}
        fontSize={settings.fontSize}
        invalid={!chatMode && check.executability === 'in_game_only' && !ingameAllowed}
        insertRequest={insertRequest}
        onInsertHandled={() => setInsertRequest(null)}
        focusRequest={focusSeq}
        history={chatMode ? undefined : history.map((h) => h.cmd)}
        leading={
          <>
            {toolButtons}
            {chatStatus}
          </>
        }
        slashToFocus
      />
    </>
  )

  /** 结果区**底部**的动作（展开全部 / 折叠全部 / 清空）：与聊天栏底部的信息区对称，图标居右。 */
  const resultsActions = results.length > 0 && (
    <div className="flex shrink-0 items-center justify-end gap-1 pt-1 pb-0.5">
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
    </div>
  )

  const resultsBody = emptyState ? (
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
      pageScroll={!wide}
      jumpSlot={wide ? null : resultsJumpSlot}
    />
  )

  /** 结果栏 = 列表（撑满）+ 底部动作行（图标居右，与聊天栏底部信息区对齐）。 */
  const resultsPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{resultsBody}</div>
      {resultsActions}
    </div>
  )

  const chatPane = (
    <ServerFeedTab
      transport={transport}
      authenticated={authenticated}
      serverId={serverId}
      refreshInterval={settings.eventsRefreshInterval}
      refreshToken={refreshToken}
      onTokenInvalid={onTokenInvalid}
      itemsById={dataset.itemsById}
      prefixesById={dataset.prefixesById}
      atlas={dataset.atlas}
      // 聊天栏底部信息区（状态文字 / 上次刷新 / [⟳] │ chips）：
      // 窄屏投到吸底输入区上方（随时可筛选），宽屏就地贴在这栏底部。
      footerVariant="stacked"
      footerSlot={wide ? null : footerSlot}
      jumpSlot={wide ? null : jumpSlot}
      pageScroll={!wide}
    />
  )

  /** 宽屏左右两栏；窄屏只显示当前 tab（另一块 `hidden`，不断事件流、不丢滚动位置）。 */
  return (
    <ItemFavoritesProvider api={favoritesApi}>
      <div
        ref={rootRef}
        data-testid="command-workspace"
        className="flex min-h-[360px] min-w-0 flex-col gap-3"
        style={fillHeight ? (wide ? { height: fillHeight } : { minHeight: fillHeight }) : undefined}
      >
        {!authenticated ? (
          <LoginGate onLogin={onLogin} />
        ) : (
          <div className={cn('flex min-w-0 flex-1 flex-col', wide && 'min-h-0')}>
            {wide ? (
              /* 宽屏：两个面板各自滚（页面本身不滚），下面钉着共享的输入框。
                 中间的分隔条可以**拖**（只改宽度）：拖完的位置存在本机，下次打开还是这个比例。 */
              <ResizablePanelGroup
                ref={splitRef}
                direction="horizontal"
                autoSaveId={SPLIT_SAVE_ID}
                className="min-h-0 min-w-0 flex-1"
              >
                <ResizablePanel
                  id="results"
                  order={1}
                  defaultSize={SPLIT_DEFAULT[0]}
                  minSize={35}
                  className="min-w-0"
                >
                  <CardBody className="flex h-full min-h-0 min-w-0 flex-col">{resultsPane}</CardBody>
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  className="mx-1.5"
                  // 双击恢复默认宽度（平时只显示一根细线，悬停才出把手）。
                  onDoubleClick={resetSplit}
                  title={t('editor.splitReset')}
                  aria-label={t('editor.splitReset')}
                />
                <ResizablePanel
                  id="chat"
                  order={2}
                  defaultSize={SPLIT_DEFAULT[1]}
                  minSize={22}
                  maxSize={55}
                  className="min-w-0"
                >
                  <CardBody className="flex h-full min-h-0 min-w-0 flex-col">{chatPane}</CardBody>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <>
                {/* 窄屏：并排塞不下，用 tab 切「看哪块」；输入框两栏共用。
                    吸在页头（`h-12`）下面：往上翻聊天记录时仍然能切 tab。 */}
                <div className="sticky top-12 z-10 flex min-w-0 items-center bg-background pb-1">
                  <ToggleGroup
                    type="single"
                    size="sm"
                    value={view}
                    onValueChange={(next) => {
                      if (!next) return
                      // 用户自己切了 tab：之前「跳到某一块」的意图作废。
                      clearEditorViewRequest()
                      setView(next as 'results' | 'chat')
                    }}
                    className="w-full"
                    aria-label={t('editor.view')}
                  >
                    <ToggleGroupItem value="results">
                      {t('editor.view.results')}
                      {results.length > 0 && (
                        <span className="text-2xs tabular-nums text-muted-foreground">
                          {results.length}
                        </span>
                      )}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="chat">{t('editor.view.chat')}</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <CardBody
                  className={cn(
                    // 两块都常驻：聊天切走只是隐藏，事件流 / 贴底位置不会重来。
                    'min-w-0 flex-1 flex-col',
                    view === 'results' ? 'flex' : 'hidden',
                  )}
                >
                  {resultsPane}
                </CardBody>
                <CardBody
                  className={cn('min-w-0 flex-1 flex-col', view === 'chat' ? 'flex' : 'hidden')}
                >
                  {chatPane}
                </CardBody>
              </>
            )}

            {/* 输入框 + 它上面那一行：钉在工作区底部（窄屏 `sticky`，宽屏页面不滚所以就是最后一块）。
                `-mb-2` 抵消 AppShell 的 `p-2`，滚到最底时不会突然多出 8px 空隙。 */}
            <div
              className={cn(
                'relative z-10 flex shrink-0 flex-col bg-background',
                wide
                  ? 'pt-2'
                  : 'sticky bottom-0 -mb-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
              )}
            >
              {/* 「回到底部」浮按钮的宿主：只在窄屏「聊天」tab 下存在，
                  否则隐藏的聊天栏会把这个按钮投到看得见的结果 tab 上。 */}
              {/* 「↓ 最新」浮按钮的宿主：只给当前可见的那一栏（否则隐藏的那栏也会投进来）。 */}
              {!wide && (
                <div
                  ref={view === 'chat' ? setJumpSlot : setResultsJumpSlot}
                  data-testid="jump-slot"
                  className="pointer-events-none absolute inset-x-0 -top-10 flex justify-center"
                />
              )}
              {!wide && view === 'chat' && (
                /* 聊天底部信息区（状态行 + 筛选）：贴在输入框正上方。 */
                <div ref={setFooterSlot} className="flex min-w-0 flex-col empty:hidden" />
              )}
              {commandComposer}
            </div>
          </div>
        )}

        <CommandToolsDialog
          open={toolsOpen}
          anchorRect={toolsAnchor}
          onOpenChange={(next) => (next ? setToolsOpen(true) : closeTools())}
          group={group}
          dataset={dataset}
          favorites={favorites}
          itemFavorites={itemFavorites}
          history={history}
          onLoad={loadText}
          onInsert={insertText}
          // 聊天里只插 `[i:ID]`（聊天看得到物品图标的唯一写法）。
          itemTagOnly={chatMode}
          onOpenInDex={
            onOpenInDex
              ? (itemId) => {
                  setToolsOpen(false)
                  onOpenInDex(itemId)
                }
              : undefined
          }
          onInsertItemFavorite={(id) => {
            // 只把 ID（或聊天里的 `[i:ID]`）追到输入里；**不**删收藏（同一件东西常常要发好几次）。
            appendItem(chatMode ? formatItemTag(id) : String(id))
          }}
          onPickRecipe={appendRecipeText}
          onRemoveFavorite={removeFavorite}
          onRemoveHistory={removeHistory}
          onClearHistory={clearHistory}
        />
      </div>
    </ItemFavoritesProvider>
  )
}
