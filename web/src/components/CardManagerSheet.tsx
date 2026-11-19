import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Info,
  MoreVertical,
  Pencil,
  Play,
  PlayOff,
  Plus,
  SquarePaddingHorizontal,
  SquarePaddingLeft,
  SquarePaddingRight,
  Trash2,
} from 'lucide-react'
import { HelpCard } from '@/components/HelpCard'
import { IconAction } from '@/components/IconAction'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { CARD_WIDTHS, type CardWidth } from '@/lib/cardLayout'
import { copyText } from '@/lib/clipboard'
import { normalizeCustomCommand } from '@/lib/homeCards'
import { StorageKeys } from '@/lib/storage'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'

/** 统一的「管理卡片」条目：首页与模块 / 鱼店共用。 */
export interface ManagerCard {
  id: string
  /** 展示名（内置卡片已翻译；自定义卡片取原始值，可直接编辑）。 */
  name: string
  /** 主指令（自定义卡片取原始值，可直接编辑；内置卡片只读；记事本这类无指令卡片为空）。 */
  command: string
  /** 卡片图标（与页面上那张卡一致；没有就不显示）。 */
  icon?: ReactNode
  /** 用户添加的卡片：名称 / 指令可内联编辑，可删除。 */
  custom: boolean
  /** 参数卡片：指令由参数拼出来，编辑走「参数设置」而不是内联改指令。 */
  template?: boolean
  /** 必须手动执行（参数卡片要现场填值）：开关置灰，悬停说明原因。 */
  manualLocked?: boolean
  /** 置灰（如依赖的插件缺失）。 */
  disabled?: boolean
  /** 隐藏态（首页 / 鱼店用），置灰并显示闭眼图标。 */
  hidden?: boolean
  /** 行内额外徽标（首页「内置」「缺少插件」）。 */
  badges?: ReactNode
}

const WIDTH_LABEL_KEY: Record<CardWidth, string> = {
  half: 'home.widthSmall',
  full: 'home.widthLarge',
  right: 'home.widthRight',
}

/**
 * 尺寸用图标表示（不再写字）：左·小 = 方块靠左填充，左·大 = 横向铺满，右栏 = 靠右填充。
 * 文字只留在 `aria-label` / 悬停提示里，行内更窄、三档一眼能对上。
 */
const WIDTH_ICON: Record<CardWidth, typeof SquarePaddingLeft> = {
  half: SquarePaddingLeft,
  full: SquarePaddingHorizontal,
  right: SquarePaddingRight,
}

export interface CardManagerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  cards: ManagerCard[]
  /** 删除按钮的无障碍文案。 */
  removeLabel: string
  /** 自定义卡片内联编辑回调。 */
  onUpdate?: (id: string, patch: { name?: string; command?: string }) => void
  onRemove?: (id: string) => void
  /** 自动执行开关（不给则菜单里不显示）。 */
  autoExec?: {
    isManual: (id: string) => boolean
    onToggle: (id: string, manual: boolean) => void
    label: string
  }
  /** 排序能力：拖拽 + 上移 / 下移（不给则不显示）。 */
  ordering?: {
    onMove: (id: string, delta: number) => void
    dragLabel: string
    moveUpLabel: string
    moveDownLabel: string
  }
  /** 可见性开关（首页 / 鱼店用）。 */
  visibility?: {
    isHidden: (id: string) => boolean
    onToggle: (id: string) => void
  }
  /** 宽度设置：小 / 大 / 右，在行尾「更多」菜单里选。 */
  width?: {
    get: (id: string) => CardWidth
    set: (id: string, width: CardWidth) => void
    /** 不可选的档位（鱼店只有右栏：`half` / `full` 置灰）。 */
    disabled?: CardWidth[]
  }
  /** 底部「添加卡片」按钮（不给则不显示）；点开由页面弹出添加卡片弹框。 */
  add?: {
    label: string
    onClick: () => void
  }
  /** 参数卡片行尾的「参数设置」（不给则参数卡片不能编辑）。 */
  onEditTemplate?: (id: string) => void
  /** 卡片名称 / 指令输入框的无障碍文案（自定义卡片内联编辑用）。 */
  nameLabel?: string
  commandLabel?: string
  /** 自定义卡片指令输入框的下拉候选（如本机收藏的指令）。 */
  commandSuggestions?: string[]
  /** 底部左侧额外按钮（如首页「恢复默认」）。 */
  footerExtra?: ReactNode
  /** 底部右侧关闭按钮文案（不给则不显示）。 */
  doneLabel?: string
  /** 「使用说明」里追加的一行（如模块 / 鱼店有右栏时的「全部隐藏后右栏自动收起」）。 */
  helpExtra?: string
}

/**
 * 行内小按钮：样式与旁边的编辑图标按钮一致（ghost、`icon-xs` 高度、悬停手型），
 * Tooltip 说明「点了会发生什么」，`aria-label` 说明**当前状态**。
 */
function RowButton({
  label,
  tip,
  onClick,
  disabled,
  children,
}: {
  /** 无障碍名称（当前状态）。 */
  label: string
  /** 悬停提示（描述这个操作）。 */
  tip: string
  onClick: () => void
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-disabled={disabled || undefined}
            onClick={onClick}
            className={cn(
              'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted-foreground transition-colors md:size-6',
              'hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ',
              disabled && 'cursor-default opacity-50 hover:bg-transparent',
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * 尺寸按钮：点一下在可用档位里**循环**（左·小 → 左·大 → 右栏 → 左·小）。
 * 只剩一个可用档位时（鱼店只有「右栏」）不做成按钮，只显示当前值。
 */
function WidthControl({
  value,
  disabled,
  onChange,
}: {
  value: CardWidth
  disabled: CardWidth[]
  onChange: (next: CardWidth) => void
}) {
  const { t } = useI18n()
  const options = CARD_WIDTHS.filter((w) => !disabled.includes(w))
  const label = t(WIDTH_LABEL_KEY[value])
  const Icon = WIDTH_ICON[value]
  if (options.length <= 1) {
    // 只有一档可选（鱼店只有右栏）：只显示当前尺寸的图标，不可点。
    return (
      <span
        aria-label={label}
        title={label}
        className="hidden size-9 shrink-0 items-center justify-center text-muted-foreground sm:flex md:size-6"
      >
        <Icon className="size-4" aria-hidden />
      </span>
    )
  }
  const next = options[(options.indexOf(value) + 1) % options.length] ?? options[0]
  // 手机上卡片本来就是整行铺满，切换尺寸没有意义 → 只在 `sm` 及以上出现。
  return (
    <span className="hidden sm:inline-flex">
      <RowButton
        label={label}
        tip={t('home.manageWidthTip', { size: t(WIDTH_LABEL_KEY[next]) })}
        onClick={() => onChange(next)}
      >
        <Icon className="size-4" aria-hidden />
      </RowButton>
    </span>
  )
}

/**
 * 统一的「管理卡片」Sheet（首页 `HomeCardManager` 与模块 / 鱼店 `ModuleCardManagerDialog` 共用）。
 *
 * 约定（见 `docs/UI组件.md`「管理卡片弹层」）：
 * - 顶栏只有标题 + 关闭按钮；说明 / 备注等小字放在滚动区起始（第一张卡片之前）；
 * - 一行一张卡（36px 高）：`⠿ 名称 指令 …[小/大/右][▶̸][👁̸][内置] ✎ ⋮`；
 *   宽度常显、`不自动执行` 显示 `PlayOff`、隐藏显示 `EyeOff`（只读指示，不可点），「内置」永远排最右；
 * - 行尾「更多设置」菜单分组：**排序**（上移 / 下移）→ **宽度**（小 / 大 / 右）→
 *   自动执行 / 是否显示（右侧 `Switch`）→ 删除卡片（自定义卡片，二次确认弹框）；
 * - 添加卡片按钮与「完成」并排在底部，表单按需展开在滚动区起始。
 */
export function CardManagerSheet({
  open,
  onOpenChange,
  title,
  cards,
  removeLabel,
  onUpdate,
  onRemove,
  autoExec,
  ordering,
  visibility,
  width,
  add,
  onEditTemplate,
  nameLabel,
  commandLabel,
  commandSuggestions,
  footerExtra,
  doneLabel,
  helpExtra,
}: CardManagerSheetProps) {
  const { t } = useI18n()
  const suggestionBaseId = useId()
  const [filter, setFilter] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  /** 刚复制过的卡片 id（菜单项短暂显示「已复制」）。 */
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 「使用说明」的显隐：三个抽屉共用同一份本机状态。
  //   - 默认展开；
  //   - 收起过一次之后就**一直**显示页脚的 ⓘ 入口（随时能再打开）。
  const [rawHelp, setHelp] = useLocalState<{ closed?: boolean; everClosed?: boolean }>(
    StorageKeys.cardHelp,
    {},
  )
  const helpClosed = rawHelp?.closed === true
  const helpEverClosed = rawHelp?.everClosed === true
  const toggleHelp = (closed: boolean) => setHelp({ closed, everClosed: true })

  useEffect(() => {
    if (open) return
    setDragId(null)
    setOverId(null)
    setEditingId(null)
    setRemoveId(null)
    setCopiedId(null)
    setFilter('')
  }, [open])

  /** 复制这张卡片的指令（悬停提示与「已复制」反馈都在菜单项上）。 */
  const copyCommand = async (id: string, raw: string) => {
    const cmd = normalizeCustomCommand(raw)
    if (!cmd) return
    // 剪贴板不可用（非 https / 权限被拒）：不假装成功。
    const ok = await copyText(cmd)
    setCopiedId(ok ? id : null)
    if (ok) window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200)
  }

  /** 拖拽落到目标行：把源卡片移动到目标索引。 */
  const dropAt = (sourceId: string, targetIndex: number) => {
    if (!ordering) return
    const from = cards.findIndex((c) => c.id === sourceId)
    if (from < 0 || from === targetIndex) return
    ordering.onMove(sourceId, targetIndex - from)
  }

  const resetDrag = () => {
    setDragId(null)
    setOverId(null)
  }

  const removeTarget = removeId ? cards.find((c) => c.id === removeId) : undefined

  // 卡片多时给一个过滤框（首页 / 模块的卡片清单会越来越长）。过滤期间不拖拽排序：
  // 拖拽落点算的是「过滤后的第几行」，照着它移动会挪错位置。
  const keyword = filter.trim().toLowerCase()
  const visibleCards = keyword
    ? cards.filter((card) => `${card.name} ${card.command}`.toLowerCase().includes(keyword))
    : cards
  const sortingDisabled = keyword.length > 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        // 打开时不要聚焦第一个按钮（那是第一行的拖拽手柄，`Tooltip` 会跟着弹出来，
        // 一开抽屉就顶着一个「拖动排序」很怪）。焦点交给滚动区本身，键盘照样能 Tab 进去。
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          scrollRef.current?.focus()
        }}
      >
        {/* 顶栏：只有标题 + 关闭（关闭按钮由 SheetContent 提供）。 */}
        <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        {/* 滚动区：说明 / 备注等小字在最上，然后是添加表单与卡片清单。 */}
        <div
          ref={scrollRef}
          // 可聚焦（但不进 Tab 序）：抽屉打开时把焦点放这里，避免第一行按钮的 tooltip 自动弹出。
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
        >
          {cards.length > 6 && (
            <div className="px-5 pt-3">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('card.filterPlaceholder')}
                aria-label={t('card.filterPlaceholder')}
                className="h-8 text-xs"
              />
            </div>
          )}

          <ul className="flex flex-col gap-1 px-5 py-3">
            {visibleCards.map((card) => {
              const index = cards.indexOf(card)
              const label = card.name || card.command
              const suggestionListId = `${suggestionBaseId}-${index}`
              const editing = card.custom && card.template !== true && editingId === card.id
              const manual = autoExec ? autoExec.isManual(card.id) : false
              const hidden = card.hidden === true || (visibility ? visibility.isHidden(card.id) : false)
              const widthValue = width ? width.get(card.id) : null
              const canAutoExec = Boolean(autoExec && card.command.trim().length > 0)
              const hasSort = Boolean(ordering && cards.length > 1)
              // 菜单只剩「排序 + 删除」：宽度 / 自动执行 / 是否显示都搬到行内徽标上了。
              const hasCopy = card.command.trim().length > 0
              const hasMenu = hasSort || hasCopy || (card.custom && Boolean(onRemove))
              return (
                <li
                  key={card.id}
                  // 整行都能拖（手柄只是视觉提示）；编辑态关掉，否则输入框里没法选词。
                  draggable={Boolean(ordering) && !editing && !sortingDisabled}
                  onDragStart={
                    ordering && !sortingDisabled
                      ? (e) => {
                          setDragId(card.id)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', card.id)
                        }
                      : undefined
                  }
                  onDragOver={
                    ordering && !sortingDisabled
                      ? (e) => {
                          if (!dragId) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          if (overId !== card.id) setOverId(card.id)
                        }
                      : undefined
                  }
                  onDrop={
                    ordering && !sortingDisabled
                      ? (e) => {
                          e.preventDefault()
                          const source = dragId ?? e.dataTransfer.getData('text/plain')
                          if (source) dropAt(source, index)
                          resetDrag()
                        }
                      : undefined
                  }
                  onDragEnd={ordering && !sortingDisabled ? resetDrag : undefined}
                  className={cn(
                    'flex min-h-9 items-center gap-1.5 rounded-container bg-accent/40 pr-0.5 pl-1',
                    ordering && !sortingDisabled && 'cursor-grab active:cursor-grabbing',
                    dragId === card.id && 'opacity-50',
                    dragId && overId === card.id && dragId !== card.id && 'ring-2 ring-ring',
                    // 隐藏态只用闭眼徽标表达，不改透明度；缺插件仍置灰。
                    card.disabled && 'opacity-60',
                  )}
                  aria-label={label}
                >
                  {ordering ? (
                    <IconAction
                      label={ordering.dragLabel}
                      icon={GripVertical}
                      size="icon-xs"
                      className="shrink-0 cursor-grab active:cursor-grabbing"
                    />
                  ) : null}

                  {editing ? (
                    <>
                      <Input
                        value={card.name}
                        onChange={(e) => onUpdate?.(card.id, { name: e.target.value })}
                        placeholder={nameLabel}
                        aria-label={nameLabel}
                        className="h-7 w-24 shrink-0 text-xs sm:w-32"
                      />
                      <Input
                        value={card.command}
                        onChange={(e) => onUpdate?.(card.id, { command: e.target.value })}
                        onBlur={(e) =>
                          onUpdate?.(card.id, { command: normalizeCustomCommand(e.target.value) })
                        }
                        list={commandSuggestions?.length ? suggestionListId : undefined}
                        placeholder={commandLabel}
                        aria-label={commandLabel}
                        className="h-7 min-w-0 flex-1 font-pixel text-xs"
                      />
                      {commandSuggestions?.length ? (
                        <datalist id={suggestionListId}>
                          {commandSuggestions.map((cmd) => (
                            <option key={cmd} value={cmd} />
                          ))}
                        </datalist>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {card.icon && (
                        <span
                          aria-hidden
                          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5"
                        >
                          {card.icon}
                        </span>
                      )}
                      {/* 名称与指令同一行、共用一条中线（`leading-none` + `items-center`）。 */}
                      <span
                        className="flex min-w-0 flex-1 items-center gap-1.5 leading-none"
                        title={card.command ? `${label} ${card.command}` : label}
                      >
                        <span className="max-w-[60%] shrink-0 truncate text-xs font-medium text-foreground">
                          {label}
                        </span>
                        {card.command ? (
                          <code className="min-w-0 truncate font-pixel text-2xs leading-none text-muted-foreground">
                            {card.command}
                          </code>
                        ) : (
                          // 没有指令的页面元素（记事本）：用同样的文字形式标「非指令」。
                          <span className="shrink-0 text-2xs leading-none text-muted-foreground">
                            {t('home.manageNonCommand')}
                          </span>
                        )}
                      </span>
                    </>
                  )}

                  {/* 状态徽标（非指令 / 缺少插件）在左，右边是三个行内按钮：
                      尺寸 → 自动执行 → 是否显示，之后才是编辑与「更多」。 */}
                  {card.badges && (
                    <div className="flex shrink-0 items-center gap-1.5">{card.badges}</div>
                  )}

                  <div className="flex shrink-0 items-center gap-0.5">
                    {width && widthValue && (
                      <WidthControl
                        value={widthValue}
                        disabled={width.disabled ?? []}
                        onChange={(next) => width.set(card.id, next)}
                      />
                    )}

                    {canAutoExec && autoExec && (
                      <RowButton
                        label={manual ? t('home.manageManualChip') : t('home.manageAutoChip')}
                        tip={
                          card.manualLocked
                            ? t('card.manualLocked')
                            : manual
                              ? t('home.manageAutoOffTip')
                              : t('home.manageAutoOnTip')
                        }
                        disabled={card.manualLocked}
                        onClick={() => {
                          if (card.manualLocked) return
                          autoExec.onToggle(card.id, !manual)
                        }}
                      >
                        {manual ? <PlayOff className="size-3.5" /> : <Play className="size-3.5" />}
                      </RowButton>
                    )}

                    {visibility && (
                      <RowButton
                        label={hidden ? t('home.manageHiddenChip') : t('home.manageVisibleChip')}
                        tip={hidden ? t('home.manageShowTip') : t('home.manageHideTip')}
                        onClick={() => visibility.onToggle(card.id)}
                      >
                        {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </RowButton>
                    )}

                    {/* 编辑紧跟「是否显示」右边；隐藏的卡片不给编辑。 */}
                    {card.custom && !hidden && (
                      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                    )}
                    {card.custom && !hidden && (
                      <IconAction
                        label={editing ? t('action.done') : t('action.edit')}
                        icon={Pencil}
                        size="icon-xs"
                        variant={editing ? 'secondary' : 'ghost'}
                        onClick={() =>
                          card.template
                            ? onEditTemplate?.(card.id)
                            : setEditingId((id) => (id === card.id ? null : card.id))
                        }
                      />
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-0">
                    {hasMenu && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconAction
                            label={t('action.more')}
                            icon={MoreVertical}
                            size="icon-xs"
                            className="shrink-0"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          {hasSort && ordering && (
                            <>
                              <DropdownMenuItem
                                disabled={index === 0 || sortingDisabled}
                                onSelect={(e) => {
                                  e.preventDefault()
                                  ordering.onMove(card.id, -1)
                                }}
                              >
                                <ChevronUp />
                                {ordering.moveUpLabel}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === cards.length - 1 || sortingDisabled}
                                onSelect={(e) => {
                                  e.preventDefault()
                                  ordering.onMove(card.id, 1)
                                }}
                              >
                                <ChevronDown />
                                {ordering.moveDownLabel}
                              </DropdownMenuItem>
                            </>
                          )}

                          {hasCopy && (
                            <>
                              {hasSort && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault()
                                  void copyCommand(card.id, card.command)
                                }}
                              >
                                {copiedId === card.id ? <Check /> : <Copy />}
                                {copiedId === card.id ? t('action.copied') : t('cards.copyCommand')}
                              </DropdownMenuItem>
                            </>
                          )}

                          {card.custom && onRemove && (
                            <>
                              {(hasSort || hasCopy) && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                variant="danger"
                                onSelect={() => setRemoveId(card.id)}
                              >
                                <Trash2 />
                                {removeLabel}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {/* 使用说明：贴在滚动区底部（内容少时到底，内容多时跟在最后一张卡后面）。
              收起后不再占位，改由页脚的 ⓘ 重新打开。 */}
          {!helpClosed && (
            <div className="mt-auto shrink-0 px-5 pt-1 pb-3">
              <HelpCard onClose={() => toggleHelp(true)}>
                {[t('cards.manageDesc'), helpExtra].filter(Boolean).join('\n')}
              </HelpCard>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {footerExtra}
            {/* 收起过使用说明之后，这里常驻一个 ⓘ 入口（三个抽屉共享记忆）。 */}
            {helpEverClosed && (
              <IconAction
                label={t('cards.helpTitle')}
                icon={Info}
                active={!helpClosed}
                onClick={() => toggleHelp(!helpClosed)}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {add && (
              <Button variant="outline" onClick={add.onClick}>
                <Plus data-icon="inline-start" />
                {add.label}
              </Button>
            )}
            {doneLabel && (
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                <Check data-icon="inline-start" />
                {doneLabel}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>

      {/* 删除二次确认：从菜单里点删除后弹这个，避免误删。 */}
      <Dialog
        open={removeTarget != null}
        onOpenChange={(next) => {
          if (!next) setRemoveId(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{removeLabel}</DialogTitle>
            <DialogDescription>
              {removeTarget ? removeTarget.name || removeTarget.command : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setRemoveId(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (removeId) onRemove?.(removeId)
                setRemoveId(null)
              }}
            >
              {t('action.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
