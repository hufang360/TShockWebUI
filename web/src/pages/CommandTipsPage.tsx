import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, Info, ListFilter, Search, Terminal, X } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { SearchInput } from '@/components/SearchInput'
import { usePageScrollReset, useStickyHeaderOffset } from '@/hooks/usePageScroll'
import { TIPS_GROUPS, type TipsGroup } from '@/lib/commandTips'
import { readDataIdState, rememberDataIdState } from '@/lib/dataIdState'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import {
  SPAWN_BOSS_TIPS,
  SPAWN_MOB_EXAMPLES,
  TP_NPC_EXAMPLES,
  spawnBossCommand,
  spawnMobCommand,
  tpNpcCommand,
} from '@/lib/spawnTips'
import { useTerminal } from '@/lib/terminalContext'
import { BAN_COMMANDS, PERM_SETUP_COMMANDS, USER_ACCOUNT_COMMANDS } from '@/lib/userCommandTips'
import {
  GODMODE_COMMANDS,
  HOLIDAY_COMMANDS,
  SPAWN_RATE_COMMANDS,
  TIME_COMMANDS,
  WIND_COMMANDS,
  WORLD_EVENT_COMMANDS,
  WORLD_INVASION_COMMANDS,
  WORLD_MODE_COMMANDS,
  type CommandTip,
} from '@/lib/worldCommandTips'
import type { CommandDef, Dataset, Npc, TabId } from '@/types'

interface CommandTipsPageProps {
  dataset: Dataset
  /** 「数据 ID → NPC」入口（查更多 NPC / 名称）。 */
  onNavigate: (tab: TabId) => void
  /** 点条目后的去向；默认填进浮动终端，指令页里改为填进页面输入框。 */
  onPick?: (command: string) => void
}

interface TableRow {
  command: string
  label: string
  note?: string
  /**
   * 参考行：语法带占位符（`/give <物品> <玩家>`），点了也跑不通，
   * 所以**不填浮窗**，只给复制按钮；`false` / 省略 = 可用「终端」按钮填入。
   */
  syntax?: boolean
  /** 详情抽屉：这一类指令的**规范写法**（分区的语法行，如 `/worldevent <事件>`）。 */
  usage?: string
  /** 详情抽屉：所在分组标题。 */
  groupTitle?: string
  /** 详情抽屉：对应的内置指令定义（权限 / 是否可网页执行 / 说明 / 别名）。 */
  def?: CommandDef
}

/** 表内分区：分类行（`title`）+ 语法行（`usage`）+ 可选说明行（`hint`）。 */
interface TableSection {
  id: string
  title?: string
  usage?: string
  hint?: string
  rows: TableRow[]
  /** 分区底部的一行操作（如「在数据 ID → NPC 里查更多」）。 */
  footnote?: ReactNode
}

/** `CommandTip`（中英双名）→ 表行（按当前语言取名称 / 备注）。 */
function toRows(commands: readonly CommandTip[], lang: 'zh' | 'en'): TableRow[] {
  return commands.map((row) => ({
    command: row.command,
    label: row.label[lang],
    note: row.note?.[lang],
  }))
}

/**
 * 指令列多短就肯定不会截断（最窄的手机 11rem ≈ 22 个等宽字符）。
 * 更短的不挂 Tooltip —— 一页几百行，逐个挂 Radix Tooltip 会明显拖慢渲染。
 */
const TRUNCATE_HINT_MIN = 22

/** 指令列的内层 span：限宽 + 换行 / 截断 + 颜色（参考行更淡）。 */
function commandCellClass(row: TableRow): string {
  return cn(
    'block max-w-[11rem] font-mono text-xs break-words sm:max-w-[16rem] sm:truncate xl:max-w-[22rem]',
    row.syntax ? 'text-muted-foreground' : 'text-foreground',
  )
}

/** `/give <item type/id>` → `give`。 */
function commandName(command: string): string {
  const first = command.trim().replace(/^\//, '').split(/\s+/)[0] ?? ''
  return first.toLowerCase()
}

/**
 * 指令表格：**指令在第一列**，后面是名称 / 备注，最后一列是**操作**（终端 / 复制 + 详情）。
 *
 * - 行本身**不响应单击**（避免误触把指令填进浮窗）：只有「操作」列的终端按钮才填入；
 * - 参考行（`syntax` 为真）：语法带占位符，填进浮窗也跑不通，所以按钮换成复制；
 * - 每行都有「详情」按钮，打开右侧抽屉看这一类指令的规范写法 / 权限 / 是否只能游戏内执行；
 * - 表格**不在卡片里**，本身也不滚动：整页交给 AppShell 的 `<main>` 滚（浏览器右侧那条滚动条），
 *   表头吸在**工具条下面**（`--page-sticky-top`，实测工具条高度）；
 * - **指令列有最大宽度**：手机较窄（长指令换行，不横向溢出），`sm` 起单行截断 + 悬停 Tooltip 看全。
 */
function CommandTable({
  groups,
  onPick,
  onDetails,
}: {
  groups: TableSection[]
  onPick: (command: string) => void
  onDetails: (row: TableRow) => void
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState<string | null>(null)
  const hasNote = groups.some((group) => group.rows.some((row) => row.note))
  const columnCount = hasNote ? 4 : 3

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(command)
    } catch {
      setCopied(null)
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-w-0">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background">
            <tr className="border-b border-border/60 text-2xs text-muted-foreground">
              <th scope="col" className="px-2 py-2 font-medium">
                {t('commands.col.command')}
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                {t('commands.col.name')}
              </th>
              {hasNote && (
                <th scope="col" className="hidden px-2 py-2 font-medium sm:table-cell">
                  {t('commands.col.note')}
                </th>
              )}
              <th scope="col" className="w-[4.5rem] px-1 py-2 text-right font-medium">
                {t('commands.col.action')}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.id}>
                {group.title && (
                  <tr className="border-t border-border/40 bg-accent/40">
                    <th
                      scope="colgroup"
                      colSpan={columnCount}
                      className="px-2 pt-2 pb-0.5 text-left text-2xs font-medium text-foreground"
                    >
                      {group.title}
                    </th>
                  </tr>
                )}
                {group.usage && (
                  <tr className="bg-accent/40">
                    <td
                      colSpan={columnCount}
                      className="px-2 pt-0 pb-2 font-mono text-2xs whitespace-pre-line text-muted-foreground"
                    >
                      {group.usage}
                    </td>
                  </tr>
                )}
                {group.hint && (
                  <tr className="bg-accent/40">
                    <td
                      colSpan={columnCount}
                      className="px-2 pt-0 pb-2 text-2xs text-muted-foreground"
                    >
                      {group.hint}
                    </td>
                  </tr>
                )}
                {group.rows.map((row) => (
                  <tr
                    key={row.command}
                    className="border-t border-border/40 align-top transition-colors hover:bg-accent/25"
                  >
                    <td className="px-2 py-2 align-top">
                      {/* 最大宽度给内层块（`td` 上的 max-width 在自动布局表格里不可靠）：
                          手机上换行、不横向溢出；`sm` 起单行截断。
                          只有**可能被截断**的才挂 Tooltip：一页几百行，逐个挂 Radix Tooltip 太重。 */}
                      {row.command.length > TRUNCATE_HINT_MIN ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={commandCellClass(row)}>{row.command}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[min(24rem,85vw)] font-mono text-xs break-all">
                            {row.command}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className={commandCellClass(row)}>{row.command}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-foreground">{row.label}</td>
                    {hasNote && (
                      <td className="hidden px-2 py-2 text-2xs text-muted-foreground sm:table-cell">
                        {row.note ?? ''}
                      </td>
                    )}
                    <td className="px-1 py-0.5 align-top">
                      <div className="flex items-center justify-end gap-0.5">
                        {row.syntax ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${t('action.copy')}：${row.command}`}
                            onClick={() => void copy(row.command)}
                          >
                            {copied === row.command ? (
                              <Check className="size-3.5" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </Button>
                        ) : (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${t('commands.col.fill')}：${row.command}`}
                            onClick={() => onPick(row.command)}
                          >
                            <Terminal className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`${t('commands.detail.title')}：${row.command}`}
                          onClick={() => onDetails(row)}
                        >
                          <Info className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {group.footnote && (
                  <tr className="border-t border-border/40">
                    <td colSpan={columnCount} className="px-2 py-1">
                      {group.footnote}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}

/** 右侧分组列表（桌面常驻 / 手机抽屉共用）。 */
function GroupList({
  entries,
  activeId,
  total,
  onSelect,
}: {
  entries: { id: string; title: string; count: number }[]
  activeId: string | null
  total: number
  onSelect: (id: string | null) => void
}) {
  const { t } = useI18n()
  const item = (id: string | null, title: string, count: number) => {
    const active = activeId === id
    return (
      <button
        key={id ?? 'all'}
        type="button"
        data-group-active={active || undefined}
        aria-pressed={active}
        onClick={() => onSelect(id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-xs transition-colors',
          active
            ? 'bg-accent font-semibold text-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-2xs tabular-nums opacity-70">{count}</span>
      </button>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-0.5">
      {item(null, t('commands.groups.all'), total)}
      <div className="my-1 border-t border-border/60" />
      {entries.map((entry) => item(entry.id, entry.title, entry.count))}
    </div>
  )
}

/**
 * 指令小抄（侧边栏首组，紧跟在「指令」下面）：世界事件 / 世界模式 / 时间 / NPC 召唤与管理 /
 * 物品与增益 / 传送 / 建筑与保护 / 用户（玩家）管理 / 权限配置 / 服务器 / 聊天与统计。
 *
 * 布局：**左边搜索框 + 表格，右边分组列表**（手机端分组收进抽屉）。
 * 点一条具体指令把完整指令覆盖到右下角「指令」浮窗（不自动执行）；
 * 参考行（语法带占位符）只提供复制。
 * 权限与执行结果都由 TShock 判定。
 */
export function CommandTipsPage({ dataset, onNavigate, onPick }: CommandTipsPageProps) {
  const { t, lang } = useI18n()
  const { open } = useTerminal()
  const pick = onPick ?? open
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false)
  /** 详情抽屉：点哪一行就看哪一行的指令帮助。 */
  const [detail, setDetail] = useState<TableRow | null>(null)
  // 页面不固定高度：内容多就把页面撑高，滚动交给主内容区（浏览器右侧那条滚动条）。
  const rootRef = useRef<HTMLDivElement>(null)
  // 工具条吸在顶栏（`top-12`）下面，表头再吸在工具条下面 → 实测工具条高度写进 CSS 变量。
  const toolbarRef = useRef<HTMLDivElement>(null)
  const stickyTop = useStickyHeaderOffset(toolbarRef)
  // 切页回来时把主内容区滚回顶部（整页滚动的页面共用同一个滚动条）。
  usePageScrollReset(rootRef)

  const commandsByName = useMemo(() => {
    const map = new Map<string, CommandDef>()
    for (const command of dataset.commands) map.set(command.name.toLowerCase(), command)
    return map
  }, [dataset])

  // `sb` → NPC：用于取本地化名称（`/spawnboss` 的规范参数已在生成数据里）。
  const bySb = useMemo(() => {
    const map = new Map<string, Npc>()
    for (const npc of dataset.npcsById.values()) {
      if (npc.sb) map.set(npc.sb, npc)
    }
    return map
  }, [dataset])

  // 示例行按 `NPCID` 常量名解析（数据里没有就跳过，绝不瞎编 ID）。
  const byKey = useMemo(() => {
    const map = new Map<string, Npc>()
    for (const npc of dataset.npcs) map.set(npc.key, npc)
    return map
  }, [dataset])

  /**
   * 有具体指令的分组：这里给的是**点了就能执行**的完整指令（不带占位符）。
   * 参考型分组（`TIPS_GROUPS[].commands`）的行由 `referenceRows()` 从 `data/commands.json` 生成。
   */
  const curatedRows = useMemo<Record<string, TableRow[]>>(() => {
    const bosses = SPAWN_BOSS_TIPS.map((tip) => {
      const npc = bySb.get(tip.sb)
      return {
        command: spawnBossCommand(tip.sb),
        label: tip.name?.[lang] ?? npc?.name ?? tip.sb,
        note: tip.note?.[lang],
      }
    })
    const mobExamples = SPAWN_MOB_EXAMPLES.map((key) => byKey.get(key)).filter(
      (npc): npc is Npc => Boolean(npc),
    )
    const tpExamples = TP_NPC_EXAMPLES.map((key) => byKey.get(key)).filter(
      (npc): npc is Npc => Boolean(npc),
    )
    return {
      event: toRows(WORLD_EVENT_COMMANDS, lang),
      invasion: toRows(WORLD_INVASION_COMMANDS, lang),
      holiday: toRows(HOLIDAY_COMMANDS, lang),
      worldmode: toRows(WORLD_MODE_COMMANDS, lang),
      time: toRows(TIME_COMMANDS, lang),
      wind: toRows(WIND_COMMANDS, lang),
      boss: bosses,
      mob: mobExamples.map((npc) => ({
        command: spawnMobCommand(npc.id),
        label: npc.name,
        note: `#${npc.id}`,
      })),
      npctp: tpExamples.map((npc) => ({
        command: tpNpcCommand(npc),
        label: npc.name,
        note: `#${npc.id}`,
      })),
      spawnrate: toRows(SPAWN_RATE_COMMANDS, lang),
      godmode: toRows(GODMODE_COMMANDS, lang),
      useradmin: toRows(USER_ACCOUNT_COMMANDS, lang),
      ban: toRows(BAN_COMMANDS, lang),
      permsetup: toRows(PERM_SETUP_COMMANDS, lang),
    }
  }, [bySb, byKey, lang])

  /** 分组 → 表内分区（标题 / 语法 / 说明 / 行 / 脚注）。 */
  const sections = useMemo<TableSection[]>(() => {
    /**
     * 参考行：`/give <item type/id> <player> …` 这种语法来自 `data/commands.json` 的 `paramSets`
     * （TShock 源码提取），每个 `paramSet` 一行；`allowServer=false` 的标「仅游戏内」。
     * 同一条指令的说明只写在该指令的第一行（`/region` 有 10 个子命令，不至于重复 10 次）。
     */
    const referenceRows = (group: TipsGroup): TableRow[] => {
      const curated = new Set((curatedRows[group.id] ?? []).map((row) => commandName(row.command)))
      const rows: TableRow[] = []
      for (const name of group.commands ?? []) {
        if (curated.has(name.toLowerCase())) continue
        const command = commandsByName.get(name.toLowerCase())
        if (!command) continue
        const syntaxes = command.paramSets?.length
          ? [...new Set(command.paramSets.map((set) => set.syntax))]
          : [command.name]
        const help = command.helpZh ?? command.help
        syntaxes.forEach((syntax, index) => {
          rows.push({
            command: `/${syntax}`,
            label: index === 0 ? help : '',
            note: index === 0 && !command.allowServer ? t('commands.onlyInGame') : undefined,
            syntax: true,
            def: command,
          })
        })
      }
      return rows
    }

    const moreNpcs = (
      <Button
        variant="ghost"
        size="sm"
        className="px-1 text-muted-foreground"
        onClick={() => {
          rememberDataIdState({ ...readDataIdState(), kind: 'npc', npcFilter: '', scrollTop: 0 })
          onNavigate('dataid')
        }}
      >
        <ExternalLink data-icon="inline-start" />
        {t('commands.group.npctp.more')}
      </Button>
    )
    return TIPS_GROUPS.map((group) => {
      const title = t(group.titleKey)
      const usage = group.usageKey ? t(group.usageKey) : undefined
      // 详情抽屉要「这一类怎么写 / 权限 / 是否只能游戏内」，所以把上下文挂到行上。
      const rows = [...(curatedRows[group.id] ?? []), ...referenceRows(group)].map((row) => ({
        ...row,
        usage,
        groupTitle: title,
        def: row.def ?? commandsByName.get(commandName(row.command)),
      }))
      return {
        id: group.id,
        title,
        usage,
        hint: group.hintKey ? t(group.hintKey) : undefined,
        rows,
        footnote: group.npcLink ? moreNpcs : undefined,
      }
    })
  }, [t, curatedRows, commandsByName, onNavigate])

  const entries = useMemo(
    () => sections.map((section) => ({ id: section.id, title: section.title ?? '', count: section.rows.length })),
    [sections],
  )
  const total = useMemo(() => entries.reduce((sum, entry) => sum + entry.count, 0), [entries])

  // 搜索命中分类 / 语法 / 说明就整段留下；否则逐行匹配「指令 + 名称 + 备注」。
  // 大小写不敏感，中文名（helpZh / 说明）也能搜。
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const scoped = activeId ? sections.filter((section) => section.id === activeId) : sections
    return scoped
      .map((section) => {
        const sectionText =
          `${section.title ?? ''} ${section.usage ?? ''} ${section.hint ?? ''}`.toLowerCase()
        const sectionHit = !q || sectionText.includes(q)
        return {
          section,
          hit: sectionHit,
          rows: section.rows.filter(
            (row) =>
              sectionHit ||
              `${row.command} ${row.label} ${row.note ?? ''}`.toLowerCase().includes(q),
          ),
        }
      })
      .filter(({ section, hit, rows }) => rows.length > 0 || (hit && Boolean(section.title || section.usage || section.hint)))
      .map(({ section, rows }) => ({ ...section, rows }))
  }, [sections, activeId, q])

  const activeTitle = useMemo(() => {
    const found = TIPS_GROUPS.find((group) => group.id === activeId)
    return found ? t(found.titleKey) : t('commands.groups.all')
  }, [activeId, t])

  /** 选中分组：清空搜索（避免「选了组又搜不到」的死路）。 */
  const selectGroup = (id: string | null) => {
    setActiveId(id)
    setQuery('')
    setGroupDrawerOpen(false)
  }

  return (
    <div
      ref={rootRef}
      data-testid="command-tips-page"
      className="relative flex min-h-[360px] flex-col gap-2"
      style={{ '--page-sticky-top': `${stickyTop}px` } as CSSProperties}
    >
      <Alert variant="info" className="shrink-0">
        <AlertDescription className="text-xs">{t('commands.notice.perm')}</AlertDescription>
      </Alert>

      <div className="flex items-start gap-3">
        {/* 左：搜索框（吸顶）+ 表格（整页滚动） */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            ref={toolbarRef}
            className="sticky top-12 z-20 flex items-center gap-2 bg-background py-1.5"
          >
            <div className="min-w-0 flex-1">
              <SearchInput
                value={query}
                onValueChange={(value) => {
                  setQuery(value)
                  if (value) setActiveId(null)
                }}
                placeholder={t('commands.search.placeholder')}
                aria-label={t('commands.search.placeholder')}
                leadingIcon={<Search className="size-4 text-muted-foreground" />}
                shortcut
              />
            </div>
            {/* 手机 / 窄屏：分组收进抽屉，按钮显示当前分组 */}
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-2 px-2 text-xs text-muted-foreground lg:hidden"
              aria-label={t('commands.groups')}
              onClick={() => setGroupDrawerOpen(true)}
            >
              <ListFilter className="size-3.5" />
              <span className="max-w-28 truncate">{activeTitle}</span>
            </Button>
          </div>

          {visible.length === 0 ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>{t('commands.search.empty')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <CommandTable groups={visible} onPick={pick} onDetails={setDetail} />
          )}
        </div>

        {/* 右：分组列表（桌面常驻；窄屏走抽屉） */}
        <aside
          aria-label={t('commands.groups')}
          className="hidden w-44 shrink-0 flex-col gap-1 border-l border-border/60 pl-3 lg:sticky lg:top-12 lg:flex lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:overscroll-contain lg:self-start"
        >
          <div className="shrink-0 px-2 pb-1 text-2xs text-muted-foreground">
            {t('commands.groups')}
          </div>
          <GroupList entries={entries} activeId={activeId} total={total} onSelect={selectGroup} />
        </aside>
      </div>

      <Drawer open={groupDrawerOpen} onOpenChange={setGroupDrawerOpen} swipeDirection="right">
        <DrawerContent className="flex w-64 flex-col">
          <DrawerHeader className="flex-row items-center border-b px-4 py-3">
            <DrawerTitle className="min-w-0 flex-1">{t('commands.groups')}</DrawerTitle>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('action.close')}
              onClick={() => setGroupDrawerOpen(false)}
            >
              <X />
            </Button>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            <GroupList
              entries={entries}
              activeId={activeId}
              total={total}
              onSelect={selectGroup}
            />
          </div>
        </DrawerContent>
      </Drawer>

      <CommandDetailDrawer row={detail} onClose={() => setDetail(null)} onPick={pick} />
    </div>
  )
}

/** 详情抽屉里的一行：左标签 + 右内容。 */
function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="text-xs break-words text-foreground">{children}</dd>
    </div>
  )
}

/**
 * 右侧「指令帮助」抽屉。
 *
 * 一张表里同一类指令很多（`/worldevent bloodmoon`、`/worldevent eclipse` …），
 * 所以先给**这一类怎么写**（规范写法 = 分区的语法行），再给这一条的
 * 权限（`tshock.world.events` 之类，来自 `data/commands.json`）、能否在网页端执行（`allowServer`）、
 * TShock 的帮助原文与别名。
 */
function CommandDetailDrawer({
  row,
  onClose,
  onPick,
}: {
  row: TableRow | null
  onClose: () => void
  onPick: (command: string) => void
}) {
  const { t } = useI18n()
  const def = row?.def
  const canonical = row?.usage ?? row?.command ?? ''
  const help = def?.helpZh ?? def?.help
  return (
    <Drawer
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      swipeDirection="right"
    >
      <DrawerContent data-testid="command-detail" className="flex w-full flex-col sm:max-w-sm">
        <DrawerHeader className="flex-row items-start gap-2 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DrawerTitle>{t('commands.detail.title')}</DrawerTitle>
            <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{row?.command}</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={t('action.close')} onClick={onClose}>
            <X />
          </Button>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <dl className="flex flex-col gap-3">
            {canonical && (
              <DetailField label={t('commands.detail.canonical')}>
                <span className="font-mono text-2xs whitespace-pre-line">{canonical}</span>
              </DetailField>
            )}
            {row?.groupTitle && (
              <DetailField label={t('commands.detail.group')}>{row.groupTitle}</DetailField>
            )}
            {def && (
              <DetailField label={t('commands.detail.permission')}>
                <span className="font-mono text-2xs">
                  {def.permission ?? t('commands.detail.noPermission')}
                </span>
              </DetailField>
            )}
            {def && (
              <DetailField label={t('commands.detail.where')}>
                {def.allowServer
                  ? t('commands.detail.where.web')
                  : t('commands.detail.where.ingame')}
              </DetailField>
            )}
            {help && <DetailField label={t('commands.detail.about')}>{help}</DetailField>}
            {def && def.aliases.length > 0 && (
              <DetailField label={t('commands.detail.aliases')}>
                <span className="font-mono text-2xs">
                  {def.aliases.map((alias) => `/${alias}`).join('、')}
                </span>
              </DetailField>
            )}
          </dl>
        </div>

        <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (row) void navigator.clipboard?.writeText(row.command)
            }}
          >
            <Copy data-icon="inline-start" />
            {t('commands.detail.copy')}
          </Button>
          {row && !row.syntax && (
            <Button
              size="sm"
              onClick={() => {
                onPick(row.command)
                onClose()
              }}
            >
              <Terminal data-icon="inline-start" />
              {t('commands.detail.fill')}
            </Button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
