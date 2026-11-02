import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BookOpen, Hammer, History, Star, Tag, Terminal, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { CommandPickerPanel } from '@/components/CommandPickerPanel'
import { FavoriteRecipesPanel } from '@/components/FavoriteRecipesPanel'
import { ConfirmButton } from '@/components/ConfirmButton'
import { HistoryPanel } from '@/components/command/HistoryPanel'
import { useLocalState } from '@/hooks/useLocalState'
import { HISTORY_LIMIT } from '@/lib/history'
import { useToolsMemory } from '@/hooks/useToolsMemory'
import { useRecipeFavoritesState } from '@/hooks/useRecipeFavoritesState'
import { StorageKeys } from '@/lib/storage'
import { ItemSearchPanel } from '@/components/ItemSearchPanel'
import {
  Button,
  PANEL_POPOVER_WIDTH,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { Dataset, FavoriteEntry, HistoryEntry, ItemFavorite } from '@/types'

/** 输入框左下角的两个工具入口（每个入口内部再分 tab）。 */
export type ToolGroup = 'commands' | 'items'

/** 弹框里的 tab（`commands` 组 = 指令库 / 收藏 / 历史，`items` 组 = 物品 / 合成表）。 */
export type ToolsTab = 'commands' | 'favorites' | 'history' | 'items' | 'recipes'

const TABS_BY_GROUP: Record<ToolGroup, ToolsTab[]> = {
  commands: ['commands', 'favorites', 'history'],
  items: ['items', 'recipes'],
}

/**
 * tab 用**图标**代替文字（省一行宽度，三个 tab 在手机上也排得下）。
 * 顺序与用户约定一致：指令库 `terminal` → 收藏 `star` → 历史 `rotate-ccw-clock`；
 * 物品入口：物品 `book-open` → 合成表 `hammer`。
 */
const TAB_ICON: Record<ToolsTab, LucideIcon> = {
  commands: Terminal,
  favorites: Star,
  history: History,
  items: BookOpen,
  recipes: Hammer,
}

/**
 * 指令库 tab 栏上的**常用指令**快捷徽标：点一下把指令填进输入框，悬停看官方说明
 * （说明取自 `data/commands.json` 的 `helpZh` / `help`，不另写文案）。
 * 按钮走 `ghost`：一排安静的入口，不抢列表内容。
 */
const QUICK_COMMANDS = ['help', 'who', 'bossdamage', 'alldeath'] as const

/** 触发按钮的位置（视口坐标）：popover 贴在这个按钮上展开。 */
export interface ToolsAnchorRect {
  left: number
  top: number
  width: number
  height: number
}

interface CommandToolsDialogProps {
  open: boolean
  /** 由哪个工具按钮打开（决定默认 tab 与 tab 集合）。 */
  group: ToolGroup
  /** 点开的那个工具按钮的位置；缺省时退化为贴左侧展开。 */
  anchorRect?: ToolsAnchorRect | null
  /** 关闭（Esc / × / 点遮罩 / 选完自动关）后由页面把焦点交回指令输入框。 */
  onOpenChange: (open: boolean) => void
  dataset: Dataset
  favorites: FavoriteEntry[]
  itemFavorites: ItemFavorite[]
  history: HistoryEntry[]
  /** 用指令替换输入框内容。 */
  onLoad: (cmd: string) => void
  /** 把文本插入输入框（物品 ID / 名称 / 标签）。 */
  onInsert: (text: string) => void
  /** 前往物品图鉴。 */
  onOpenInDex?: (itemId: number) => void
  /** 点收藏物品：把 ID 追加到输入框（收藏记录保留）。 */
  onInsertItemFavorite: (itemId: number) => void
  /**
   * 物品面板只插 `[i:ID]` 标签（聊天模式用：聊天里只有标签能显示成物品图标）。
   */
  itemTagOnly?: boolean
  /** 合成表 tab：选中一条收藏的合成记录（文本由面板生成）。 */
  onPickRecipe?: (text: string) => void
  onRemoveFavorite: (cmd: string) => void
  onRemoveHistory: (entry: HistoryEntry) => void
  onClearHistory: () => void
}

/**
 * 指令页的工具面板，以**弹框**形式出现（指令库 / 物品）。
 *
 * - 就是一个 **popover**：贴在点击的那个工具按钮旁边向上展开（Radix Popover 的碰撞检测会
 *   翻转 / 平移，不跑出视口），背景不变暗、页面照常可操作，点弹框外面就收起；
 * - 输入框左下角只有两个入口（指令库 / 物品），**每个入口内部的切换靠弹框底部的 tab**：
 *   指令库 = 指令库 / 收藏 / 历史，物品 = 物品 / 合成表。tab 放底部，内容在上，搜索框不会被挤下去；
 * - 打开时焦点直接落到当前面板的搜索框（弹框里第一个 `input`），
 *   所以打开后可以直接打字筛选，不用先点一下；
 * - 关闭时把焦点交给页面（页面会还给指令输入框），不让焦点掉到 `body`；
 * - 弹框开着时页面的 `/` 快捷键不生效（见 `CommandEditor` 的 `slashToFocus`），
 *   `/` 会被当作普通字符打进搜索框（搜索会忽略前导 `/`）。
 */
export function CommandToolsDialog({
  open,
  group,
  anchorRect,
  onOpenChange,
  dataset,
  favorites,
  itemFavorites,
  history,
  onLoad,
  onInsert,
  onOpenInDex,
  onInsertItemFavorite,
  itemTagOnly = false,
  onPickRecipe,
  onRemoveFavorite,
  onRemoveHistory,
  onClearHistory,
}: CommandToolsDialogProps) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement>(null)
  // 合成表收藏（本机存储，图鉴的 ⭐ 收藏是同一份数据）。
  const { list: recipeFavorites } = useRecipeFavoritesState()
  // 合成记录要不要显示物品名称：跟「物品 ID」页 → 合成记录 →「显示物品名称」共用同一个本机开关。
  const [showRecipeNames] = useLocalState<boolean>(StorageKeys.dexRecipeShowNames, false)
  /**
   * 「标签模式」：物品 tab 上的一个按压开关。开启后点物品条目直接追加 `[i:物品ID]`，
   * 关掉就是原来的行为（`/give 29` 这种插裸 ID）。存本机，开一次一直有效。
   */
  const [tagMode, setTagMode] = useLocalState<boolean>(StorageKeys.itemTagMode, false)
  const tabs = TABS_BY_GROUP[group]
  const { memory, patch } = useToolsMemory()
  // 上次停的那个 tab（必须属于当前入口，否则退回第一个）。
  const remembered = memory.tab[group]
  const initialTab = (tabs as ToolsTab[]).includes(remembered as ToolsTab)
    ? (remembered as ToolsTab)
    : tabs[0]
  const [tab, setTab] = useState<ToolsTab>(initialTab)

  // 换入口 / 重新打开：回到该入口**上次停的那个** tab（换过入口就按新入口的记忆）。
  useEffect(() => {
    if (!open) return
    const next = memory.tab[group]
    setTab((tabs as ToolsTab[]).includes(next as ToolsTab) ? (next as ToolsTab) : tabs[0])
    // 只在打开 / 换入口时读一次记忆；用户切 tab 不该被「记忆」再拉回去。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group])

  /** 焦点给当前面板的搜索框（它就是弹框里第一个 `input`），打开 / 换面板后都能直接打字。 */
  const focusSearch = () => {
    const firstInput = contentRef.current?.querySelector<HTMLElement>('input')
    if (firstInput) firstInput.focus()
    else contentRef.current?.focus()
  }

  // 换 tab / 换入口：旧面板卸载、新面板挂载，焦点会掉在弹框容器或 body 上，这里接回搜索框。
  // （打开时的那次聚焦走 `onOpenAutoFocus`：Radix 的 Portal 要等一拍才把内容挂上，
  //  这里在开的那一帧还拿不到 ref，所以不在这里处理打开。）
  // `group` 也要跟着：在「指令库」开着时点「物品」，tab 会连带到 `items`，但 Radix 的
  // 关闭 / 重开有一拍延迟，只在 `tab` 变化时聚焦会输给 `body`。
  useEffect(() => {
    if (!open) return
    // 等这一帧的挂载 / 卸载走完再聚焦：换入口时旧面板先卸载，立刻聚焦会落在将被移除的 input 上，
    // 焦点最后掉到 `body`（表现为「换入口后打字没反应」）。
    const id = requestAnimationFrame(() => focusSearch())
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, group, open])

  const TAB_LABEL: Record<ToolsTab, string> = {
    commands: t('editor.tab.commands'),
    favorites: t('editor.tab.favorites'),
    history: t('editor.tab.history'),
    items: t('editor.tab.items'),
    recipes: t('editor.tab.recipes'),
  }

  /** 常用指令 + 它们的说明（查不到定义时退回指令名，不编造文案）。 */
  const quickCommands = useMemo(
    () =>
      QUICK_COMMANDS.map((token) => {
        const def = dataset.commandsByToken.get(token)
        return {
          token,
          label: `/${token}`,
          help: def ? (def.helpZh ?? def.help) : '',
        }
      }),
    [dataset.commandsByToken],
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* 隐形锚点：就是被点的那个工具按钮，popover 据此定位（不是居中弹框）。 */}
      <PopoverAnchor asChild>
        <div
          aria-hidden
          data-slot="tools-anchor"
          className="pointer-events-none fixed"
          style={{
            left: anchorRect?.left ?? 0,
            top: anchorRect?.top ?? 0,
            width: anchorRect?.width ?? 0,
            height: anchorRect?.height ?? 0,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        // 没有可见标题，但读屏需要名字。
        aria-label={t('editor.panel')}
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className={cn(
          'flex flex-col gap-0 p-2',
          // 高度跟着可用空间走（Radix 的碰撞检测给出的可用高度），不会顶出屏幕。
          'h-[min(34rem,70dvh)] max-h-[var(--radix-popper-available-height)]',
          PANEL_POPOVER_WIDTH,
          'max-w-none overflow-hidden',
        )}
        // 拦下 Radix 的默认聚焦（它会聚焦第一个可 Tab 的元素），改为直接聚焦打开后的搜索框。
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusSearch()
        }}
        // 焦点由页面还给指令输入框：这里必须拦下，否则会掉回触发按钮 / body。
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <TooltipProvider delayDuration={300}>
        <Tabs
          value={tab}
          onValueChange={(next) => {
            setTab(next as ToolsTab)
            patch((prev) => ({ ...prev, tab: { ...prev.tab, [group]: next as ToolsTab } }))
          }}
          className="flex h-full min-h-0 flex-col gap-1"
        >
          {/* 面板外包一层 `p-1`：搜索框的聚焦光圈画在框外 2–3px，
              贴着 `overflow-hidden` 的边就会被切掉（两边看着像被剪断）。 */}
          <TabsContent value="commands" className="min-h-0 flex-1 overflow-hidden p-1">
            <CommandPickerPanel view="commands" dataset={dataset} onLoad={onLoad} />
          </TabsContent>
          <TabsContent value="favorites" className="min-h-0 flex-1 overflow-hidden p-1">
            <CommandPickerPanel
              view="favorites"
              dataset={dataset}
              favorites={favorites}
              onRemoveFavorite={onRemoveFavorite}
              onLoad={onLoad}
            />
          </TabsContent>
          <TabsContent value="history" className="min-h-0 flex-1 overflow-hidden p-1">
            <HistoryPanel history={history} onLoad={onLoad} onRemove={onRemoveHistory} />
          </TabsContent>
          <TabsContent value="items" className="min-h-0 flex-1 overflow-hidden p-1">
            <ItemSearchPanel
              dataset={dataset}
              onInsert={onInsert}
              onOpenInDex={onOpenInDex}
              favorites={itemFavorites}
              onInsertFavorite={onInsertItemFavorite}
              tagOnly={itemTagOnly}
              tagMode={tagMode}
            />
          </TabsContent>
          <TabsContent value="recipes" className="min-h-0 flex-1 overflow-hidden p-1">
            <FavoriteRecipesPanel
              dataset={dataset}
              favorites={recipeFavorites}
              iconOnly={!showRecipeNames}
              onPick={onPickRecipe ?? (() => {})}
            />
          </TabsContent>

          {/* tab 在底部：内容区先占满，切 tab 时搜索框位置不跳。
              左边是图标 tab，右边（仅指令库入口）是几个常用指令的快捷徽标。 */}
          <div className="flex h-8 shrink-0 items-center gap-2">
            <TabsList className="h-8 justify-start gap-1">
              {tabs.map((value) => {
                const Icon = TAB_ICON[value]
                return (
                  // tab 只有图标：悬停出 Tooltip（原生 `title` 太慢，和别处的图标按钮不一致）。
                  // 触发器是**图标外面的 span**，不是 TabsTrigger 本身 —— 两个 Radix primitive 都会写
                  // `data-state`，把 TabsTrigger 包成 TooltipTrigger 会让选中态（`data-state=active`）被覆盖。
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="flex-none px-2.5"
                    aria-label={TAB_LABEL[value]}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Icon aria-hidden />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">{TAB_LABEL[value]}</TooltipContent>
                    </Tooltip>
                  </TabsTrigger>
                )
              })}
            </TabsList>
            {/* 物品入口 →「物品」tab：右侧一个按压开关（切到「合成表」时不显示）。
                按钮文字直接写「点下去会做什么」：没按下 = 插入ID，按下 = 插入标签。 */}
            {group === 'items' && tab === 'items' && (
              <div className="ml-auto flex shrink-0 items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Toggle
                      size="sm"
                      pressed={tagMode}
                      onPressedChange={setTagMode}
                      aria-label={tagMode ? t('items.tagMode') : t('items.tagModeId')}
                    >
                      <Tag aria-hidden />
                      {tagMode ? t('items.tagMode') : t('items.tagModeId')}
                    </Toggle>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64 text-balance">
                    {t('items.tagModeHint')}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
            {/* 只在「指令库」这一页显示：切到收藏 / 历史时右侧不占位（那两页是纯列表，不需要入口）。 */}
            {/* 历史页：条数上限 + 清空，放在 tab 栏右侧（与「指令库」的常用指令同一位置），
                不再单独占一行。 */}
            {group === 'commands' && tab === 'history' && (
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <span className="text-2xs text-muted-foreground tabular-nums">
                  {t('editor.historyNoteShort', { n: HISTORY_LIMIT })}
                </span>
                <ConfirmButton
                  size="icon-xs"
                  confirmLabel={t('action.clearConfirm')}
                  className="text-muted-foreground hover:text-foreground"
                  onConfirm={onClearHistory}
                  icon={<Trash2 data-icon="inline-start" />}
                  aria-label={t('editor.historyClear')}
                  title={t('editor.historyClear')}
                />
              </div>
            )}
            {group === 'commands' && tab === 'commands' && (
              <div className="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto">
                {quickCommands.map((qc) => (
                  <Tooltip key={qc.token}>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 shrink-0 px-2 font-pixel text-2xs text-muted-foreground"
                        onClick={() => onLoad(`/${qc.token}`)}
                      >
                        {qc.label}
                      </Button>
                    </TooltipTrigger>
                    {qc.help && (
                      <TooltipContent side="top" className="max-w-64 text-balance">
                        {qc.help}
                      </TooltipContent>
                    )}
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        </Tabs>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  )
}
