import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  ChevronLeft,
  Delete as DeleteKey,
  History,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react'
import { BuffIcon } from '@/components/BuffIcon'
import { IconAction } from '@/components/IconAction'
import { ItemIcon } from '@/components/ItemIcon'
import { NpcSprite } from '@/components/NpcSprite'
import { CommandOutput } from '@/components/ResultPanel'
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
import {
  commandInvocation,
  searchEverything,
  searchGroup,
  type GlobalSearchSources,
  type SearchGroupDetail,
  type SearchGroupId,
  type SearchHit,
} from '@/lib/globalSearch'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { modKeyLabel, shortcutLabel } from '@/lib/keyboard'
import type { SearchIntent } from '@/lib/searchIntent'
import { forgetDrill, recallDrill, rememberDrill } from '@/lib/searchDrill'
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
 * 弹框内是**三层**：
 * 1. 一级：按域分组的前几条，被截掉的组末行是「更多」→ 进二级；
 * 2. 二级：该组的前 `MAX_PER_GROUP_DETAIL` 条，更多的才「更多」（右侧写目标页，跳页 + 预填词）；
 * 3. 指令的执行结果（只有指令有）：留在弹框里显示输出，`Esc` 回上一层。
 *
 * 行的操作**只有键盘**：`Enter` 走主操作（打开 / 查看 / 执行 / 填入终端）、`⌘/Ctrl+C` 复制。
 * 行上不放图标按钮——每个动作都在底栏写明，不用猜哪个图标是复制。底栏文案跟着**高亮行**变。
 *
 * 结果列表用 shadcn `Command`（cmdk）：分组、键盘导航、`aria-activedescendant` 由它管；
 * **排序与匹配不交给 cmdk**（`shouldFilter={false}`），我们按域分组 + 固定组顺序 + 自己的打分。
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

/** 一级「更多」行的 cmdk value（二级没展开时的记忆位置也用它）。 */
const seeAllValue = (group: SearchGroupId) => `${group}:more`
/** 二级「更多」行的 value（和一级那行区分开）。 */
const seeAllPageValue = (group: SearchGroupId) => `${group}:more-page`

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

/** 结果行（一级分组与二级组内列表共用，保证两层的行长得一样）。 */
function HitRow({
  hit,
  sources,
  onPick,
  label,
}: {
  hit: SearchHit
  sources: GlobalSearchSources
  onPick: (hit: SearchHit) => void
  /** 覆盖显示文字（「执行指令：/wm find …」这种带前缀的整行）。 */
  label?: string
}) {
  const { t } = useI18n()
  return (
    <CommandItem
      value={hit.id}
      onSelect={() => onPick(hit)}
      // 仅游戏内（`allowServer === false`）：和「指令小抄」一样用语义红标出来，不自作主张执行。
      className={cn(hit.inGameOnly && 'text-destructive data-[selected=true]:text-destructive')}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <HitIcon hit={hit} sources={sources} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label ?? hit.name}</span>
      {hit.inGameOnly ? (
        <span className="shrink-0 text-2xs opacity-80">{t('commands.onlyInGame')}</span>
      ) : (
        hit.meta && (
          // 真正贴右（名字 `flex-1` 吃掉剩余空间，不在右侧留预留位）。
          <span className="max-w-[45%] shrink-0 truncate text-2xs text-muted-foreground">
            {hit.meta}
          </span>
        )
      )}
    </CommandItem>
  )
}

/**
 * 「更多」一行：一级进二级，二级却要离开弹框。
 * 右侧弱化信息负责说清差别——一级是命中数，二级是目标页面名。
 */
function SeeAllRow({
  value,
  aside,
  onSelect,
}: {
  value: string
  /** 右侧弱化文字（计数 / 目标页名）。 */
  aside?: string
  onSelect: () => void
}) {
  const { t } = useI18n()
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      className="gap-1.5 py-1 text-2xs text-muted-foreground"
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <ArrowRight aria-hidden className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{t('search.global.seeMore')}</span>
      {aside && <span className="shrink-0 tabular-nums">{aside}</span>}
    </CommandItem>
  )
}

/** 「全部」跳转的目标页面名（取侧栏导航的当前语言文案）。 */
function pageLabelOf(sources: GlobalSearchSources, tab: TabId): string {
  return sources.pages.find((page) => page.id === tab)?.label ?? tab
}

interface ResultGroupsProps {
  query: string
  groups: ReturnType<typeof searchEverything>
  sources: GlobalSearchSources
  onPick: (hit: SearchHit) => void
  /** 进二级（组内列表）。 */
  onDrill: (group: SearchGroupId) => void
  /** 上面已经有一行「执行指令」：它就是这个查询的答案，不再说「没有找到」。 */
  hasInvocation?: boolean
}

/** 一级结果：分组 + 每组末尾的「更多」。 */
function ResultGroups({
  query,
  groups,
  sources,
  onPick,
  onDrill,
  hasInvocation = false,
}: ResultGroupsProps) {
  const { t } = useI18n()
  return (
    <>
      {groups.map((group) => (
        <CommandGroup key={group.id} heading={t(GROUP_LABEL[group.id])}>
          {group.hits.map((hit) => (
            <HitRow key={hit.id} hit={hit} sources={sources} onPick={onPick} />
          ))}
          {group.seeAll && (
            <SeeAllRow
              value={seeAllValue(group.id)}
              aside={String(group.total)}
              onSelect={() => onDrill(group.id)}
            />
          )}
        </CommandGroup>
      ))}
      {groups.length === 0 && !hasInvocation && (
        <CommandEmpty>{t('search.global.noResults', { query: query.trim() })}</CommandEmpty>
      )}
    </>
  )
}

interface GroupDetailProps {
  detail: SearchGroupDetail
  query: string
  sources: GlobalSearchSources
  onPick: (hit: SearchHit) => void
  onBack: () => void
  /** 二级里命中仍超过上限时的跳页出口。 */
  onSeeAllPage: (tab: TabId, intent?: SearchIntent) => void
}

/** 二级：某一组的前 20 条（`Enter` 主操作和一级一致）。 */
function GroupDetail({ detail, query, sources, onPick, onBack, onSeeAllPage }: GroupDetailProps) {
  const { t } = useI18n()
  return (
    <div className="flex max-h-[inherit] flex-col" data-testid="global-search-group">
      <div className="flex items-center gap-2 px-1 py-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft data-icon="inline-start" />
          {t('action.back')}
        </Button>
        <span className="ml-auto truncate text-2xs text-muted-foreground tabular-nums">
          {t(GROUP_LABEL[detail.group])} · {t('search.group.count', { n: detail.total })}
        </span>
      </div>
      <CommandList className="min-h-0 flex-1">
        {detail.hits.map((hit) => (
          <HitRow key={hit.id} hit={hit} sources={sources} onPick={onPick} />
        ))}
        {detail.seeAll && (
          <SeeAllRow
            value={seeAllPageValue(detail.group)}
            aside={pageLabelOf(sources, detail.seeAll.tab)}
            onSelect={() => onSeeAllPage(detail.seeAll!.tab, detail.seeAll!.intent)}
          />
        )}
        {detail.hits.length === 0 && (
          <CommandEmpty>{t('search.global.noResults', { query: query.trim() })}</CommandEmpty>
        )}
      </CommandList>
    </div>
  )
}

interface RunViewProps {
  command: string
  /** `null` = 还在执行。 */
  result: CommandResult | null
  /** 富文本要的图集 / 词缀（和结果面板同一份数据）。 */
  sources: GlobalSearchSources
  /** 这条指令在数据里标了必填参数（失败时多给一个「填入终端」——可能只是少写了参数）。 */
  needsArgs?: boolean
  /** 浮动终端可用时才给「填入终端」。 */
  canFillTerminal: boolean
  onBack: () => void
  /** 执行失败时给一条「查看用法」（跳到指令小抄）。 */
  onUsage: () => void
  /** 填入浮动终端（补参数后重跑）。 */
  onFillTerminal: () => void
}

/** 三级：指令执行结果（留在弹框里，不跳页）。 */
function RunView({
  command,
  result,
  sources,
  needsArgs = false,
  canFillTerminal,
  onBack,
  onUsage,
  onFillTerminal,
}: RunViewProps) {
  const { t } = useI18n()
  // 成功就不给这两个退路：它们是失败时的补妆，不是第二条主路径。
  const failed = Boolean(result) && (result!.status !== 'ok' || Boolean(result!.message))
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
            {/* 和「指令」页的结果面板同一套渲染：`[c/..]` 上色、`[i:..]` 出物品图标。 */}
            <CommandOutput
              result={result}
              itemsById={sources.dataset.itemsById}
              prefixesById={sources.dataset.prefixesById}
              atlas={sources.dataset.atlas}
            />
            {failed && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-1 text-2xs text-muted-foreground"
                  onClick={onUsage}
                >
                  {t('search.run.usage')}
                </Button>
                {needsArgs && canFillTerminal && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-1 text-2xs text-muted-foreground"
                    onClick={onFillTerminal}
                  >
                    {t('search.action.fillTerminal')}
                  </Button>
                )}
              </div>
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

/**
 * 底栏的一个键位提示：键帽 + 文案。
 *
 * 键帽用符号 / 图标而不是英文单词（`⏎` 代替 `Enter`、delete 图标代替 `Delete`）：
 * 中文界面里不冒英文；组合键（`⌘` + `C`）拆成两个键帽，和系统提示的写法一致。
 */
function Hint({
  keys,
  icon: Icon,
  label,
}: {
  /** 键帽文字（`⏎` / `Esc` / `↑` …）；用 `icon` 时省略。 */
  keys?: string
  /** 键帽里画图标（如 delete 键）；和 `keys` 二选一。 */
  icon?: LucideIcon
  label: string
}) {
  return (
    <span className="flex items-center gap-1">
      <Kbd className="h-5 min-w-5 border border-border/60 bg-background/70 px-1">
        {Icon ? <Icon aria-hidden className="size-3" /> : keys}
      </Kbd>
      {label}
    </span>
  )
}

/** 组合键（`⌘` + `C` / `Ctrl` + `C`）拆成两个键帽。 */
function ModHint({ keyName, label }: { keyName: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <Kbd className="h-5 min-w-5 border border-border/60 bg-background/70 px-1">
        {modKeyLabel()}
      </Kbd>
      <Kbd className="h-5 min-w-5 border border-border/60 bg-background/70 px-1">{keyName}</Kbd>
      {label}
    </span>
  )
}

/**
 * 高亮行的 `Enter` 文案。四种动作各自写明：执行 / 填入终端 / 打开 / 查看。
 *
 * 不写字图标（行里没有按钮），所以这里必须准确——它就是这个行唯一的行为说明。
 */
function enterHintOf(hit: SearchHit | undefined, canRunCommands: boolean): string {
  if (!hit) return 'search.global.keys.open'
  if (hit.command && !hit.inGameOnly && canRunCommands) {
    return hit.runnable ? 'search.action.run' : 'search.global.keys.open'
  }
  // 物品就地弹详情 = 打开；NPC / Buff / 图格 / 墙 / 商品是「跳到那边看」= 查看。
  if (hit.action.kind === 'item') return 'search.global.keys.open'
  return hit.copy ? 'search.global.keys.view' : 'search.global.keys.open'
}

/**
 * 输入词 / 结果 / 最近搜索（高亮由 cmdk 管，这里只管数据和写历史）。
 * 每次打开弹框都是空词：二级位置记忆只在**同一次会话内**用（见 `lib/searchDrill.ts`）。
 */
function useSearchState(sources: GlobalSearchSources) {
  const { history, remember, remove } = useSearchHistory(StorageKeys.globalSearchHistory)
  const [query, setQuery] = useState('')
  /** 真正用于匹配的词（防抖后，二级也用同一个词，避免两层显示不一致）。 */
  const applied = useDebouncedValue(query, 120)
  const groups = useMemo(() => searchEverything(sources, applied), [sources, applied])
  return { query, setQuery, applied, groups, history, remember, removeHistory: remove }
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
  /** 浮动终端是否可用（未登录 / 该页不显示浮动终端时为 false）。 */
  canFillTerminal: boolean
  /** 当前能不能直接执行指令（要登录）——不能时回车仍然只是跳到「指令小抄」查用法。 */
  canRunCommands: boolean
  /** 执行一条指令并返回结果（由 `App` 提供，内部走 rawcmd / 权限判定）。 */
  onRunCommand: (command: string) => Promise<CommandResult>
}

/** 执行结果页的来源：返回时要把高亮放回触发它的那一行。 */
interface RunState {
  command: string
  result: CommandResult | null
  /** 触发执行的行（`SearchHit.id`）。 */
  origin: string
  /** 数据里标了必填参数：失败时多给一个「填入终端」。 */
  needsArgs?: boolean
}

/** 搜索弹框（桌面 / 移动共用）：输入框 + 分组结果，`Esc` 逐级返回 / 关闭。 */
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
  /** 当前展开的组（`null` = 一级）。**不跨弹框恢复**：重开就该是空面板。 */
  const [drill, setDrill] = useState<SearchGroupId | null>(null)
  const [run, setRun] = useState<RunState | null>(null)
  const detail = useMemo(
    () => (drill ? searchGroup(sources, drill, state.applied) : null),
    [drill, sources, state.applied],
  )
  /** 层级切换后要重新高亮的行（cmdk 默认会选第一条，跨层后不一定有选中项）。 */
  const restoreTarget = useRef<string | null>(null)
  /** 包住 listbox 的容器（观察高亮变化用）。 */
  const listHostRef = useRef<HTMLDivElement>(null)

  /** 行内复制（`⌘/Ctrl+C`）：成功给 toast，失败不假装成功。 */
  const copyToClipboard = (text: string) => {
    void copyText(text).then((ok) => {
      if (ok) toast.success(t('dex.copied'))
      else toast.error(t('search.action.copyFailed'))
    })
  }

  /** 离开弹框（跳页 / 填终端）时把记忆清掉，免得下次打开突然回到旧位置。 */
  const leave = () => {
    forgetDrill()
    state.setQuery('')
    onOpenChange(false)
  }

  const fillTerminal = (command: string) => {
    terminal.open(command)
    leave()
  }
  const goPage = (tab: TabId, intent?: SearchIntent) => {
    onNavigate(tab, intent)
    leave()
  }
  /** 高亮行（从 DOM 读：cmdk 的 `onValueChange` 只在受控用法下才回调）。 */
  const selectedValue = (root: HTMLElement | EventTarget | null): string | null => {
    if (!(root instanceof HTMLElement)) return null
    return root.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') ?? null
  }
  /**
   * 「执行」组：查询本身就是一行指令（`/help 4` / `.help 4`）。
   * 置顶且默认高亮，所以输完整命令行直接 `Enter` 就跑了。
   */
  const invocation = useMemo(
    () => (canRunCommands ? commandInvocation(sources, state.applied) : null),
    [canRunCommands, sources, state.applied],
  )

  /** 当前层能扫到的所有行（组数很少，直接展平，不额外建 Map）。 */
  const visibleHits = useMemo(
    () =>
      detail
        ? detail.hits
        : [...(invocation ? [invocation] : []), ...state.groups.flatMap((group) => group.hits)],
    [detail, invocation, state.groups],
  )

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
  }, [state.groups, detail])

  /** 切层级后把高亮放在正确的地方（记住的那行 → 已有选中项 → 第一条）。 */
  useEffect(() => {
    const wanted = restoreTarget.current
    restoreTarget.current = null
    const timer = window.setTimeout(() => {
      const host = listHostRef.current
      if (!host) return
      const items = [...host.querySelectorAll('[cmdk-item]')]
      const marked = host.querySelector('[cmdk-item][aria-selected="true"]')
      // cmdk 没有「按 value 选中」的公开 API，走它自己的 pointermove 路径。
      const target =
        (wanted ? items.find((el) => el.getAttribute('data-value') === wanted) : undefined) ??
        marked ??
        items[0]
      target?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [drill, run])

  /** 二级位置记忆：在二级里每移动一次高亮都刷新（离开后 60s 内能回到这儿）。 */
  useEffect(() => {
    if (!drill) return
    rememberDrill({ query: state.query, group: drill, selected: selectedId })
  }, [drill, state.query, selectedId])

  /** 输入词清空（或只剩空白）就回一级：不留一个「某组 + 空词」的空列表。 */
  const changeQuery = (value: string) => {
    state.setQuery(value)
    if (!value.trim()) {
      setDrill(null)
      // 清空 = 放弃那个二级位置：下次再进同一组不要跳回旧的那一行。
      forgetDrill()
    }
  }

  /** 进二级：同一组 + 同一个词、且刚离开过，就回到原来那一行。 */
  const enterDrill = (group: SearchGroupId) => {
    const memory = recallDrill()
    restoreTarget.current =
      memory && memory.group === group && memory.query === state.query ? memory.selected : null
    setDrill(group)
  }

  /** 高亮行（cmdk 默认选中第一条，但它的选中在 commit 之后才落到 DOM：读不到就当第一条）。 */
  const selectedHit = useMemo(() => {
    const id = selectedId ?? visibleHits[0]?.id
    return id ? visibleHits.find((item) => item.id === id) : undefined
  }, [selectedId, visibleHits])

  /** 底栏右侧：高亮行能做什么。 */
  const copyHintKey = selectedHit?.copy
    ? selectedHit.command
      ? 'search.action.copyCommand'
      : 'search.action.copyId'
    : null

  /** 从执行结果回到触发它的列表（高亮回到那一行）。 */
  const backFromRun = () => {
    if (!run) return
    restoreTarget.current = run.origin
    setRun(null)
  }

  /** 从二级回一级：高亮停回那组的「更多」行。 */
  const backFromDrill = () => {
    if (!drill) return
    restoreTarget.current = seeAllValue(drill)
    rememberDrill({ query: state.query, group: drill, selected: selectedId })
    setDrill(null)
  }

  /**
   * 快捷键（只在弹框内）：
   * - `Delete` / `Backspace`：空查询时删掉高亮的那条最近搜索（有词时这两个键属于输入框）；
   * - `Ctrl/Cmd+C`：复制高亮行的 ID / 指令（输入框里没有选中文本时才接管）。
   *
   * `Esc` 不在这里：Radix 的 DismissableLayer 在 document **捕获阶段**已经处理掉 Escape，
   * 必须用 `DialogContent` 的 `onEscapeKeyDown` 才能拦下它（见下面的 `onEscapeKeyDown`）。
   */
  const handleRootKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
      const input = inputRef.current
      // 输入框里有选中文本：这是「复制搜到的字」，别抢。
      if (input && input.selectionStart !== input.selectionEnd) return
      const value = selectedValue(event.currentTarget)
      const hit = value ? visibleHits.find((item) => item.id === value) : undefined
      if (!hit?.copy) return
      event.preventDefault()
      copyToClipboard(hit.copy)
      return
    }
    if (detail || typed) return
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    const recent = queryOfRecent(selectedValue(event.currentTarget))
    if (!recent) return
    event.preventDefault()
    state.removeHistory(recent)
  }

  const execute = async (hit: SearchHit) => {
    const command = hit.command
    if (!command) return
    setRun({ command, result: null, origin: hit.id, needsArgs: hit.needsArgs })
    // 结果回来时用户可能已经 `Esc` 回列表了：只有还停在这条指令的结果页时才填进去。
    const settle = (result: CommandResult) =>
      setRun((prev) => (prev && prev.command === command ? { ...prev, result } : prev))
    try {
      settle(await onRunCommand(command))
    } catch (err) {
      settle({
        status: 'unavailable',
        output: [],
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const pick = (hit: SearchHit) => {
    const keyword = state.query.trim()
    if (keyword) state.remember(keyword)
    // 登录后一律执行（除仅游戏内）：缺参数就让 TShock 回一句用法错误，
    // 不靠数据里的 `required` 替用户判定「跑不了」。
    if (hit.command && !hit.inGameOnly && hit.runnable && canRunCommands) {
      void execute(hit)
      return
    }
    runHit(hit, onNavigate, onOpenItem)
    leave()
  }

  const showingRecent = !run && !detail && !typed && state.history.length > 0
  /** 刚打开、什么都没有：只有这时候才给「↑↓ 选择 / Esc 取消」这种通用提示。 */
  const showIntro = !run && !detail && !typed && !showingRecent

  // 圆角比通用弹框（`rounded-modal`，24px）小一档：命令面板要更紧凑。
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        radius="container"
        // `z-[60]`：要盖在商品详情 / 物品详情这类抽屉（Sheet / Drawer，z-50）之上——
        // 用户会边看详情边搜，不该强迫先关掉抽屉。
        className="top-[12%] z-[60] max-w-xl translate-y-0 gap-2 p-0"
        data-testid="global-search-dialog"
        /* `Esc` 逐级返回（执行结果 → 二级 → 一级），一级才关弹框。
           必须写在这里：Radix 在 document 捕获阶段就处理了 Escape。 */
        onEscapeKeyDown={(event) => {
          if (run) {
            event.preventDefault()
            backFromRun()
            return
          }
          if (drill) {
            event.preventDefault()
            backFromDrill()
          }
        }}
      >
        <DialogTitle className="sr-only">{t('search.global.title')}</DialogTitle>
        <Command
          shouldFilter={false}
          loop
          label={t('search.global.title')}
          /* `min-w-0` + 弹框 `p-0`（内边距交给子元素）：
             底栏要用 `border-t` 做通栏分割线，若靠 `-mx-3` 抵消 `p-3`，那份额外宽度会加入
             grid 轨道的内部尺寸计算，把整个弹框撑宽、出现横向滚动条。 */
          className="min-w-0 gap-2 bg-transparent px-3 pt-3"
          onKeyDown={handleRootKeyDown}
        >
          <InputGroup className="h-8 w-full">
            <InputGroupAddon align="inline-start" className="pr-0">
              <Search aria-hidden className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <CommandInput
              ref={inputRef}
              value={state.query}
              onValueChange={changeQuery}
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
                    changeQuery('')
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
                sources={sources}
                needsArgs={run.needsArgs}
                canFillTerminal={canFillTerminal}
                onBack={backFromRun}
                onUsage={() => goPage('tables', { query: run.command.replace(/^\//, '') })}
                onFillTerminal={() => fillTerminal(run.command)}
              />
            ) : detail ? (
              <GroupDetail
                detail={detail}
                query={state.query}
                sources={sources}
                onPick={pick}
                onBack={backFromDrill}
                onSeeAllPage={goPage}
              />
            ) : (
              <CommandList>
                {typed ? (
                  <>
                    {invocation && (
                      <HitRow
                        hit={invocation}
                        sources={sources}
                        onPick={pick}
                        label={t('search.run.line', { command: invocation.command ?? '' })}
                      />
                    )}
                    <ResultGroups
                      query={state.query}
                      groups={state.groups}
                      sources={sources}
                      onPick={pick}
                      onDrill={enterDrill}
                      /** 有「执行指令」那一行时，不再补一行「没有找到」。 */
                      hasInvocation={Boolean(invocation)}
                    />
                  </>
                ) : state.history.length > 0 ? (
                  <RecentGroup
                    history={state.history}
                    onRecent={(value) => {
                      changeQuery(value)
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
          底栏：**没有内容时不提示「能做什么」**（那时没什么可做），一有内容就只留右侧的
          「这行能做什么」——按键提示跟着高亮行走，行里不再放图标按钮。
        */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-2xs text-muted-foreground"
          data-testid="global-search-keys"
        >
          {showIntro && (
            <>
              <Hint keys="↑ ↓" label={t('search.global.keys.select')} />
              <Hint keys="Esc" label={t('search.global.keys.close')} />
            </>
          )}
          <span className="ml-auto flex items-center gap-3">
            {run ? (
              <Hint keys="Esc" label={t('action.back')} />
            ) : showingRecent ? (
              <>
                <Hint keys="⏎" label={t('search.global.keys.search')} />
                <Hint icon={DeleteKey} label={t('search.global.keys.remove')} />
              </>
            ) : (
              <>
                {selectedHit && <Hint keys="⏎" label={t(enterHintOf(selectedHit, canRunCommands))} />}
                {copyHintKey && <ModHint keyName="C" label={t(copyHintKey)} />}
                {detail && <Hint keys="Esc" label={t('action.back')} />}
              </>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
