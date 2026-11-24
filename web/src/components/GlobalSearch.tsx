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
import { ItemDetailPanel } from '@/components/items/ItemDetailPanel'
import type { ItemDetailRecipeOptions } from '@/hooks/useItemDetailRecipeOptions'
import { ItemIcon } from '@/components/ItemIcon'
import { RichText } from '@/components/RichText'
import { NpcSprite } from '@/components/NpcSprite'
import { ProjectileIcon } from '@/components/ProjectileIcon'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InputGroup,
  InputGroupAddon,
  Kbd,
  Spinner,
} from '@/components/ui'
import { toast } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useItemDetailRecipeOptions } from '@/hooks/useItemDetailRecipeOptions'
import { useSearchHistory } from '@/hooks/useSearchHistory'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  commandInvocation,
  groupPageExit,
  searchEverything,
  searchGroup,
  type GlobalSearchSources,
  type SearchGroupDetail,
  type SearchGroupId,
  type SearchHit,
} from '@/lib/globalSearch'
import { useItemFavorites } from '@/lib/itemFavoritesContext'
import { ItemDetailProvider, type DetailEntry } from '@/lib/itemDetailContext'
import { pushApi } from '@/lib/itemDetailStack'
import { copyText } from '@/lib/clipboard'
import { formatClock } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { wikiUrl } from '@/lib/items'
import { modKeyLabel, shortcutLabel } from '@/lib/keyboard'
import type { SearchIntent } from '@/lib/searchIntent'
import { forgetDrill, recallDrill, rememberDrill } from '@/lib/searchDrill'
import { StorageKeys } from '@/lib/storage'
import type { BackendTransport } from '@/lib/tshock'
import type { CommandResult, Dataset, TabId } from '@/types'

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
 * 行的操作**只有键盘**：`Enter` 走主操作（打开 / 查看 / 执行 / 填入指令）、`⌘/Ctrl+C` 复制。
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
  paints: 'search.group.paints',
  projectiles: 'search.group.projectiles',
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
): void {
  // 物品不在这里：它在弹框里就地开一层（见 `GlobalSearchDialog` 的 `openItemLevel`）。
  if (hit.action.kind === 'page') {
    onNavigate(hit.action.tab)
    return
  }
  if (hit.action.kind !== 'prefill') return
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
  if (icon.kind === 'projectile') return <ProjectileIcon id={icon.id} size={24} />
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
          // 次要信息也可能是物品标签（鱼店商品的价格就写成 `[i/s6:170]…`），按富文本渲染成图标；
          // 没有标签时 `RichText` 原样返回文本，其它组不受影响。
          <span className="flex max-w-[45%] shrink-0 items-center gap-1 overflow-hidden text-2xs text-muted-foreground">
            <RichText
              text={hit.meta}
              itemsById={sources.dataset.itemsById}
              prefixesById={sources.dataset.prefixesById}
              atlas={sources.dataset.atlas}
              iconSize={16}
            />
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
  /** 二级里的跳页出口（列表末尾的「更多」行）。 */
  onSeeAllPage: (tab: TabId, intent?: SearchIntent) => void
}

/**
 * 二级：某一组的前 20 条（`Enter` 主操作和一级一致）。
 *
 * 这层**没有标题行**：没有「返回」按钮、也不写「组名 · N 条」——回上一级只要 `Esc`，
 * 条数在底栏左下角。省下的那一行给列表。
 */
function GroupDetail({ detail, query, sources, onPick, onSeeAllPage }: GroupDetailProps) {
  const { t } = useI18n()
  return (
    <div className="flex max-h-[inherit] flex-col" data-testid="global-search-group">
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

/** 结果页的一条执行记录（`result === null` = 还在跑）。 */
interface RunEntry {
  /** 这一条跑的指令行（可能是 `/help`，也可能是补了参数的 `/help 1`）。 */
  command: string
  /** 触发它的行（`SearchHit.id`）：`Esc` 返回时把高亮放回去。 */
  origin: string
  /** 这条指令在数据里标了必填参数：失败时多给一个「填入指令」。 */
  needsArgs?: boolean
  /** 结果落地的时间；多条记录靠它区分。 */
  ts: number
  result: CommandResult | null
}

interface RunViewProps {
  /** 按执行顺序排列：每次 `Enter` 追加一条（按 `Esc` 回列表才清掉）。 */
  entries: RunEntry[]
  /** 富文本要的图集 / 词缀（和结果面板同一份数据）。 */
  sources: GlobalSearchSources
  /** 最新一条执行失败时给一条「查看用法」（跳到指令小抄）。 */
  onUsage: () => void
  /** 把这条指令填回输入框补参数（留在面板里，回车再跑）。 */
  onFillCommand: () => void
}

/**
 * 三级：指令执行结果（留在弹框里，不跳页）。
 *
 * 每次 `Enter` **追加**一条（与「指令」页的结果列表同一个思路），不是刷新同一张卡：
 * 一条条的对比才是重跑的目的。多了就在框内滚（停在新的一条）。
 *
 * 这里**没有返回按钮**：焦点始终留在输入框，`Esc` 回列表（底栏有提示）。
 */
function RunView({ entries, sources, onUsage, onFillCommand }: RunViewProps) {
  const { t, lang } = useI18n()
  const listRef = useRef<HTMLDivElement>(null)
  const latest = entries[entries.length - 1]
  const latestResult = latest?.result ?? null
  // 成功就不给这两个退路：它们是失败时的补妆，不是第二条主路径。
  const failed =
    Boolean(latestResult) &&
    (latestResult!.status !== 'ok' || Boolean(latestResult!.message))
  // 多条时每条前面标时间，否则「哪次是哪次」就分不出来了。
  const stamped = entries.length > 1
  // 新一条进来就贴到底（和结果列表一样，先看最新的）。
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])
  return (
    <div className="flex max-h-[inherit] flex-col" data-testid="global-search-run">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-2">
        <div className="flex flex-col gap-3">
          {entries.map((entry, index) =>
            entry.result === null ? (
              <p
                key={index}
                className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
              >
                <Spinner aria-hidden />
                {t('editor.running')}
              </p>
            ) : (
              <div key={index} className="flex flex-col gap-1" data-run-entry="">
                {/* 每条自己带指令行：输入框里可能已经是下一条（要补参数的）。 */}
                <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <code className="min-w-0 truncate font-pixel text-foreground/70">
                    {entry.command}
                  </code>
                  {stamped && <span className="shrink-0 tabular-nums">{formatClock(lang, entry.ts)}</span>}
                </span>
                {/* 和「指令」页的结果面板同一套渲染：`[c/..]` 上色、`[i:..]` 出物品图标。 */}
                <CommandOutput
                  result={entry.result}
                  itemsById={sources.dataset.itemsById}
                  prefixesById={sources.dataset.prefixesById}
                  atlas={sources.dataset.atlas}
                />
              </div>
            ),
          )}
        </div>
      </div>
      {/* 失败退路钉在框内底部：结果再多也不会被滚走；只看最新那一条。 */}
      {failed && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="px-1 text-2xs text-muted-foreground"
            onClick={onUsage}
          >
            {t('search.run.usage')}
          </Button>
          {failed && latest?.needsArgs && (
            <Button
              variant="ghost"
              size="sm"
              className="px-1 text-2xs text-muted-foreground"
              onClick={onFillCommand}
            >
              {t('search.action.fillCommand')}
            </Button>
          )}
        </div>
      )}
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

/** 底栏里的一枚键帽（符号 / 图标，不写英文单词）。 */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <Kbd className="h-5 min-w-5 border border-border/60 bg-background/70 px-1">{children}</Kbd>
  )
}

/**
 * 底栏的一个键位提示：键帽 + 文案。
 *
 * 仅用于**无主操作可指**的说明（栏开时的「↑ ↓ 选择 / Esc 取消」）；有具体动作的一律用 `FooterAction`。
 */
function Hint({
  keys,
  icon: Icon,
  label,
}: {
  /** 键帽文字（`↑ ↓` / `Esc` …）；用 `icon` 时省略。 */
  keys?: string
  /** 键帽里画图标（如 delete 键）；和 `keys` 二选一。 */
  icon?: LucideIcon
  label: string
}) {
  return (
    <span className="flex items-center gap-1">
      <Keycap>{Icon ? <Icon aria-hidden className="size-3" /> : keys}</Keycap>
      {label}
    </span>
  )
}

/**
 * 底栏动作：**主操作直接写出来，其余收进「更多操作」**。
 *
 * 面板能做的事比一个普通搜索框多得多（打开 / 执行 / 复制 ID / 复制名称 / 去 Wiki / 去页面 / 返回），
 * 全部平铺在底栏会变成一条读不完的说明。所以只留一个主操作 + 一个菜单入口（与 macOS 搜索的底部条同构）。
 */
type FooterActionId =
  | 'open'
  | 'copy'
  | 'copyId'
  | 'copyName'
  | 'wiki'
  | 'favorite'
  | 'gotoPage'
  | 'rerun'
  | 'search'
  | 'remove'

interface FooterAction {
  id: FooterActionId
  /** 动作名（菜单里直接点也会执行）。 */
  label: string
  /** 组合键，**合并在一个键帽里**（`⌘C` / `Ctrl C`）；缺省 = 没有快捷键。 */
  keys?: string
  /** 键帽换成图标（delete 键这种没有字形的键）。 */
  icon?: LucideIcon
}

/** 一个动作的键帽（没有快捷键时什么都不画）。 */
function ActionKeycap({ action }: { action: FooterAction }) {
  if (action.icon) {
    const Icon = action.icon
    return (
      <Keycap>
        <Icon aria-hidden className="size-3" />
      </Keycap>
    )
  }
  return action.keys ? <Keycap>{action.keys}</Keycap> : null
}

/**
 * 高亮行的 `Enter` 文案。四种动作各自写明：执行 / 打开 / 查看。
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
function useSearchState(sources: GlobalSearchSources, initialQuery = '') {
  const { history, remember, remove } = useSearchHistory(StorageKeys.globalSearchHistory)
  const [query, setQuery] = useState(initialQuery)
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
  /** 物品详情层要的：当前登录玩家名（`/give` 指令用）、网页发言、是否已登录。 */
  username?: string | null
  transport?: BackendTransport | null
  authenticated?: boolean
  /**
   * 打开时预填的搜索词（「填入指令」用：等价于按 `Ctrl/Cmd+K` 再把指令敲进去）。
   * 面板按 `searchOpen` 重建，所以这里只在挂载时读一次。
   */
  initialQuery?: string
  /** 当前能不能直接执行指令（要登录）——不能时回车仍然只是跳到「指令小抄」查用法。 */
  canRunCommands: boolean
  /** 执行一条指令并返回结果（由 `App` 提供，内部走 rawcmd / 权限判定）。 */
  onRunCommand: (command: string) => Promise<CommandResult>
}

/** 执行结果页：把每次执行的输出摞在一起看，`Esc` 才回列表。 */
interface RunState {
  /** 这个结果页里的所有执行记录（`Enter` 一次追加一条）。 */
  entries: RunEntry[]
}

/** 搜索弹框（桌面 / 移动共用）：输入框 + 分组结果，`Esc` 逐级返回 / 关闭。 */
export function GlobalSearchDialog({
  open,
  onOpenChange,
  sources,
  onNavigate,
  username = null,
  transport,
  authenticated = false,
  initialQuery = '',
  canRunCommands,
  onRunCommand,
}: GlobalSearchDialogProps) {
  const { t, lang } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const state = useSearchState(sources, initialQuery)
  const typed = state.query.trim().length > 0
  /** 当前展开的组（`null` = 一级）。**不跨弹框恢复**：重开就该是空面板。 */
  const [drill, setDrill] = useState<SearchGroupId | null>(null)
  const [run, setRun] = useState<RunState | null>(null)
  /**
   * 物品详情层（空 = 不在这一层）：栈里是「根物品 → 子物品…」，与物品详情弹框同一个思路。
   * 它就是**弹框里的一层**——不再另开一个弹框，`Esc` 退层而不是关掉整个搜索面板。
   */
  const [itemStack, setItemStack] = useState<DetailEntry[]>([])
  /** 从列表哪一行进的物品层：退回来时高亮停回那一行。 */
  const itemOrigin = useRef<string | null>(null)
  /** 「更多操作」菜单（`⌘K` 也能开）：只放非主操作。 */
  const [moreOpen, setMoreOpen] = useState(false)
  const itemEntry = itemStack[itemStack.length - 1]
  const currentItem = itemEntry ? sources.dataset.itemsById.get(itemEntry.id) ?? null : null
  const inItem = Boolean(itemEntry && currentItem)
  const recipeOptions = useItemDetailRecipeOptions()
  // 物品收藏（全局 Provider 提供）：物品层的「收藏 / 取消收藏」用它；没有 Provider 就不显示这一项。
  const itemFavorites = useItemFavorites()
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

  /** 离开弹框（跳页 / 关面板）时把记忆清掉，免得下次打开突然回到旧位置。 */
  const leave = () => {
    forgetDrill()
    state.setQuery('')
    setItemStack([])
    onOpenChange(false)
  }

  /** 「填入指令」：把这条指令放回输入框（等价于用户自己敲进去），留在面板里改参数。 */
  const fillCommand = (command: string) => {
    changeQuery(command)
    inputRef.current?.focus()
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
  }, [drill, run, itemStack.length])

  /** 二级位置记忆：在二级里每移动一次高亮都刷新（离开后 60s 内能回到这儿）。 */
  useEffect(() => {
    if (!drill) return
    rememberDrill({ query: state.query, group: drill, selected: selectedId })
  }, [drill, state.query, selectedId])

  /** 输入词清空（或只剩空白）就回一级：不留一个「某组 + 空词」的空列表。 */
  const changeQuery = (value: string) => {
    state.setQuery(value)
    // 物品详情层不按词过滤：一改词就是「重新搜」，退回列表（`Esc` 只管退层）。
    setItemStack((prev) => (prev.length > 0 ? [] : prev))
    // 结果页只在「还是一行能跑的指令」时留着：`/help` → `/help 1` 就是同一条指令补参数，
    // 结果照旧摆在上面；改成搜索词（`石头`）才回列表，否则 `Enter` 会跑错东西。
    if (run) {
      const next = commandInvocation(sources, value)
      if (!next?.runnable) setRun(null)
    }
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

  /** 从执行结果回到触发它的列表（高亮回到最后一次执行的那一行）。 */
  const backFromRun = () => {
    if (!run) return
    restoreTarget.current = run.entries[run.entries.length - 1]?.origin ?? null
    setRun(null)
  }

  /** 从二级回一级：高亮停回那组的「更多」行。 */
  const backFromDrill = () => {
    if (!drill) return
    restoreTarget.current = seeAllValue(drill)
    rememberDrill({ query: state.query, group: drill, selected: selectedId })
    setDrill(null)
  }

  /** 进物品详情层：内容就在弹框里（不另开弹框），高亮记下来，退回来停在同一行。 */
  const openItemLevel = (hit: SearchHit) => {
    if (hit.action.kind !== 'item') return
    itemOrigin.current = hit.id
    setItemStack([{ id: hit.action.itemId }])
    // 焦点留在输入框：`Esc` 退层、`⌘C` 复制、`⌘⏎` 去 Wiki 都从这里来。
    inputRef.current?.focus()
  }

  /** 物品层的 `Esc` / 返回键：先退一层子物品，退到底回列表并停回刚才那行。 */
  const backFromItem = () => {
    if (itemStack.length === 0) return
    if (itemStack.length > 1) {
      setItemStack((prev) => prev.slice(0, -1))
      return
    }
    restoreTarget.current = itemOrigin.current
    setItemStack([])
  }

  /**
   * 快捷键（只在弹框内）：
   * - 物品详情层：`⌘/Ctrl+C` 复制 ID、`⌘/Ctrl+⇧+C` 复制名称、`⌘/Ctrl+⏎` 前往 Wiki；
   * - 二级：`⌘/Ctrl+⏎` 带着搜索词前往目标页（列表末尾那行「更多」是同一个出口）；
   * - `Delete` / `Backspace`：空查询时删掉高亮的那条最近搜索（有词时这两个键属于输入框）；
   * - `Ctrl/Cmd+C`：复制高亮行的 ID / 指令（输入框里没有选中文本时才接管）。
   *
   * `Esc` 不在这里：Radix 的 DismissableLayer 在 document **捕获阶段**已经处理掉 Escape，
   * 必须用 `DialogContent` 的 `onEscapeKeyDown` 才能拦下它（见下面的 `onEscapeKeyDown`）。
   */
  const handleRootKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey
    // `⌘K` = 展开 / 收起「更多操作」（弹框开着时全局的 `⌘K` 本来就不抢）。
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      setMoreOpen((prev) => !prev)
      return
    }
    // 物品详情层：三个快捷键都在面板底部写着（按钮本身也留着，鼠标照旧能用）。
    if (inItem && currentItem) {
      const target = event.target as HTMLElement | null
      // 面板里的输入框优先（那里的 ⌘C 是复制自己选中的文本）。
      const editingOther =
        target !== inputRef.current &&
        Boolean(target?.isContentEditable || /^(input|textarea)$/i.test(target?.tagName ?? ''))
      if (editingOther) return
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (key === 'c') {
          const input = inputRef.current
          if (target === input && input && input.selectionStart !== input.selectionEnd) return
          event.preventDefault()
          copyToClipboard(event.shiftKey ? currentItem.name : String(currentItem.id))
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          window.open(wikiUrl(currentItem.name, lang), '_blank', 'noopener,noreferrer')
          return
        }
      }
      return
    }
    if (run) {
      // 只接管输入框里的 Enter：`查看用法` / `填入指令` 这些按钮的回车不能被吃掉。
      if (
        event.key === 'Enter' &&
        event.target === inputRef.current &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault()
        rerun()
      }
      return
    }
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
    // 二级：`⌘⏎` 带着这个词去目标页（目标页名写在下栏）。
    if (detail) {
      const exit = groupPageExit(detail.group, state.applied)
      if (mod && !event.altKey && !event.shiftKey && event.key === 'Enter' && exit) {
        event.preventDefault()
        goPage(exit.tab, exit.intent)
      }
      return
    }
    if (typed) return
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    const recent = queryOfRecent(selectedValue(event.currentTarget))
    if (!recent) return
    event.preventDefault()
    state.removeHistory(recent)
  }

  const execute = async (command: string, meta: { origin: string; needsArgs?: boolean }) => {
    const entry: RunEntry = { command, ...meta, ts: Date.now(), result: null }
    // 结果页是一个**会话日志**：不论跑的是同一条还是补了参数的变体，都往后追加。
    setRun((prev) => ({ entries: [...(prev?.entries ?? []), entry] }))
    // 结果页上**没有按钮**：焦点始终交给输入框（`Enter` 重跑 / 直接改词再搜）。
    inputRef.current?.focus()
    // 结果回来时用户可能已经 `Esc` 回列表了：找不到记录就丢掉（不篡改新一次的结果页）。
    const settle = (result: CommandResult) =>
      setRun((prev) => {
        if (!prev) return prev
        const index = prev.entries.findIndex((item) => item === entry)
        if (index < 0) return prev
        const entries = [...prev.entries]
        entries[index] = { ...entry, ts: Date.now(), result }
        return { ...prev, entries }
      })
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

  /**
   * 结果页的 `Enter`：跑**输入框里现在这条**（`/help` → `/help 1` 就是换成补了参数那条，
   * 结果追加在后面）；还在跑就不重复发。
   */
  const rerun = () => {
    if (!run || run.entries.some((entry) => entry.result === null)) return
    const next = commandInvocation(sources, state.query)
    if (!next?.command || !next.runnable) return
    void execute(next.command, { origin: next.id, needsArgs: next.needsArgs })
  }

  const pick = (hit: SearchHit) => {
    const keyword = state.query.trim()
    if (keyword) state.remember(keyword)
    // 物品就地开在弹框里（不再叠一个物品详情弹框）。
    if (hit.action.kind === 'item') {
      openItemLevel(hit)
      return
    }
    // 登录后一律执行（除仅游戏内）：缺参数就让 TShock 回一句用法错误，
    // 不靠数据里的 `required` 替用户判定「跑不了」。
    if (hit.command && !hit.inGameOnly && hit.runnable && canRunCommands) {
      void execute(hit.command, { origin: hit.id, needsArgs: hit.needsArgs })
      return
    }
    runHit(hit, onNavigate)
    leave()
  }

  const showingRecent = !run && !detail && !typed && !inItem && state.history.length > 0
  /** 刚打开、什么都没有：只有这时候才给「↑↓ 选择 / Esc 取消」这种通用提示。 */
  const showIntro = !run && !detail && !typed && !inItem && !showingRecent
  /** 二级的「前往 <页面>」出口（`⌘⏎`）：与列表末尾那行「更多」同一个目标。 */
  const pageExit = detail ? groupPageExit(detail.group, state.applied) : undefined

  /** 有上一层可回（二级 / 物品层 / 结果层）：输入框左侧的放大镜换成返回键。 */
  const hasBack = inItem || Boolean(run) || Boolean(detail)
  const backToInput = () => {
    if (inItem) backFromItem()
    else if (run) backFromRun()
    else if (detail) backFromDrill()
    inputRef.current?.focus()
  }

  /** 高亮的最近搜索词（删除 / 填入都按它来）。 */
  const selectedRecent = queryOfRecent(selectedId) ?? state.history[0] ?? null

  /**
   * 底栏动作：第一个是**主操作**（直接写出来），其余收进「更多操作」。
   * 顺序按「这一层最常做的事」排：拿 ID 去写指令 > 看 wiki / 合成 > 回上一层。
   *
   * 这里只放**数据**（id / 文案 / 键帽），执行统一走 `runFooterAction`：
   * 渲染期不碰 ref，菜单项也可以直接用键盘触发同一个动作。
   */
  const footerActions: FooterAction[] = (() => {
    /** 组合键文案：`⌘C` / `Ctrl C`；`shift` 时形如 `⌘⇧C`。 */
    const combo = (key: string, shift = false) =>
      shift ? `${modKeyLabel()}⇧${key}` : shortcutLabel(key)
    // 菜单里不放「返回」：回上一层由输入框左侧的返回键 / `Esc` 负责。
    if (inItem && currentItem) {
      const list: FooterAction[] = [
        { id: 'copyId', label: t('dex.copyId'), keys: combo('C') },
        { id: 'copyName', label: t('dex.copyName'), keys: combo('C', true) },
        { id: 'wiki', label: t('dex.wiki'), keys: combo('⏎') },
      ]
      // 收藏这一项要有全局收藏 Provider（App 提供）；没有就不显示，避免点了没反应。
      if (itemFavorites) {
        list.push({
          id: 'favorite',
          label: itemFavorites.isFavorited(currentItem.id)
            ? t('editor.unfavorite')
            : t('editor.favorite'),
        })
      }
      return list
    }
    if (run) return [{ id: 'rerun', label: t('search.run.again'), keys: '⏎' }]
    if (detail) {
      const list: FooterAction[] = [
        { id: 'open', label: t(enterHintOf(selectedHit, canRunCommands)), keys: '⏎' },
      ]
      if (copyHintKey) list.push({ id: 'copy', label: t(copyHintKey), keys: combo('C') })
      if (pageExit) {
        list.push({
          id: 'gotoPage',
          label: t('search.action.gotoPage', { page: pageLabelOf(sources, pageExit.tab) }),
          keys: combo('⏎'),
        })
      }
      return list
    }
    if (showingRecent) {
      return [
        { id: 'search', label: t('search.global.keys.search'), keys: '⏎' },
        { id: 'remove', label: t('search.global.keys.remove'), icon: DeleteKey },
      ]
    }
    if (typed) {
      const list: FooterAction[] = []
      if (selectedHit) {
        list.push({
          id: 'open',
          label: t(enterHintOf(selectedHit, canRunCommands)),
          keys: '⏎',
        })
      }
      if (copyHintKey) list.push({ id: 'copy', label: t(copyHintKey), keys: combo('C') })
      return list
    }
    return []
  })()

  /** 底栏动作的唯一执行入口（主操作按钮、菜单项都走这里）。 */
  const runFooterAction = (id: FooterActionId) => {
    switch (id) {
      case 'open':
        if (selectedHit) pick(selectedHit)
        return
      case 'copy':
        if (selectedHit?.copy) copyToClipboard(selectedHit.copy)
        return
      case 'copyId':
        if (currentItem) copyToClipboard(String(currentItem.id))
        return
      case 'copyName':
        if (currentItem) copyToClipboard(currentItem.name)
        return
      case 'wiki':
        if (currentItem) {
          window.open(wikiUrl(currentItem.name, lang), '_blank', 'noopener,noreferrer')
        }
        return
      case 'favorite':
        if (currentItem && itemFavorites) itemFavorites.toggle(currentItem.id)
        return
      case 'gotoPage':
        if (pageExit) goPage(pageExit.tab, pageExit.intent)
        return
      case 'rerun':
        rerun()
        return
      case 'search':
        if (selectedRecent) {
          changeQuery(selectedRecent)
          inputRef.current?.focus()
        }
        return
      case 'remove':
        if (selectedRecent) state.removeHistory(selectedRecent)
        return
    }
  }

  const primaryAction = footerActions[0]
  const moreActions = footerActions.slice(1)

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
        /* `Esc` 逐级返回（物品详情 → 执行结果 → 二级 → 一级），一级才关弹框。
           必须写在这里：Radix 在 document 捕获阶段就处理了 Escape。 */
        onEscapeKeyDown={(event) => {
          if (inItem) {
            event.preventDefault()
            backFromItem()
            return
          }
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
          <InputGroup
            /* `focus-within:ring-0`：这个弹框里焦点一直在输入框，聚焦描边只会变成一圈死纹。 */
            className="h-8 w-full focus-within:ring-0"
            data-testid="global-search-input-group"
          >
            <InputGroupAddon
              align="inline-start"
              /* `[&_button]:size-4`：把返回键压成和放大镜同一个 16px 方框 ——
                 `InputGroupAddon` 默认给 `size-7`，图标会被居中到右边一点，看着像错位。 */
              className="pr-0 [&_button]:size-4"
            >
              {/* 有上一层时（二级 / 物品层 / 结果层）放大镜换成返回键：鼠标也能退一层。 */}
              {hasBack ? (
                <IconAction
                  size="icon-xs"
                  label={t('search.backWithKey', { key: 'Esc' })}
                  icon={ChevronLeft}
                  testId="global-search-back"
                  onClick={backToInput}
                />
              ) : (
                <Search aria-hidden className="size-4 text-muted-foreground" />
              )}
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
          </InputGroup>
          <div
            ref={listHostRef}
            /* 物品详情层内容密（tips / 词缀 / 合成 / 掉落）：高度比列表高一档，内部自己滚。
               短物品按内容高，超过上限就在面板内部滚。 */
            className={cn(
              'overflow-hidden',
              inItem && 'relative flex max-h-[min(38rem,62dvh)] min-h-0 flex-col',
              !inItem && 'max-h-[60vh]',
            )}
          >
            {inItem && currentItem && itemEntry ? (
              <ItemLevel
                key={itemStack.length}
                dataset={sources.dataset}
                entry={itemEntry}
                depth={itemStack.length - 1}
                username={username}
                recipe={recipeOptions}
                transport={transport}
                authenticated={authenticated}
                onPush={(next) => setItemStack((prev) => [...prev, next])}
                onBack={backFromItem}
                onCloseAll={backFromItem}
                onFillCommand={fillCommand}
              />
            ) : run ? (
              <RunView
                entries={run.entries}
                sources={sources}
                onUsage={() =>
                  goPage('tables', {
                    query: (run.entries[run.entries.length - 1]?.command ?? '').replace(/^\//, ''),
                  })
                }
                onFillCommand={() =>
                  fillCommand(run.entries[run.entries.length - 1]?.command ?? '')
                }
              />
            ) : detail ? (
              <GroupDetail
                detail={detail}
                query={state.query}
                sources={sources}
                onPick={pick}
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
          {/* 二级：条目数写在左下角（原来在标题行右侧，那行已经取消）。 */}
          {detail && !inItem && (
            <span className="tabular-nums" data-testid="global-search-count">
              {t('search.group.count', { n: detail.total })}
            </span>
          )}
          {/* 右下角：主操作是**带底色的胶囊按钮**（这一层最该点的那一个），
              其余收进「操作」（同样的胶囊样式，只是安静：文字 + `⌘K` 键帽）。 */}
          <span className="ml-auto flex min-w-0 items-center gap-2">
            {primaryAction && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => runFooterAction(primaryAction.id)}
                className="h-5 min-w-0 shrink gap-1.5 rounded-full px-2 text-2xs text-foreground"
                data-testid="global-search-primary"
              >
                <span className="truncate">{primaryAction.label}</span>
                <ActionKeycap action={primaryAction} />
              </Button>
            )}
            {moreActions.length > 0 && (
              <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('search.moreActions')}
                    data-testid="global-search-more"
                    className="flex h-5 shrink-0 cursor-pointer items-center gap-1.5 rounded-chip px-1 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {t('search.moreActions')}
                    <Keycap>{shortcutLabel('K')}</Keycap>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="end"
                  sideOffset={6}
                  /* `z-[70]`：搜索弹框自己是 `z-[60]`（要盖住抽屉 / 弹框），
                     菜单必须再高一档，否则弹在弹框后面=看不见。 */
                  className="z-[70] min-w-44"
                  // 选完让焦点留在输入框（菜单自己会把焦点还给触发器）。
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    inputRef.current?.focus()
                  }}
                >
                  {/* 主操作固定是第一条（列表与底栏那份一致），其余跟在后面。 */}
                  {footerActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      onSelect={() => runFooterAction(action.id)}
                      className="justify-between gap-3"
                      data-testid={`global-search-action-${action.id}`}
                    >
                      <span className="min-w-0 truncate">{action.label}</span>
                      <ActionKeycap action={action} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ItemLevelProps {
  dataset: Dataset
  entry: DetailEntry
  /** 叠层深度（0 = 根）：> 0 时面板左上角出现返回键。 */
  depth: number
  username: string | null
  recipe: ItemDetailRecipeOptions
  transport?: BackendTransport | null
  authenticated: boolean
  /** 点配方材料 / ⓘ：叠一层（不重开面板）。 */
  onPush: (entry: DetailEntry) => void
  onBack: () => void
  onCloseAll: () => void
  onFillCommand: (command: string) => void
}

/**
 * 物品详情层（弹框里的第三层）：内容与图鉴抽屉 / 物品详情弹框是同一个 `ItemDetailPanel`，
 * 外壳换成搜索弹框里的一块——没有标题栏，只在叠了子物品时给一行返回。
 *
 * 词缀选择是本层的局部状态，所以每层单独一个实例（父级用 `key` = 栈深度）。
 */
function ItemLevel({
  dataset,
  entry,
  depth,
  username,
  recipe,
  transport,
  authenticated,
  onPush,
  onBack,
  onCloseAll,
  onFillCommand,
}: ItemLevelProps) {
  const [prefixId, setPrefixId] = useState(entry.prefixId ?? 0)
  const item = dataset.itemsById.get(entry.id)
  if (!item) return null
  return (
    <ItemDetailProvider api={pushApi(entry, onPush)}>
      <div className="flex min-h-0 w-full flex-col" data-testid="global-search-item">
        <ItemDetailPanel
          item={item}
          dataset={dataset}
          depth={depth}
          username={username}
          prefixId={prefixId}
          onPrefixChange={setPrefixId}
          stack={entry.stack}
          recipe={recipe}
          transport={transport}
          authenticated={authenticated}
          onBack={onBack}
          onCloseAll={onCloseAll}
          chrome="command"
          onFillCommand={onFillCommand}
        />
      </div>
    </ItemDetailProvider>
  )
}
