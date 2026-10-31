import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { CommandPickerPanel } from '@/components/CommandPickerPanel'
import { HistoryPanel } from '@/components/command/HistoryPanel'
import { ItemSearchPanel } from '@/components/ItemSearchPanel'
import { PANEL_POPOVER_WIDTH, Popover, PopoverAnchor, PopoverContent } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { Dataset, FavoriteEntry, HistoryEntry, ItemFavorite } from '@/types'

/** 工具弹框的四个 tab（顺序即 tab 顺序：指令库在最左）。 */
export type ToolTab = 'commands' | 'items' | 'favorites' | 'history'

/** 触发按钮的位置（视口坐标）：popover 贴在这个按钮上展开。 */
export interface ToolsAnchorRect {
  left: number
  top: number
  width: number
  height: number
}

interface CommandToolsDialogProps {
  open: boolean
  /** 点开的那个工具按钮的位置；缺省时退化为贴左侧展开。 */
  anchorRect?: ToolsAnchorRect | null
  /** 关闭（Esc / × / 点遮罩 / 选完自动关）后由页面把焦点交回指令输入框。 */
  onOpenChange: (open: boolean) => void
  tab: ToolTab
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
  onRemoveFavorite: (cmd: string) => void
  onClearFavorites: () => void
  onRemoveHistory: (entry: HistoryEntry) => void
  onDedupeHistory: () => void
  onClearHistory: () => void
}

/**
 * 指令页的工具面板，以**弹框**形式出现（指令库 / 物品 / 收藏 / 历史）。
 *
 * - 就是一个 **popover**：贴在点击的那个工具按钮旁边向上展开（Radix Popover 的碰撞检测会
 *   翻转 / 平移，不跑出视口），背景不变暗、页面照常可操作，点弹框外面就收起；
 *
 * - **没有 tab 栏**：面板由输入框左下角的四个工具按钮切换（再点按钮就是换面板 / 收起），
 *   弹框里只渲染当前那一块，省下一行高度；
 * - 打开时焦点直接落到当前面板的搜索框（弹框里第一个 `input`），
 *   所以打开后可以直接打字筛选，不用先点一下；
 * - 关闭时把焦点交给页面（页面会还给指令输入框），不让焦点掉到 `body`；
 * - 弹框开着时页面的 `/` 快捷键不生效（见 `CommandEditor` 的 `slashToFocus`），
 *   `/` 会被当作普通字符打进搜索框（搜索会忽略前导 `/`）。
 */
export function CommandToolsDialog({
  open,
  anchorRect,
  onOpenChange,
  tab,
  dataset,
  favorites,
  itemFavorites,
  history,
  onLoad,
  onInsert,
  onOpenInDex,
  onInsertItemFavorite,
  onRemoveFavorite,
  onClearFavorites,
  onRemoveHistory,
  onDedupeHistory,
  onClearHistory,
}: CommandToolsDialogProps) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement>(null)

  /** 焦点给当前面板的搜索框（它就是弹框里第一个 `input`），打开 / 换面板后都能直接打字。 */
  const focusSearch = () => {
    const firstInput = contentRef.current?.querySelector<HTMLElement>('input')
    if (firstInput) firstInput.focus()
    else contentRef.current?.focus()
  }

  // 换面板（点输入框左下角另一个工具按钮）：旧面板卸载、新面板挂载，焦点会掉在弹框容器上，这里接回搜索框。
  // （打开时的那次聚焦走 `onOpenAutoFocus`：Radix 的 Portal 要等一拍才把内容挂上，
  //  这里在开的那一帧还拿不到 ref，所以不在这里处理打开。）
  useEffect(() => {
    if (!open) return
    focusSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

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
          'flex flex-col gap-2 p-2',
          // 高度跟着可用空间走（Radix 的碰撞检测给出的可用高度），不会顶出屏幕。
          'h-[min(34rem,70dvh)] max-h-[var(--radix-popper-available-height)]',
          PANEL_POPOVER_WIDTH,
          'max-w-none overflow-hidden',
        )}
        // 拦下 Radix 的默认聚焦（它会聚焦第一个可 Tab 的元素，也就是 tab 按钮），
        // 改为直接聚焦打开后的搜索框。
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusSearch()
        }}
        // 焦点由页面还给指令输入框：这里必须拦下，否则会掉回触发按钮 / body。
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex h-full min-h-0 flex-col">
          {/* 面板外包一层 `p-1`：搜索框的聚焦光圈画在框外 2–3px，
              贴着 `overflow-hidden` 的边就会被切掉（两边看着像被剪断）。 */}
          <div className="min-h-0 flex-1 overflow-hidden p-1">
            {tab === 'commands' && (
              <CommandPickerPanel view="commands" dataset={dataset} onLoad={onLoad} />
            )}
            {tab === 'items' && (
              <ItemSearchPanel
                dataset={dataset}
                onInsert={onInsert}
                onOpenInDex={onOpenInDex}
                favorites={itemFavorites}
                onInsertFavorite={onInsertItemFavorite}
              />
            )}
            {tab === 'favorites' && (
              <CommandPickerPanel
                view="favorites"
                dataset={dataset}
                favorites={favorites}
                onRemoveFavorite={onRemoveFavorite}
                onClearFavorites={onClearFavorites}
                onLoad={onLoad}
              />
            )}
            {tab === 'history' && (
              <HistoryPanel
                history={history}
                onLoad={onLoad}
                onRemove={onRemoveHistory}
                onDedupe={onDedupeHistory}
                onClear={onClearHistory}
              />
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
