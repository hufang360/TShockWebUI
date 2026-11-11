import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, Copy, History, Search, Terminal as TerminalIcon, X, type LucideIcon } from 'lucide-react'
import { BuffIcon } from '@/components/BuffIcon'
import { IconAction } from '@/components/IconAction'
import { ItemIcon } from '@/components/ItemIcon'
import { NpcSprite } from '@/components/NpcSprite'
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
  InputGroup,
  InputGroupAddon,
  Kbd,
  Spinner,
} from '@/components/ui'
import { toast } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useSearchHistory } from '@/hooks/useSearchHistory'
import { useIsMobile } from '@/hooks/use-mobile'
import { searchEverything, type GlobalSearchSources, type SearchGroupId, type SearchHit } from '@/lib/globalSearch'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/keyboard'
import type { SearchIntent } from '@/lib/searchIntent'
import { StorageKeys } from '@/lib/storage'
import { useTerminal } from '@/lib/terminalContext'
import type { CommandResult, TabId } from '@/types'

/**
 * 全局搜索（`docs/计划-全局搜索.md`、`docs/功能-全局搜索.md`）。
 *
 * **只有一套界面**：一个居中弹框，桌面与移动端共用。
 * - 桌面入口：侧栏页头第二行那个「像搜索框的按钮」（`GlobalSearchTrigger`），点它或按 `Ctrl/Cmd+K` 打开；
 *   侧栏收起时快捷键照样能用（不需要先展开侧栏）。
 * - 移动端入口：内容区顶栏的搜索图标（侧栏是抽屉，点里面的入口会叠两层遮罩）。
 *
 * 结果列表用 shadcn `Command`（cmdk）：分组、键盘导航、`aria-activedescendant` 由它管；
 * **排序与匹配不交给 cmdk**（`shouldFilter={false}`），我们按域分组 + 固定组顺序 + 自己的打分。
 * 物品就地弹「物品详情」；其余跳页并带预填意图（`lib/searchIntent.ts`）。
 */

const GROUP_LABEL: Record<SearchGroupId, string> = {
  pages: 'search.group.pages',
  items: 'search.group.items',
  commands: 'search.group.commands',
  npcs: 'search.group.npcs',
  buffs: 'search.group.buffs',
  tiles: 'search.group.tiles',
  walls: 'search.group.walls',
  goods: 'search.group.goods',
  collections: 'search.group.collections',
}

function runHit(
  hit: SearchHit,
  onNavigate: (tab: TabId, intent?: SearchIntent) => void,
  onOpenItem: (itemId: number) => void,
): void {
  if (hit.action.kind === 'item') {
    onOpenItem(hit.action.itemId)
    return
  }
  if (hit.action.kind === 'page') {
    onNavigate(hit.action.tab)
    return
  }
  onNavigate(hit.action.tab, hit.action.intent)
}

/**
 * 已有浮层时还该不该抢 Ctrl/Cmd+K。
 *
 * **只挡模态弹框**（登录 / 确认 / 物品详情弹框 / 搜索弹框本身）——那些是真“任务中”。
 * 抽屉 / 侧栏 / Popover（商品详情、图鉴详情的堆叠抽屉、页面设置面板…）不挡：
 * 用户会边看详情边搜别的，强迫先关掉再搜很难受；搜索弹框的层级（z-50）本来就盖在它们上面。
 */
function hasOpenOverlay(): boolean {
  return Boolean(document.querySelector('[data-slot="dialog-content"]'))
}

function HitIcon({ hit, sources }: { hit: SearchHit; sources: GlobalSearchSources }) {
  const icon = hit.icon
  if (!icon) return <span aria-hidden className="size-6 shrink-0" />
  if (icon.kind === 'item') {
    return (
      <ItemIcon
        item={sources.dataset.itemsById.get(icon.itemId)}
        atlas={sources.dataset.atlas}
        size={24}
        tooltip={false}
      />
    )
  }
  if (icon.kind === 'npc') return <NpcSprite id={icon.id} size={24} />
  if (icon.kind === 'buff') return <BuffIcon id={icon.id} size={24} />
  const LucideGlyph = icon.icon
  return <LucideGlyph aria-hidden className="size-4 shrink-0 text-muted-foreground" />
}

interface ResultGroupsProps {
  query: string
  groups: ReturnType<typeof searchEverything>
  sources: GlobalSearchSources
  onPick: (hit: SearchHit) => void
  onNavigate: (tab: TabId, intent?: SearchIntent) => void
  /** 行内「复制」（ID / 指令）。 */
  onCopy: (text: string) => void
  /** 行内「填入浮动终端」（只有指令行有）。 */
  onFillTerminal: (command: string) => void
  /** 浮动终端当前不可用（未登录 / 未开启）时，不显示「填入终端」，避免点了没反应。 */
  canFillTerminal: boolean
}

/**
 * 行内操作按钮。
 *
 * 为什么是 `span` + `onClick` 而不是 `<button>`：cmdk 的行是 `role="option"`，ARIA 规定其子元素
 * 都是「呈现型」的，放真按钮屏幕阅读器也读不到。所以这里做成**鼠标**辅助（`aria-hidden`），
 * 键盘路径是 `Enter` 打开该行（详情 / 数据 ID / 指令小抄页里都有复制入口）。
 */
function RowAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
}) {
  return (
    <span
      aria-hidden
      role="presentation"
      title={label}
      onClick={(event) => {
        // 阻止冒泡，否则这一行会被当成「选中」并执行主操作。
        event.stopPropagation()
        onClick()
      }}
      className="flex size-5 cursor-pointer items-center justify-center rounded-chip text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </span>
  )
}

/** 「全部」跳转的目标页面名（取侧栏导航的当前语言文案）。 */
function pageLabelOf(sources: GlobalSearchSources, tab: TabId): string {
  return sources.pages.find((page) => page.id === tab)?.label ?? tab
}

/** 有搜索词时的结果：分组 + 每组的「全部」出口 + 空态（在 `CommandList` 里）。 */
function ResultGroups({
  query,
  groups,
  sources,
  onPick,
  onNavigate,
  onCopy,
  onFillTerminal,
  canFillTerminal,
}: ResultGroupsProps) {
  const { t } = useI18n()
  return (
    <>
      {groups.map((group) => (
        <CommandGroup key={group.id} heading={t(GROUP_LABEL[group.id])}>
          {group.hits.map((hit) => (
            <CommandItem
              key={hit.id}
              value={hit.id}
              onSelect={() => onPick(hit)}
              className="group/hit"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                <HitIcon hit={hit} sources={sources} />
              </span>
              <span className="min-w-0 flex-1 truncate">{hit.name}</span>
              {hit.meta && (
                // 真正贴右（名字 `flex-1` 吃掉剩余空间，不在右侧留预留位）。
                // 悬停 / 高亮时淡出，把位置让给下面的操作按钮。
                <span className="max-w-[45%] shrink-0 truncate text-2xs text-muted-foreground transition-opacity group-hover/hit:opacity-0 group-data-[selected=true]/hit:opacity-0">
                  {hit.meta}
                </span>
              )}
              {/* 操作按钮**浮在右侧元素的位置上**（绝对定位，不占布局）：
                  既不会把 ID 挤到左边，也不会在右侧留一条空白。 */}
              <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover/hit:opacity-100 group-data-[selected=true]/hit:opacity-100">
                {hit.copy && (
                  <RowAction
                    label={t(hit.command ? 'search.action.copyCommand' : 'search.action.copyId')}
                    icon={Copy}
                    onClick={() => onCopy(hit.copy!)}
                  />
                )}
                {hit.command && canFillTerminal && (
                  <RowAction
                    label={t('search.action.fillTerminal')}
                    icon={TerminalIcon}
                    onClick={() => onFillTerminal(hit.command!)}
                  />
                )}
              </span>
            </CommandItem>
          ))}
          {group.seeAll && (
            <CommandItem
              value={`${group.id}:see-all`}
              onSelect={() => onNavigate(group.seeAll!.tab, group.seeAll!.intent)}
              className="gap-1.5 py-1 text-2xs text-muted-foreground"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                <ArrowRight aria-hidden className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {/* 明确写着会去哪个页面，别只写「全部」（用户不知道点了会发生什么）。 */}
                {t('search.global.seeAllIn', { page: pageLabelOf(sources, group.seeAll!.tab) })}
              </span>
            </CommandItem>
          )}
        </CommandGroup>
      ))}
      {groups.length === 0 && (
        <CommandEmpty>{t('search.global.noResults', { query: query.trim() })}</CommandEmpty>
      )}
    </>
  )
}

interface RunViewProps {
  command: string
  /** `null` = 还在执行。 */
  result: CommandResult | null
  onBack: () => void
}

/** 二级页：指令执行结果（留在弹框里，不跳页）。 */
function RunView({ command, result, onBack }: RunViewProps) {
  const { t } = useI18n()
  return (
    <div className="flex max-h-[inherit] flex-col" data-testid="global-search-run">
      <div className="flex items-center gap-2 px-1 py-1">
        <Button variant="ghost" size="sm" onClick={onBack} autoFocus>
          <ChevronLeft data-icon="inline-start" />
          {t('action.back')}
        </Button>
        <code className="ml-auto truncate text-2xs text-muted-foreground">{command}</code>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {result === null ? (
          <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Spinner aria-hidden />
            {t('editor.running')}
          </p>
        ) : (
          <>
            {result.message && <p className="py-1 text-xs text-destructive">{result.message}</p>}
            {result.output.length === 0 && !result.message ? (
              <p className="py-1 text-xs text-muted-foreground">{t('result.noOutput')}</p>
            ) : (
              <pre className="py-1 font-mono text-xs whitespace-pre-wrap text-foreground">
                {result.output.join('\n')}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface RecentGroupProps {
  history: string[]
  onRecent: (value: string) => void
  onRemove: (value: string) => void
}

/** 最近搜索行的 `value` 前缀（和真实命中区分，也方便反解出关键词）。 */
const RECENT_PREFIX = 'recent:'
const recentValue = (query: string) => `${RECENT_PREFIX}${query}`
const queryOfRecent = (value: string | null | undefined) =>
  value && value.startsWith(RECENT_PREFIX) ? value.slice(RECENT_PREFIX.length) : null

/**
 * 最近搜索（空查询时）：和结果一样是 cmdk 的 `option`，所以 `↑` / `↓` 能选中、`Enter` 填入。
 *
 * 行尾的 ✕ 只是一个**鼠标**辅助：`role="option"` 里不能再放按钮（ARIA），所以它是带 `onClick` 的
 * `aria-hidden` 元素；键盘用户走 `Delete` / `Backspace`（见弹框的 `onKeyDown`），不依赖这个 ✕。
 */
function RecentGroup({ history, onRecent, onRemove }: RecentGroupProps) {
  const { t } = useI18n()
  return (
    <CommandGroup heading={t('search.recent')}>
      {history.slice(0, 5).map((value) => (
        <CommandItem
          key={value}
          value={recentValue(value)}
          onSelect={() => onRecent(value)}
          className="group/recent"
        >
          <History aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{value}</span>
          <span
            aria-hidden
            data-recent-remove=""
            title={t('search.remove')}
            onClick={(event) => {
              // 阻止冒泡，否则 cmdk 会把这一行当成「选中」。
              event.stopPropagation()
              onRemove(value)
            }}
            className={cn(
              // 只在悬停 / 键盘选中时出现，且绝对定位：平时不占位、不给这行加视觉重量
              // （键盘用户的删除键是 `Delete`）。
              'absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-control p-0.5 text-muted-foreground opacity-0 transition-opacity',
              'hover:text-foreground group-hover/recent:opacity-100 group-data-[selected=true]/recent:opacity-100',
            )}
          >
            <X className="size-3.5" />
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/** 输入词 / 结果 / 最近搜索（高亮由 cmdk 管，这里只管数据和写历史）。 */
function useSearchState(sources: GlobalSearchSources) {
  const { history, remember, remove } = useSearchHistory(StorageKeys.globalSearchHistory)
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 120)
  const groups = useMemo(() => searchEverything(sources, debounced), [sources, debounced])
  return { query, setQuery, groups, history, remember, removeHistory: remove }
}

interface GlobalSearchTriggerProps {
  /** 打开搜索弹框。 */
  onOpen: () => void
}

/**
 * 侧栏入口：长得像搜索框的按钮（真输入框只在弹框里，全站一套界面）。
 *
 * 快捷键监听挂在这里：侧栏在桌面上始终挂载（收起只是平移出视口），所以收起状态下 `Ctrl/Cmd+K` 也能开。
 */
export function GlobalSearchTrigger({ onOpen }: GlobalSearchTriggerProps) {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const shortcut = shortcutLabel('K')

  useEffect(() => {
    if (isMobile) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (hasOpenOverlay()) return
      event.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile, onOpen])

  if (isMobile) return null

  return (
    <Button
      variant="secondary"
      size="sm"
      /* 像输入框的占位文案：颜色压到 muted（`secondary` 变体默认是正文色）。 */
      className="h-8 w-full justify-start gap-2 px-2 font-normal text-muted-foreground hover:text-muted-foreground"
      onClick={onOpen}
      aria-label={t('search.global.open')}
      aria-keyshortcuts="Control+K Meta+K"
      data-testid="global-search-trigger"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{t('search.global.placeholder')}</span>
      <Kbd
        title={t('search.global.shortcut', { keys: shortcut })}
        data-testid="global-search-shortcut"
        className="h-5 min-w-5 border border-border/60 bg-background/70 px-1 text-2xs"
      >
        {shortcut}
      </Kbd>
    </Button>
  )
}

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: GlobalSearchSources
  onNavigate: (tab: TabId, intent?: SearchIntent) => void
  onOpenItem: (itemId: number) => void
  /** 浮动终端是否可用（未登录时不可用：入口都不在，别给一个点了没反应的按钮）。 */
  canFillTerminal: boolean
  /** 当前能不能直接执行指令（要登录）——不能时回车仍然只是跳到「指令小抄」查用法。 */
  canRunCommands: boolean
  /** 执行一条指令并返回结果（由 `App` 提供，内部走 rawcmd / 权限判定）。 */
  onRunCommand: (command: string) => Promise<CommandResult>
}

/** 搜索弹框（桌面 / 移动共用）：输入框 + 分组结果，「取消」或 `Esc` 关闭。 */
export function GlobalSearchDialog({
  open,
  onOpenChange,
  sources,
  onNavigate,
  onOpenItem,
  canFillTerminal,
  canRunCommands,
  onRunCommand,
}: GlobalSearchDialogProps) {
  const { t } = useI18n()
  const terminal = useTerminal()
  const inputRef = useRef<HTMLInputElement>(null)
  const state = useSearchState(sources)
  const typed = state.query.trim().length > 0
  /** 包住 listbox 的容器（观察高亮变化用）。 */
  const listHostRef = useRef<HTMLDivElement>(null)

  /** 行内「复制」：成功给 toast（不关弹框，方便连着复制几条）；失败不假装成功。 */
  const copyToClipboard = (text: string) => {
    void copyText(text).then((ok) => {
      if (ok) toast.success(t('dex.copied'))
      else toast.error(t('search.action.copyFailed'))
    })
  }
  const fillTerminal = (command: string) => terminal.open(command)
  /** 高亮行（从 DOM 读：cmdk 的 `onValueChange` 只在受控用法下才回调）。 */
  const selectedValue = (root: HTMLElement | EventTarget | null): string | null => {
    if (!(root instanceof HTMLElement)) return null
    return root.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') ?? null
  }
  /** 当前能扫到的所有行（组数很少，直接展平，不额外建 Map 避免每次渲染都造新引用）。 */
  const flatHits = state.groups.flatMap((group) => group.hits)

  /**
   * 当前高亮行的 value。
   *
   * 不订阅 cmdk 的 `onValueChange`（只在受控用法下才回调），也不把 `value` 传成受控
   * （会丢掉「默认选中第一条」），所以直接盯 listbox 里 `aria-selected` 的变化。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    const host = listHostRef.current
    if (!host) return
    const read = () => {
      setSelectedId(
        host.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') ?? null,
      )
    }
    read()
    // cmdk 的「默认选中第一条」在 commit 之后一拍才落到 DOM 上，所以补一次重读；
    // 之后的高亮变化（↑↓ / 悬停）由 observer 兜住。
    const timer = window.setTimeout(read, 0)
    const observer = new MutationObserver(read)
    observer.observe(host, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [state.groups])

  /**
   * 底部的复制提示跟着**高亮行**走：
   * 高亮到指令 → 「复制指令」；高亮到物品 / NPC / Buff / 图格 / 墙 → 「复制 ID」；
   * 高亮到没有复制功能的行（页面、物品集合、玩家）→ 不显示。
   */
  const copyHintKey = useMemo(() => {
    // cmdk 默认选中第一条，但它的选中在 commit 之后才落到 DOM：读不到就当第一条。
    const hit = (selectedId ? flatHits.find((item) => item.id === selectedId) : undefined) ?? flatHits[0]
    if (!hit?.copy) return null
    return hit.command ? 'search.action.copyCommand' : 'search.action.copyId'
  }, [selectedId, flatHits])

  /**
   * 快捷键（只在弹框内）：
   * - `Delete` / `Backspace`：空查询时删掉高亮的那条最近搜索（有词时这两个键属于输入框）；
   * - `Ctrl/Cmd+C`：复制高亮行的 ID / 指令（输入框里没有选中文本时才接管）。
   */
  const handleRootKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
      const input = inputRef.current
      // 输入框里有选中文本：这是「复制搜到的字」，别抢。
      if (input && input.selectionStart !== input.selectionEnd) return
      const value = selectedValue(event.currentTarget)
      const hit = value ? flatHits.find((item) => item.id === value) : undefined
      if (!hit?.copy) return
      event.preventDefault()
      copyToClipboard(hit.copy)
      return
    }
    if (typed) return
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    const recent = queryOfRecent(selectedValue(event.currentTarget))
    if (!recent) return
    event.preventDefault()
    state.removeHistory(recent)
  }

  /**
   * 二级页：把「执行结果」留在弹框里（不跳到指令页），`null` = 还停在结果列表。
   * 只在「可裸跑的指令 + 已登录」时才走这条路，其余保持原来的跳转行为。
   */
  const [run, setRun] = useState<{ command: string; result: CommandResult | null } | null>(null)

  const execute = async (command: string) => {
    setRun({ command, result: null })
    try {
      const result = await onRunCommand(command)
      setRun({ command, result })
    } catch (err) {
      setRun({
        command,
        result: {
          status: 'unavailable',
          output: [],
          message: err instanceof Error ? err.message : String(err),
        },
      })
    }
  }

  const pick = (hit: SearchHit) => {
    const keyword = state.query.trim()
    if (keyword) state.remember(keyword)
    if (hit.runnable && canRunCommands && hit.command) {
      void execute(hit.command)
      return
    }
    runHit(hit, onNavigate, onOpenItem)
    state.setQuery('')
    onOpenChange(false)
  }

  // 圆角比通用弹框（`rounded-modal`，24px）小一档：命令面板要更紧凑。
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        radius="container"
        // `z-[60]`：要盖在商品详情 / 物品详情这类抽屉（Sheet / Drawer，z-50）之上——
        // 用户会边看详情边搜，不该强迫先关掉抽屉。
        className="top-[12%] z-[60] max-w-xl translate-y-0 gap-2 p-3"
        data-testid="global-search-dialog"
      >
        <DialogTitle className="sr-only">{t('search.global.title')}</DialogTitle>
        <Command
          shouldFilter={false}
          loop
          label={t('search.global.title')}
          className="gap-2 bg-transparent"
          onKeyDown={handleRootKeyDown}
        >
          <InputGroup className="h-8 w-full">
            <InputGroupAddon align="inline-start" className="pr-0">
              <Search aria-hidden className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <CommandInput
              ref={inputRef}
              value={state.query}
              onValueChange={state.setQuery}
              placeholder={t('search.global.placeholder')}
              aria-label={t('search.global.title')}
              className="px-3 text-xs"
              data-testid="global-search-input"
            />
            {state.query.length > 0 && (
              <InputGroupAddon align="inline-end">
                <IconAction
                  size="icon-xs"
                  label={t('editor.clear')}
                  icon={X}
                  onClick={() => {
                    state.setQuery('')
                    inputRef.current?.focus()
                  }}
                />
              </InputGroupAddon>
            )}
          </InputGroup>
          <div ref={listHostRef} className="max-h-[60vh] overflow-hidden">
            {run ? (
              <RunView
                command={run.command}
                result={run.result}
                onBack={() => {
                  setRun(null)
                  inputRef.current?.focus()
                }}
              />
            ) : (
            <CommandList>
              {typed ? (
                <ResultGroups
                  query={state.query}
                  groups={state.groups}
                  sources={sources}
                  onPick={pick}
                  onNavigate={(tab, intent) => {
                    onNavigate(tab, intent)
                    state.setQuery('')
                    onOpenChange(false)
                  }}
                  onCopy={copyToClipboard}
                  canFillTerminal={canFillTerminal}
                  onFillTerminal={(command) => {
                    fillTerminal(command)
                    onOpenChange(false)
                  }}
                />
              ) : state.history.length > 0 ? (
                <RecentGroup
                  history={state.history}
                  onRecent={(value) => {
                    state.setQuery(value)
                    inputRef.current?.focus()
                  }}
                  onRemove={state.removeHistory}
                />
              ) : (
                <CommandEmpty>{t('search.global.hint')}</CommandEmpty>
              )}
            </CommandList>
            )}
          </div>
        </Command>
        {/*
          底部提示：左侧是通用键（选择 / 打开 / 取消排在一起），
          只和当前模式有关的额外操作（复制快捷键、删除最近搜索）全部靠右。
        */}
        <div
          className="-mx-3 -mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-b-modal border-t px-3 py-2 text-2xs text-muted-foreground"
          data-testid="global-search-keys"
        >
          <span className="flex items-center gap-1">
            <Kbd className="h-5 min-w-5 border border-border/60 bg-background/70 px-1">↑</Kbd>
            <Kbd className="h-5 min-w-5 border border-border/60 bg-background/70 px-1">↓</Kbd>
            {t('search.global.keys.select')}
          </span>
          <span className="flex items-center gap-1">
            <Kbd className="h-5 border border-border/60 bg-background/70 px-1">Enter</Kbd>
            {t('search.global.keys.open')}
          </span>
          <span className="flex items-center gap-1">
            <Kbd className="h-5 border border-border/60 bg-background/70 px-1">Esc</Kbd>
            {t('search.global.keys.close')}
          </span>
          <span className="ml-auto flex items-center gap-3">
            {copyHintKey && (
              <span className="flex items-center gap-1">
                <Kbd className="h-5 border border-border/60 bg-background/70 px-1">{shortcutLabel('C')}</Kbd>
                {t(copyHintKey)}
              </span>
            )}
            {!typed && state.history.length > 0 && (
              <span className="flex items-center gap-1">
                <Kbd className="h-5 border border-border/60 bg-background/70 px-1">Delete</Kbd>
                {t('search.global.keys.remove')}
              </span>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
