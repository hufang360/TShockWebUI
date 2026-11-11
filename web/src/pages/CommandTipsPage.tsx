import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { Check, ChevronRight, Copy, ExternalLink, ListFilter, Search, Terminal, X } from 'lucide-react'
import {
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Popover,
  PopoverAnchor,
  PopoverContent,
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
import { TIPS_GROUPS, RELATED_COMMANDS, type TipsGroup } from '@/lib/commandTips'
import { enumLabelsFor } from '@/lib/commandMeta'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { readDataIdState, rememberDataIdState } from '@/lib/dataIdState'
import { useI18n } from '@/lib/i18n'
import { useSearchIntent } from '@/lib/searchIntent'
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

/** 参考行的说明：取子命令标签（`/region define` → 定义区域）；占位符开头的（`/warp <warpname>`）没有。 */
function subcommandLabel(syntax: string, labels: Record<string, string>): string {
  const first = syntax.trim().split(/\s+/)[1] ?? ''
  if (!first || /^[<[（(]/.test(first)) return ''
  return labels[first.toLowerCase()] ?? ''
}

/**
 * 详情里的「指令语法」：行自己的覆盖 > 分区里给这条指令的语法 > 分区语法行。
 * `selfOnly` 的指令（`/kick` `/mute`）返回行本身 ⇒ 等于 `row.command`，详情里不再重复。
 */
function rowUsage(
  row: TableRow,
  group: TipsGroup,
  sectionUsage: string | undefined,
  t: (key: string) => string,
): string | undefined {
  if (row.usage !== undefined) return row.usage
  const name = commandName(row.command)
  if (group.selfOnly === true || group.selfOnly?.includes(name)) return row.command
  const key = group.usageKeys?.[name]
  return key ? t(key) : sectionUsage
}

/** 详情的「使用提示」：`selfOnly` 的指令不套分区提示（`/tempgroup` 不看 `/group` 的提示）。 */
function rowHint(row: TableRow, group: TipsGroup, sectionHint: string | undefined): string | undefined {
  if (row.hint !== undefined) return row.hint
  const name = commandName(row.command)
  if (group.selfOnly === true || group.selfOnly?.includes(name)) return ''
  return sectionHint
}

interface CommandTipsPageProps {
  dataset: Dataset
  /** 「数据 ID → NPC」入口（详情里的「在数据 ID 里查更多」）。 */
  onNavigate?: (tab: TabId) => void
  /** 详情里「填入」的去向；默认填进浮动终端，指令页里改为填进页面输入框。 */
  onPick?: (command: string) => void
}

/**
 * 详情里额外给「在数据 ID → NPC 里查更多」入口的指令：
 * 这几条的参数是 NPC 名称 / ID，去 NPC 列表查更准。
 */
const NPC_LOOKUP_COMMANDS = new Set(['spawnboss', 'spawnmob', 'tpnpc', 'butcher', 'renamenpc'])

interface TableRow {
  command: string
  label: string
  note?: string
  /**
   * 参考行：语法带占位符（`/give <物品> <玩家>`），点了也跑不通，
   * 所以详情里**只给复制**；`false` / 省略 = 详情里可「执行」（填进浮窗）。
   */
  syntax?: boolean
  /** 详情里这一行的「指令语法」：已按分区 / 指令解析好，`''` = 这条指令没有语法。 */
  usage?: string
  /** 行内详情：这一组的额外提示（原来表格里的说明行，如「/tpnpc 只认名称」）。 */
  hint?: string
  /** 行内详情：对应的内置指令定义（权限 / 别名 / 是否可在网页执行）。 */
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
    usage: row.usage?.[lang],
    fold: row.fold,
    foldLabel: row.foldLabel?.[lang],
  }))
}

/**
 * 单元格里的等宽文字多短就肯定不会截断（最窄的手机 11rem ≈ 22 个等宽字符）。
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
/** 行的公共样式；斑马纹由渲染时的行序号决定（`stripeClass`），不用 `odd:`——插入详情行会让条纹跳。 */
const ROW_CLASS =
  'group/row cursor-pointer border-t border-border/40 align-top transition-colors hover:bg-accent/25'

/** 数据行斑马纹（详情行不计数、也不上色）。 */
const stripeClass = (index: number) => (index % 2 === 1 ? 'bg-muted/25' : '')


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
  // 按显示出来的指令（折叠行用前缀）排 a~z，保证指令列整体有序。
  return groups.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

/** 排序键：去掉开头的 `/` 与引号，大小写不敏感。 */
function sortKey(entry: RowGroup): string {
  const text = entry.stem ?? entry.rows[0]?.command ?? ''
  return text.replace(/^\//, '').replace(/["“”]/g, '').toLowerCase()
}

/** 复制键：复制这段文字，1.2s 内显示 ✓。 */
function RowCopyAction({ value, label }: { value: string; label: string }) {
  const { t } = useI18n()
  const [copied, copy] = useCopy(value)
  return (
    <IconAction
      size="icon-xs"
      label={copied ? t('action.copied') : label}
      icon={copied ? Check : Copy}
      iconClassName="size-3.5"
      onClick={copy}
    />
  )
}

/**
 * 数据行的指令单元格（**没有箭头、没有 hover 按钮**——详情在点击后用浮层给）。
 * 左边固定留出折叠箭头的宽度，这样数据行与折叠行的指令仍从同一条竖线开始。
 * 只有**可能被截断**的才挂 Tooltip：一页几百行，逐个挂 Radix Tooltip 太重。
 */
function CommandCellBody({ row, indent }: { row: TableRow; indent?: boolean }) {
  const text = row.command
  const content = <span className={commandCellClass(ingameOnly(row))}>{text}</span>
  return (
    <td className={cn('px-2 py-2 align-top', indent && 'pl-6')}>
      <div className="flex min-w-0 items-start gap-1">
        <span className="mt-0.5 size-3.5 shrink-0" aria-hidden />
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
 * 权限列（`md` 起显示，手机太窄）：等宽小字、超出省略；没有权限写 `-`。
 * 折叠行传 `undefined`（整组权限不一致，不的代表任何一条）；整组一致时传该权限（`null` = 无权限）。
 */
function PermissionCell({ permission }: { permission?: string | null }) {
  return (
    <td className="hidden w-[10rem] px-2 py-2 align-top md:table-cell">
      {permission === undefined ? null : permission ? (
        <PermissionText value={permission} />
      ) : (
        <span className="text-2xs text-muted-foreground">-</span>
      )}
    </td>
  )
}

/** 权限文字：短的不挂 Tooltip（几百行，逐个挂 Radix Tooltip 太重）。 */
function PermissionText({ value }: { value: string }) {
  const content = (
    <span className="block min-w-0 max-w-[10rem] flex-1 truncate font-mono text-2xs text-foreground">
      {value}
    </span>
  )
  if (value.length <= TRUNCATE_HINT_MIN) return content
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-[min(24rem,85vw)] font-mono text-xs break-all">
        {value}
      </TooltipContent>
    </Tooltip>
  )
}

/** 详情行里的一小块：`标签 + 值`（值可换行）。 */
function DetailBit({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="text-xs break-words whitespace-pre-line text-foreground">{children}</dd>
    </div>
  )
}

/** 详情里的一块可复制文字：浅底 + 悬停出现的复制键（与合成记录条目同一套外观）。 */
function InlineCopy({ value, testId }: { value: string; testId?: string }) {
  const { t } = useI18n()
  const [copied, copy] = useCopy(value)
  return (
    <div className="group/copy flex min-w-0 items-center gap-1 rounded-control bg-muted/40 px-2 py-1">
      <span className="min-w-0 flex-1 font-mono text-2xs break-all text-foreground">{value}</span>
      <span className="touch-visible flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/copy:opacity-100 group-hover/copy:opacity-100">
        <IconAction
          size="icon-xs"
          testId={testId}
          label={copied ? t('action.copied') : t('action.copy')}
          icon={copied ? Check : Copy}
          iconClassName="size-3.5"
          onClick={copy}
        />
      </span>
    </div>
  )
}

/**
 * 行详情浮层（Popover）：内容就是原来那个「指令详情」弹框。
 *
 * 单击数据行弹出、锚在该行的指令单元格上；不进表格流，所以行高不变、条纹不乱。
 * 指令 / 说明 / 权限 / 复制 / 执行这些表格里已经有的，仍然放在这里一份（浮层是完整信息，方便一次看完）。
 */
function RowPopoverBody({
  row,
  onNavigate,
  onFilter,
  onPick,
}: {
  row: TableRow
  onNavigate?: (tab: TabId) => void
  /** 点「相关指令」：把表格过滤到那条，并关掉浮层。 */
  onFilter: (query: string) => void
  onPick: (command: string) => void
}) {
  const { t } = useI18n()
  const def = row.def
  const canonical = row.usage && row.usage !== row.command ? row.usage : ''
  const related = RELATED_COMMANDS[commandName(row.command)] ?? []
  const runnable = !row.syntax && !ingameOnly(row)
  const showNpc = Boolean(onNavigate) && NPC_LOOKUP_COMMANDS.has(commandName(row.command))

  return (
    <div className="flex max-h-[min(32rem,70dvh)] flex-col gap-2 overflow-y-auto overscroll-contain">
      {/* 指令本身：等宽加粗 + 悬停复制 */}
      <div className="group/copy flex min-w-0 flex-wrap items-center gap-1">
        <span
          className={cn(
            'min-w-0 font-mono text-sm font-semibold break-all',
            ingameOnly(row) ? 'text-destructive' : 'text-foreground',
          )}
        >
          {row.command}
        </span>
        <span className="touch-visible flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/copy:opacity-100 group-hover/copy:opacity-100">
          <RowCopyAction value={row.command} label={`${t('commands.col.copy')}${t('commands.col.command')}`} />
        </span>
      </div>
      {row.label && (
        <p className="text-xs text-foreground">
          {row.label}
          {row.note ? <span className="text-2xs"> · {row.note}</span> : null}
        </p>
      )}
      {ingameOnly(row) && <Badge tone="danger">{t('commands.onlyInGame')}</Badge>}
      {row.hint && (
        <p className="text-2xs leading-relaxed whitespace-pre-line text-muted-foreground">
          {row.hint}
        </p>
      )}

      {(canonical || def) && <div className="border-t border-border/60" />}

      <dl className="flex flex-col gap-2">
        {canonical && (
          <DetailBit label={t('commands.row.syntax')}>
            <span className="font-mono text-2xs">{canonical}</span>
          </DetailBit>
        )}
        {def && (
          <DetailBit label={t('commands.col.permission')}>
            {def.permission ? (
              <InlineCopy value={def.permission} testId="command-detail-permission-copy" />
            ) : (
              t('commands.row.noPermission')
            )}
          </DetailBit>
        )}
        {def && def.aliases.length > 0 && (
          <DetailBit label={t('commands.row.aliases')}>
            <span className="font-mono text-2xs">
              {def.aliases.map((alias) => `/${alias}`).join('  ')}
            </span>
          </DetailBit>
        )}
        {related.length > 0 && (
          <DetailBit label={t('commands.row.related')}>
            <span className="flex flex-wrap gap-1">
              {related.map((name) => (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  className="h-6 px-1.5 font-mono text-2xs"
                  onClick={() => onFilter(`/${name}`)}
                >
                  /{name}
                </Button>
              ))}
            </span>
          </DetailBit>
        )}
      </dl>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {showNpc && (
          <Button
            variant="outline"
            size="sm"
            className="sm:mr-auto"
            onClick={() => {
              rememberDataIdState({ ...readDataIdState(), kind: 'npc', npcFilter: '', scrollTop: 0 })
              onNavigate?.('dataid')
            }}
          >
            <ExternalLink data-icon="inline-start" />
            {t('commands.row.npcLink')}
          </Button>
        )}
        {runnable && (
          <Button variant="primary" size="sm" className="ml-auto" onClick={() => onPick(row.command)}>
            <Terminal data-icon="inline-start" />
            {t('commands.col.run')}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * 一行数据：指令 / 说明 / 权限。
 * 单击整行展开「详情行」；悬停时指令列与权限列浮出复制 / 执行（帮助类指令没有执行）。
 */
function CommandRow({
  row,
  rowKey,
  stripe,
  indent,
  onClick,
}: {
  row: TableRow
  rowKey: string
  stripe: string
  indent?: boolean
  onClick: (event: ReactMouseEvent) => void
}) {
  const { t } = useI18n()
  const note = row.note ?? (!indent && ingameOnly(row) ? t('commands.onlyInGame') : '')
  return (
    <tr data-command={row.command} data-row-key={rowKey} onClick={onClick} className={cn(ROW_CLASS, stripe)}>
      <CommandCellBody row={row} indent={indent} />
      <td className="w-full max-w-0 px-2 py-2 text-xs text-foreground">
        <div className="truncate">
          {row.label}
          {note ? <span className="text-2xs"> · {note}</span> : null}
        </div>
      </td>
      <PermissionCell permission={row.def?.permission ?? null} />
    </tr>
  )
}

/**
 * 指令表格：**指令在第一列**，后面是说明 / 权限 / 备注。**单击一行打开右侧详情**（复制 / 填入都在详情里）。
 *
 * - 同一前缀的行（`/worldevent invasion …`、`/worldmode …`）默认折成一行，点一下展开；
 *   分组标题不单独占一行，而是折叠行的「说明」（`/worldevent` → 世界事件）；
 * - 每个分区内的行按**指令列 a~z** 排序（折叠行用它的前缀参与排序）；
 * - 参考行（`syntax` 为真）：语法带占位符，填进浮窗也跑不通，详情里只给复制；
 * - 表格**不在卡片里**，本身也不滚动：整页交给 AppShell 的 `<main>` 滚（浏览器右侧那条滚动条），
 *   表头吸在**工具条下面**（`--page-sticky-top`，实测工具条高度）；
 * - **指令列有最大宽度**：手机较窄（长指令换行，不横向溢出），`sm` 起单行截断 + 悬停 Tooltip 看全。
 */
function CommandTable({
  groups,
  expandAll,
  onPick,
  onNavigate,
  onFilter,
}: {
  groups: TableSection[]
  /** 搜索时强制展开：否则命中的行藏在折叠组里。 */
  expandAll: boolean
  /** 行内「执行」：只是把指令填进浮窗，不自动发出。 */
  onPick: (command: string) => void
  /** 「数据 ID → NPC」入口（只有参数是 NPC 的指令才有）。 */
  onNavigate?: (tab: TabId) => void
  /** 点「相关指令」：把表格过滤到那条。 */
  onFilter: (query: string) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  /** 详情浮层：看哪一条 + **弹出时的鼠标坐标**（浮层跟着鼠标位置走，不锚在单元格上）。 */
  const [detail, setDetail] = useState<{ row: TableRow; x: number; y: number } | null>(null)
  const onlyInGame = t('commands.onlyInGame')

  // Radix 的虚拟锚点：把浮层定位到鼠标点（0 尺寸矩形）。
  const anchorRef = useRef({
    getBoundingClientRect: () => {
      const { x, y } = mousePoint.current
      return {
        x,
        y,
        top: y,
        left: x,
        right: x,
        bottom: y,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }
    },
  })
  const mousePoint = useRef({ x: 0, y: 0 })

  /** 单击数据行：记下鼠标位置并弹出详情浮层（点同一条 = 收起）。 */
  const openDetailAt = (row: TableRow, event: ReactMouseEvent) => {
    mousePoint.current = { x: event.clientX, y: event.clientY }
    setDetail((prev) => (prev?.row === row ? null : { row, x: event.clientX, y: event.clientY }))
  }

  /**
   * 整表条目：先按分区算出折叠项，再把**所有分区**合并成一条列表按指令列 a~z 排序
   * （折叠行用它的前缀参与排序）。分区只用来给折叠行提供「说明」，不再决定表格顺序。
   */
  const tableEntries = useMemo(
    () =>
      groups
        .flatMap((group) => toRowGroups(group.rows, group.folds).map((entry) => ({ group, entry })))
        .sort((a, b) => sortKey(a.entry).localeCompare(sortKey(b.entry))),
    [groups],
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
   * 说明列（= 原来的说明 + 备注合并）：`主说明 · 备注`，单行、超出省略。
   * `w-full max-w-0` 是让单元格能省略的固定写法
   * （单元格自己的 `max-width` 在自动布局表格里不可靠，靠它把剩余宽度吃掉）。
   */
  const labelCell = (label: string, note?: string) => (
    <td className="w-full max-w-0 px-2 py-2 text-xs text-foreground">
      <div className="truncate">
        {label}
        {note ? <span className="text-2xs"> · {note}</span> : null}
      </div>
    </td>
  )

  /** 折叠行：整组权限一致才显示那一个，否则留空。 */
  const sharedPermission = (rows: TableRow[]): string | null | undefined => {
    const first = rows[0]?.def?.permission ?? null
    return rows.every((row) => (row.def?.permission ?? null) === first) ? first : undefined
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
              <th scope="col" className="hidden px-2 py-2 font-medium md:table-cell">
                {t('commands.col.permission')}
              </th>
            </tr>
          </thead>
          <tbody>
            {tableEntries.map(({ group, entry }, i) => {
              const key = `${group.id}:${entry.stem ?? entry.rows[0]!.command}:${i}`
              const stripe = stripeClass(i)
              if (entry.stem) {
                const open = expandAll || expanded.has(key)
                // 整组都只能在游戏内执行 → 标记只写在折叠行（子行不重复）
                const allIngame = entry.rows.every(ingameOnly)
                // 折叠行的「说明」：条目可以自己声明（`/worldevent rain` → 雨），否则用分区标题。
                const foldLabel = entry.rows.find((row) => row.foldLabel)?.foldLabel ?? group.title ?? ''
                return (
                  <Fragment key={key}>
                    <tr
                      data-fold={entry.stem}
                      onClick={() => toggle(key)}
                      className={cn(ROW_CLASS, stripe)}
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
                      {labelCell(foldLabel, allIngame ? onlyInGame : '')}
                      <PermissionCell permission={sharedPermission(entry.rows)} />
                    </tr>
                    {open &&
                      entry.rows.map((row, j) => {
                        const rowKey = `${key}:${j}`
                        return (
                          <Fragment key={rowKey}>
                            <CommandRow
                              row={row}
                              rowKey={rowKey}
                              stripe={stripe}
                              indent
                              onClick={(event) => openDetailAt(row, event)}
                            />
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              }
              const row = entry.rows[0]!
              return (
                <Fragment key={key}>
                  <CommandRow
                    row={row}
                    rowKey={key}
                    stripe={stripe}
                    onClick={(event) => openDetailAt(row, event)}
                  />
                </Fragment>
              )
            })}
          </tbody>
        </table>

        {/* 详情浮层：位置跟鼠标（虚拟锚点），内容就是这一条的完整信息 */}
        <Popover
          open={detail !== null}
          onOpenChange={(next) => {
            if (!next) setDetail(null)
          }}
          // 点别的数据行由行自己的 onClick 换内容；别让 Radix 先把浮层关掉（同一个 tick 里会互相抵消）
          modal={false}
        >
          <PopoverAnchor virtualRef={anchorRef as never} />
          <PopoverContent
            data-testid="command-detail"
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            className="w-[min(26rem,calc(100vw-1rem))] p-3"
            // 点表格里的其它行时不要先关：让它换内容；点别处才关
            onInteractOutside={(event) => {
              if ((event.target as HTMLElement | null)?.closest('tr[data-command]')) {
                event.preventDefault()
              }
            }}
          >
            {detail && (
              <RowPopoverBody
                row={detail.row}
                onNavigate={onNavigate}
                onFilter={(query) => {
                  onFilter(query)
                  setDetail(null)
                }}
                onPick={(command) => {
                  onPick(command)
                  setDetail(null)
                }}
              />
            )}
          </PopoverContent>
        </Popover>
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
  // 分组抽屉：手机端是自带遮罩的模态，桌面端只盖内容区（`ContentScrim`）。
  const isMobileDrawer = useIsMobile()

  // 全局搜索选了某条指令：落到本页并带上搜索词（不再单独维护「跳转到某一行」）。
  useSearchIntent(
    'commands',
    useCallback((intent) => {
      if (intent.query != null) setQuery(intent.query)
    }, []),
  )
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
    // 入侵并进「世界事件」：表格里只折成一行 `/worldevent`（入侵条目仍保留自己的语法行）
    const invasionUsage = t('commands.group.invasion.usage')
    return {
      event: [
        ...toRows(WORLD_EVENT_COMMANDS, lang),
        ...toRows(WORLD_INVASION_COMMANDS, lang).map((row) => ({ ...row, usage: invasionUsage })),
      ],
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
  }, [bySb, byKey, lang, t])

  /** 分组 → 表内分区（标题 / 说明 / 行；`usage` 给行内详情行）。 */
  const sections = useMemo<TableSection[]>(() => {
    /**
     * 参考行：`/give <item type/id> <player> …` 这种语法来自 `data/commands.json` 的 `paramSets`
     * （TShock 源码提取），每个 `paramSet` 一行；`allowServer=false` 的标「仅游戏内」。
     * 说明优先用子命令标签（`lib/commandMeta.ts` 的 `LABELS`：`/region define` → 定义区域）；
     * 首行没有子命令标签时写 TShock 中文帮助（`/warp` 有 6 种写法，不至于重复 6 次）。
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
        const labels = enumLabelsFor(command.name, lang, dataset.npcs)
        syntaxes.forEach((syntax, index) => {
          const sub = subcommandLabel(syntax, labels)
          rows.push({
            command: `/${syntax}`,
            label: sub || (index === 0 ? help : ''),
            syntax: true,
            def: command,
          })
        })
      }
      return rows
    }

    return TIPS_GROUPS.map((group) => {
      const title = t(group.titleKey)
      const sectionUsage = group.usageKey ? t(group.usageKey) : undefined
      const sectionHint = group.hintKey ? t(group.hintKey) : undefined
      // 详情要「这一类怎么写 / 权限 / 有什么坑」，所以把上下文挂到行上。
      // 个别指令只讲自己（`/kick` `/mute` 不套 `/ban` 的语法与提示），见 `TipsGroup.selfOnly`。
      const rows = [...(curatedRows[group.id] ?? []), ...referenceRows(group)].map((row) => ({
        ...row,
        usage: rowUsage(row, group, sectionUsage, t),
        hint: rowHint(row, group, sectionHint),
        fold: row.fold ?? group.foldAs,
        def: row.def ?? commandsByName.get(commandName(row.command)),
      }))
      return {
        id: group.id,
        title,
        usage: sectionUsage,
        hint: sectionHint,
        folds: group.folds,
        rows,
      }
    })
  }, [t, curatedRows, commandsByName, lang, dataset.npcs])

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
              `${row.command} ${row.label} ${row.note ?? ''} ${row.hint ?? ''} ${
                row.def?.permission ?? ''
              }`
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
            <CommandTable
              groups={visible}
              expandAll={q.length > 0}
              onPick={pick}
              onNavigate={onNavigate}
              onFilter={(next) => {
                setQuery(next)
                setActiveId(null)
              }}
            />
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

    </div>
  )
}

/** 复制到剪贴板，并给出 1.2s 的「已复制」状态（图标换 ✓）。 */
function useCopy(value: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void copyText(value).then((ok) => {
      setCopied(ok)
      if (ok) window.setTimeout(() => setCopied(false), 1200)
    })
  }
  return [copied, copy]
}
