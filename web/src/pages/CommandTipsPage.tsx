import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronRight, Copy, ListFilter, Search, Terminal, X } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { ContentScrim } from '@/components/ContentScrim'
import { IconAction } from '@/components/IconAction'
import { PageHelp } from '@/components/PageHelp'
import { SearchInput } from '@/components/SearchInput'
import { usePageScrollReset, useStickyHeaderOffset } from '@/hooks/usePageScroll'
import { useIsMobile } from '@/hooks/use-mobile'
import { TIPS_GROUPS, type TipsGroup } from '@/lib/commandTips'
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
import type { CommandDef, Dataset, Npc } from '@/types'

interface CommandTipsPageProps {
  dataset: Dataset
  /** 详情里「填入」的去向；默认填进浮动终端，指令页里改为填进页面输入框。 */
  onPick?: (command: string) => void
}

interface TableRow {
  command: string
  label: string
  note?: string
  /**
   * 参考行：语法带占位符（`/give <物品> <玩家>`），点了也跑不通，
   * 所以详情里**只给复制**；`false` / 省略 = 详情里可「填入指令浮窗」。
   */
  syntax?: boolean
  /** 详情：这一类指令的**语法**（分区的语法行，如 `/worldevent <事件>`）。 */
  usage?: string
  /** 详情抽屉：这一组的额外提示（原来表格里的说明行，如「/tpnpc 只认名称」）。 */
  hint?: string
  /** 详情抽屉：对应的内置指令定义（权限 / 是否可网页执行 / 说明 / 别名）。 */
  def?: CommandDef
  /** 表格里归到哪个折叠行（见 `CommandTip.fold`）。 */
  fold?: string
  /** 折叠行的「说明」（见 `CommandTip.foldLabel`）。 */
  foldLabel?: string
}

/** 表内分区：`title` 是折叠行的「说明」，`hint` 是行详情的提示（都不再单独占一行）。 */
interface TableSection {
  id: string
  title?: string
  usage?: string
  hint?: string
  /** 显式折叠组（见 `TipsGroup.folds`）。 */
  folds?: readonly (readonly string[])[]
  rows: TableRow[]
}

/** `CommandTip`（中英双名）→ 表行（按当前语言取名称 / 备注）。 */
function toRows(commands: readonly CommandTip[], lang: 'zh' | 'en'): TableRow[] {
  return commands.map((row) => ({
    command: row.command,
    label: row.label[lang],
    note: row.note?.[lang],
    fold: row.fold,
    foldLabel: row.foldLabel?.[lang],
  }))
}

/**
 * 指令列多短就肯定不会截断（最窄的手机 11rem ≈ 22 个等宽字符）。
 * 更短的不挂 Tooltip —— 一页几百行，逐个挂 Radix Tooltip 会明显拖慢渲染。
 */
const TRUNCATE_HINT_MIN = 22

/** 只能在游戏内执行（`allowServer=false`）：指令用红色标出来（语义色 `text-destructive`）。 */
function ingameOnly(row: TableRow): boolean {
  return row.def?.allowServer === false
}

/**
 * 指令列的内层 span：单行、超出省略（`truncate`），宽度按断点上限。
 * 表格单元格上直接写 `max-width` 不可靠，所以限宽给内层块。
 */
function commandCellClass(ingame = false): string {
  return cn(
    'block max-w-[11rem] truncate font-mono text-xs sm:max-w-[16rem] xl:max-w-[22rem]',
    ingame ? 'text-destructive' : 'text-foreground',
  )
}

/** `/give <item type/id>` → `give`。 */
function commandName(command: string): string {
  const first = command.trim().replace(/^\//, '').split(/\s+/)[0] ?? ''
  return first.toLowerCase()
}

/** 按空白切分指令，双引号里的空格不切：`/spawnboss "king slime"` → `['/spawnboss', '"king slime"']`。 */
function commandTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of command.trim()) {
    if (char === '"') {
      quoted = !quoted
      current += char
    } else if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) tokens.push(current)
  return tokens
}

/** 折叠组的公共前缀：`/worldevent invasion goblins` → `/worldevent invasion`；单段指令就是它自己。 */
function commandStem(tokens: string[]): string[] {
  return tokens.length > 1 ? tokens.slice(0, -1) : tokens
}

/**
 * 最多折到「指令 + 一个子命令」（`/worldevent invasion`、`/worldmode`）：
 * 再往下的已经是参数了（`/group addperm default <权限>`），折起来反而看不出是哪一条。
 */
const FOLD_MAX_DEPTH = 2

/**
 * 行外观：斑马纹（奇行浅底，与物品 / 数据 ID 表格同一套）+ 悬停加深。
 * 折叠行、子行、普通行共用，展开收起后条纹自动重排。
 */
const ROW_CLASS =
  'cursor-pointer border-t border-border/40 align-top transition-colors odd:bg-muted/25 hover:bg-accent/25'

/** 一个分区的显示项：折叠组（`stem` 非空）或单行（`stem` 为空）。 */
interface RowGroup {
  stem: string | null
  rows: TableRow[]
}

/**
 * 同一前缀的行折成一组，默认收起。
 *
 * - **语法行**（`syntax`，来自 `commands.json` 的 `paramSets`）：按**指令名**折，
 *   `/region define` / `/region protect` / … → `/region`；
 * - **具体行**（curated）：去掉最后一个参数，最多折到「指令 + 一个子命令」
 *   （`/worldevent invasion goblins` → `/worldevent invasion`；再往下的已经是参数，折了看不出是哪条）；
 * - `folds` 显式指定的几条指令折成一组（首条作为折叠行，如 `/death`）；
 * - 单条指令可以自己声明 `fold`（如权限配置里那几条 `/group addperm …` 归到 `/group`，插件权限归到 `hf 常用`）。
 */
function toRowGroups(
  rows: TableRow[],
  folds: readonly (readonly string[])[] = [],
): RowGroup[] {
  const explicit = new Map<string, string>()
  for (const fold of folds) {
    const stem = `/${fold[0]}`
    for (const name of fold) explicit.set(name.toLowerCase(), stem)
  }
  const stems = rows.map((row) => {
    if (row.fold) return row.fold
    const explicitStem = explicit.get(commandName(row.command))
    if (explicitStem) return explicitStem
    const tokens = commandTokens(row.command)
    if (row.syntax) return tokens[0] ?? null
    const stem = commandStem(tokens)
    return stem.length <= FOLD_MAX_DEPTH ? stem.join(' ') : null
  })
  const counts = new Map<string, number>()
  for (const stem of stems) {
    if (stem) counts.set(stem, (counts.get(stem) ?? 0) + 1)
  }
  const groups: RowGroup[] = []
  const index = new Map<string, number>()
  rows.forEach((row, i) => {
    const stem = stems[i]
    if (!stem || (counts.get(stem) ?? 0) < 2) {
      groups.push({ stem: null, rows: [row] })
      return
    }
    const at = index.get(stem)
    if (at === undefined) {
      index.set(stem, groups.length)
      groups.push({ stem, rows: [row] })
    } else {
      groups[at]!.rows.push(row)
    }
  })
  return groups
}

/**
 * 指令单元格。只有**可能被截断**的才挂 Tooltip：一页几百行，逐个挂 Radix Tooltip 太重。
 * 左边固定留出折叠箭头的宽度（折叠行自己画箭头），这样**所有行的指令都从同一条竖线开始**。
 * `indent` 用于折叠组里的子行（缩进一级表示层级）。
 */
function CommandCell({
  text,
  className,
  indent,
}: {
  text: string
  className: string
  indent?: boolean
}) {
  const content = <span className={className}>{text}</span>
  return (
    <td className={cn('px-2 py-2 align-top', indent && 'pl-6')}>
      <div className="flex min-w-0 items-start gap-1">
        <span className="size-3.5 shrink-0" aria-hidden />
        {text.length > TRUNCATE_HINT_MIN ? (
          <Tooltip>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent className="max-w-[min(24rem,85vw)] font-mono text-xs break-all">
              {text}
            </TooltipContent>
          </Tooltip>
        ) : (
          content
        )}
      </div>
    </td>
  )
}

/**
 * 指令表格：**指令在第一列**，后面是说明 / 备注。**单击一行打开右侧详情**（复制 / 填入都在详情里）。
 *
 * - 同一前缀的行（`/worldevent invasion …`、`/worldmode …`）默认折成一行，点一下展开；
 *   分组标题不单独占一行，而是折叠行的「说明」（`/worldevent` → 世界事件）；
 * - 参考行（`syntax` 为真）：语法带占位符，填进浮窗也跑不通，详情里只给复制；
 * - 表格**不在卡片里**，本身也不滚动：整页交给 AppShell 的 `<main>` 滚（浏览器右侧那条滚动条），
 *   表头吸在**工具条下面**（`--page-sticky-top`，实测工具条高度）；
 * - **指令列有最大宽度**：手机较窄（长指令换行，不横向溢出），`sm` 起单行截断 + 悬停 Tooltip 看全。
 */
function CommandTable({
  groups,
  expandAll,
  onDetails,
}: {
  groups: TableSection[]
  /** 搜索时强制展开：否则命中的行藏在折叠组里。 */
  expandAll: boolean
  onDetails: (row: TableRow) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const onlyInGame = t('commands.onlyInGame')
  const hasNote = groups.some((group) =>
    group.rows.some((row) => row.note || ingameOnly(row)),
  )

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /**
   * 说明列：单行、超出省略。`w-full max-w-0` 是让单元格能省略的固定写法
   * （单元格自己的 `max-width` 在自动布局表格里不可靠，靠它把剩余宽度吃掉）。
   */
  const labelCell = (label: string) => (
    <td className="w-full max-w-0 px-2 py-2 text-xs text-foreground">
      <div className="truncate">{label}</div>
    </td>
  )

  /** 备注列：单行、超出省略（手机端隐藏）。 */
  const noteCell = (note: string) => (
    <td className="hidden w-[7.5rem] px-2 py-2 text-2xs text-foreground sm:table-cell">
      <div className="truncate">{note}</div>
    </td>
  )

  /**
   * 一行三格。备注列：行自己的备注（`#22` 等）；**仅游戏内**的标记只给「不缩进的单行」——
   * 折叠组里的子行不再重复（父行已经标了）。
   */
  const rowCells = (row: TableRow, text: string, indent: boolean) => {
    const note = row.note ?? (!indent && ingameOnly(row) ? onlyInGame : '')
    return (
      <>
        <CommandCell text={text} className={commandCellClass(ingameOnly(row))} indent={indent} />
        {labelCell(row.label)}
        {hasNote && noteCell(note)}
      </>
    )
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
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.id}>
                {toRowGroups(group.rows, group.folds).map((entry, i) => {
                  const key = `${group.id}:${entry.stem ?? entry.rows[0]!.command}:${i}`
                  if (entry.stem) {
                    const open = expandAll || expanded.has(key)
                    // 整组都只能在游戏内执行 → 标记只写在折叠行（子行不重复）
                    const allIngame = entry.rows.every(ingameOnly)
                    // 折叠行的「说明」：条目可以自己声明（`/worldevent rain` → 雨），否则用分区标题。
                    const foldLabel = entry.rows.find((row) => row.foldLabel)?.foldLabel ?? group.title
                    return (
                      <Fragment key={key}>
                        <tr
                          data-fold={entry.stem}
                          onClick={() => toggle(key)}
                          className={ROW_CLASS}
                        >
                          <td className="px-2 py-2 align-top">
                            {/* 按钮只是为了键盘可用：单击冒泡到整行，所以这里不再挂 onClick。 */}
                            <button
                              type="button"
                              aria-expanded={open}
                              className="flex w-full items-start gap-1 text-left"
                            >
                              <ChevronRight
                                className={cn(
                                  'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform',
                                  open && 'rotate-90',
                                )}
                              />
                              <span className={commandCellClass(allIngame)}>{entry.stem}</span>
                            </button>
                          </td>
                          <td className="w-full max-w-0 px-2 py-2 text-xs text-foreground">
                            <div className="truncate">{foldLabel}</div>
                          </td>
                          {hasNote && noteCell(allIngame ? onlyInGame : '')}
                        </tr>
                        {open &&
                          entry.rows.map((row, j) => (
                            <tr
                              key={`${key}:${j}`}
                              data-command={row.command}
                              onClick={() => onDetails(row)}
                              className={ROW_CLASS}
                            >
                              {rowCells(row, row.command, true)}
                            </tr>
                          ))}
                      </Fragment>
                    )
                  }
                  const row = entry.rows[0]!
                  return (
                    <tr
                      key={key}
                      data-command={row.command}
                      onClick={() => onDetails(row)}
                      className={ROW_CLASS}
                    >
                      {rowCells(row, row.command, false)}
                    </tr>
                  )
                })}
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
 * 物品与增益 / 传送 / 建筑与保护 / 玩家账号 / 权限配置 / 服务器 / 聊天与统计。
 *
 * 布局：**左边搜索框 + 表格，右边分组列表**（手机端分组收进抽屉）。
 * **单击一行打开右侧详情**，在详情里复制或把完整指令填进右下角「指令」浮窗（不自动执行）；
 * 参考行（语法带占位符）在详情里只提供复制。
 * 权限与执行结果都由 TShock 判定。
 */
export function CommandTipsPage({ dataset, onPick }: CommandTipsPageProps) {
  const { t, lang } = useI18n()
  const { open } = useTerminal()
  const pick = onPick ?? open
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false)
  // 两个抽屉（分组 / 指令详情）：手机端是自带遮罩的模态，桌面端只盖内容区（`ContentScrim`）。
  const isMobileDrawer = useIsMobile()
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
      account: toRows(USER_ACCOUNT_COMMANDS, lang),
      ban: toRows(BAN_COMMANDS, lang),
      permsetup: toRows(PERM_SETUP_COMMANDS, lang),
    }
  }, [bySb, byKey, lang])

  /** 分组 → 表内分区（标题 / 说明 / 行；`usage` 只给详情抽屉）。 */
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
            syntax: true,
            def: command,
          })
        })
      }
      return rows
    }

    return TIPS_GROUPS.map((group) => {
      const title = t(group.titleKey)
      const usage = group.usageKey ? t(group.usageKey) : undefined
      const hint = group.hintKey ? t(group.hintKey) : undefined
      // 详情要「这一类怎么写 / 权限 / 有什么坑」，所以把上下文挂到行上。
      const rows = [...(curatedRows[group.id] ?? []), ...referenceRows(group)].map((row) => ({
        ...row,
        usage,
        hint,
        def: row.def ?? commandsByName.get(commandName(row.command)),
      }))
      return {
        id: group.id,
        title,
        usage,
        hint,
        folds: group.folds,
        rows,
      }
    })
  }, [t, curatedRows, commandsByName])

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
              `${row.command} ${row.label} ${row.note ?? ''} ${row.hint ?? ''}`
                .toLowerCase()
                .includes(q),
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
      <PageHelp scopeId="tips">
        <span className="whitespace-pre-line">{t('page.tips.desc')}</span>
      </PageHelp>

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
            <CommandTable groups={visible} expandAll={q.length > 0} onDetails={setDetail} />
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

      {/* 遮罩：桌面端只盖内容区（左侧边栏露着、可点）；手机端抽屉自带模态遮罩。 */}
      {groupDrawerOpen && !isMobileDrawer && (
        <ContentScrim testId="commands-groups-scrim" onClick={() => setGroupDrawerOpen(false)} />
      )}
      <Drawer
        open={groupDrawerOpen}
        onOpenChange={setGroupDrawerOpen}
        swipeDirection="right"
        modal={isMobileDrawer}
        // 非模态时 Base UI 默认「点外面 / 焦点离开」就关：点左侧导航是切页，不该顺手关面板。
        disablePointerDismissal={!isMobileDrawer}
      >
        <DrawerContent overlay={isMobileDrawer} className="flex w-64 flex-col">
          <DrawerHeader className="flex-row items-center border-b px-4 py-3">
            <DrawerTitle className="min-w-0 flex-1">{t('commands.groups')}</DrawerTitle>
            <IconAction
              label={t('action.close')}
              icon={X}
              onClick={() => setGroupDrawerOpen(false)}
            />
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

      <CommandDetailDialog row={detail} onClose={() => setDetail(null)} onPick={pick} />
    </div>
  )
}

/** 详情里的一行：上标签 + 下内容（多行文本保留换行）。 */
function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-2xs text-foreground">{label}</dt>
      <dd className="text-xs break-words whitespace-pre-line text-foreground">{children}</dd>
    </div>
  )
}

/**
 * 「指令帮助」弹框（居中 dialog）。
 *
 * 一张表里同一类指令很多（`/worldevent bloodmoon`、`/worldevent eclipse` …），
 * 所以先给**这一类怎么写**（指令语法 = 分区的语法行），再给这一条的
 * 权限（`tshock.world.events` 之类，来自 `data/commands.json`）、能否在网页端执行（`allowServer`）、
 * 这一组的提示与别名。
 *
 * 用 dialog 而不是右侧抽屉：规范写法 / 权限 / 提示文字都很长，抽屉那点宽度只能频繁折行。
 */
function CommandDetailDialog({
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
  // 和这一行自己的指令一样就不重复（分区没写语法时 `usage` 为空）。
  const canonical = row?.usage && row.usage !== row.command ? row.usage : ''
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        data-testid="command-detail"
        // 标题 + 指令就是说明，不再额外渲染 `DialogDescription`。
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"
        // Radix 默认聚焦第一个可 Tab 元素（这里是指令旁的复制键）；改成聚焦弹框本身（标题可读）。
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.target as HTMLElement | null)?.focus()
        }}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-10">
          <DialogTitle>{t('commands.detail.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {/* 上段：这条指令怎么用（指令 + 说明 + 使用提示） */}
          <CommandBlock value={row?.command ?? ''} testId="command-detail-copy" />
          {row?.label && <p className="mt-2 text-xs text-foreground">{row.label}</p>}
          {row?.hint && (
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="text-2xs text-foreground">{t('commands.detail.hint')}</span>
              <p className="text-2xs leading-relaxed whitespace-pre-line text-foreground">
                {row.hint}
              </p>
            </div>
          )}

          {/* 下段：技术细节（指令语法 / 权限），字号降一档、颜色变淡 */}
          <dl className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-3">
            {canonical && (
              <DetailField label={t('commands.detail.canonical')}>
                <span className="font-mono text-2xs whitespace-pre-line text-foreground">
                  {canonical}
                </span>
              </DetailField>
            )}
            {def &&
              (def.permission ? (
                <DetailField label={t('commands.detail.permission')}>
                  <InlineCopy value={def.permission} testId="command-detail-permission-copy" />
                </DetailField>
              ) : (
                <DetailField label={t('commands.detail.permission')}>
                  {t('commands.detail.noPermission')}
                </DetailField>
              ))}
          </dl>

          {/* 元信息：别名（没有别名就不占位） */}
          {def && def.aliases.length > 0 && (
            <div className="mt-3 text-2xs text-foreground">
              <span className="font-mono">
                {t('commands.detail.aliases')} {def.aliases.map((alias) => `/${alias}`).join(' ')}
              </span>
            </div>
          )}
        </div>

        {/* 底部操作区：通栏 + 浅底（与卡片区分） */}
        {row && !row.syntax && (
          <DialogFooter className="mx-0 mt-0 mb-0 shrink-0 bg-muted/50 px-4 py-3">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onPick(row.command)
                onClose()
              }}
            >
              <Terminal data-icon="inline-start" />
              {t('commands.detail.fill')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 复制到剪贴板，并给出 1.2s 的「已复制」状态（图标换 ✓）。 */
function useCopy(value: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => setCopied(false))
  }
  return [copied, copy]
}

/** 悬停 / 聚焦才出现的复制键（触屏常显）；跟在文字右边，不占常驻视觉重量。 */
function CopyOnHover({
  copied,
  testId,
  onCopy,
}: {
  copied: boolean
  testId?: string
  onCopy: () => void
}) {
  const { t } = useI18n()
  return (
    <span className="touch-visible flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/copy:opacity-100 group-hover/copy:opacity-100">
      <IconAction
        size="icon-xs"
        testId={testId}
        label={copied ? t('action.copied') : t('action.copy')}
        icon={copied ? Check : Copy}
        iconClassName="size-3.5"
        onClick={onCopy}
      />
    </span>
  )
}

/**
 * 详情顶部的**指令本身**：等宽加粗、比正文大一号、无底色。
 * 复制键跟在指令右边，悬停 / 聚焦才出现。
 */
function CommandBlock({ value, testId }: { value: string; testId?: string }) {
  const [copied, copy] = useCopy(value)
  return (
    <div className="group/copy flex min-w-0 flex-wrap items-center gap-1">
      <span className="min-w-0 font-mono text-sm font-semibold break-all text-foreground">
        {value}
      </span>
      <CopyOnHover copied={copied} testId={testId} onCopy={copy} />
    </div>
  )
}

/** 详情里的**权限**：一行小字（超出省略），无底色，悬停时旁边出现复制键。 */
function InlineCopy({ value, testId }: { value: string; testId?: string }) {
  const [copied, copy] = useCopy(value)
  return (
    <div className="group/copy flex min-w-0 items-center gap-1">
      <span className="min-w-0 font-mono text-2xs truncate text-foreground">{value}</span>
      <CopyOnHover copied={copied} testId={testId} onCopy={copy} />
    </div>
  )
}
