import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Eye, EyeOff, Play, PlayOff, SlidersHorizontal } from 'lucide-react'
import { WIDTH_ICON, WIDTH_LABEL_KEY } from '@/components/card/cardWidthControls'
import { ParamModeSelect } from '@/components/card/ParamModeSelect'
import { ParamValueControl } from '@/components/card/ParamValueField'
import {
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import {
  argLabel,
  buildCardCommand,
  hasValueParams,
  isLiteralArg,
  normalizeLegacyCommand,
  parseCardCommandInput,
  searchCardCommands,
  templateFromSet,
  templateSummary,
  type CardArgMode,
  type CardTemplate,
} from '@/lib/cardParams'
import type { CardWidth } from '@/lib/cardLayout'
import { cn } from '@/lib/cn'
import { ingameAllowsCommand, type IngamePolicy } from '@/lib/ingame'
import { useI18n } from '@/lib/i18n'
import type { CommandDef, Dataset } from '@/types'

/** 面板提交的内容：卡片本身的字段 + 行级设置（尺寸 / 自动执行 / 显示）。 */
export interface CardEditorDraft {
  name: string
  /** 指令原文；参数卡片里是 `/指令名`（不含参数）。 */
  command: string
  /** 参数化指令；没有参数表时为空。 */
  template?: CardTemplate
  width: CardWidth
  manual: boolean
  hidden: boolean
}

export interface CardEditorPanelProps {
  dataset: Dataset
  /** 哪些 `allowServer=false` 的指令能在网页执行。 */
  ingame: IngamePolicy
  players?: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  /** 编辑已有卡片时的初值；新增不传。 */
  initial?: CardEditorDraft
  /** 可选的宽度档位（鱼店只有「右栏」）。 */
  widthOptions?: CardWidth[]
  /** 提交按钮文案（新增「添加」/ 编辑「保存」）。 */
  submitLabel: string
  onSubmit: (draft: CardEditorDraft) => void
  onCancel: () => void
}

const ALL_WIDTHS: CardWidth[] = ['half', 'full', 'right']

/**
 * 「管理卡片」抽屉里的添加 / 编辑面板（两行）：
 *
 * ```
 * 名称 [ 给物品        ]   指令 [ give                  ]
 * [◫ 左·小] [▶ 自动] [👁 显示]        [指令参数 2] [取消] [添加]
 * ```
 *
 * 第二行左边是这张卡片的尺寸 / 自动执行 / 显示（新卡片作为预设，编辑时直接生效），
 * 右边「指令参数」按指令库的参数表配每个参数的取值方式与值。
 */
export function CardEditorPanel({
  dataset,
  ingame,
  players = [],
  runtimeValues,
  initial,
  widthOptions = ALL_WIDTHS,
  submitLabel,
  onSubmit,
  onCancel,
}: CardEditorPanelProps) {
  const { t } = useI18n()
  const baseId = useId()
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [width, setWidth] = useState<CardWidth>(initial?.width ?? 'half')
  const [manual, setManual] = useState(initial?.manual ?? false)
  const [hidden, setHidden] = useState(initial?.hidden ?? false)
  const [configured, setTemplate] = useState<CardTemplate | null>(initial?.template ?? null)
  const [setIndex, setSetIndex] = useState(0)
  const [paramsOpen, setParamsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // 卡片多的时候面板会开在清单末尾之外：展开就把自己滚进视野（jsdom 没有 scrollIntoView）。
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  const parsed = useMemo(() => parseCardCommandInput(dataset, command), [dataset, command])
  const def = parsed.def
  const sets = def?.paramSets ?? []
  const set = sets[setIndex] ?? null
  /**
   * 当前生效的参数模板：用户配过的优先，否则按选中用法生成一份默认的。
   * 派生而不是放进 state —— 这样改指令 / 换用法都不需要 effect 去同步。
   */
  const template = useMemo<CardTemplate | null>(() => {
    if (!set) return null
    if (configured && configured.syntax === set.syntax && configured.args.length === set.args.length) {
      return configured
    }
    return templateFromSet(parsed.token, set)
  }, [set, configured, parsed.token])

  const inGameOnly = Boolean(
    def && def.allowServer === false && !ingameAllowsCommand(ingame, `/${def.name}`, def),
  )
  /** 指令输入框里带了参数：参数卡片的参数要在右侧配，不去猜多出来的词。 */
  const hasInlineArgs = Boolean(parsed.args && sets.length > 0)
  const missingCommand = parsed.token.length === 0
  const canSubmit = !missingCommand && !inGameOnly && !hasInlineArgs

  const submit = () => {
    if (!canSubmit) return
    const asTemplate = Boolean(template && set && hasValueParams(set))
    onSubmit({
      name: name.trim(),
      command: asTemplate ? `/${parsed.token}` : normalizeLegacyCommand(command),
      template: asTemplate ? (template as CardTemplate) : undefined,
      width,
      manual,
      hidden,
    })
  }

  const currentWidthLabel = t(WIDTH_LABEL_KEY[width])
  const nextWidth = widthOptions[(widthOptions.indexOf(width) + 1) % widthOptions.length] ?? width

  const paramCount = set ? set.args.filter((arg) => !isLiteralArg(arg)).length : 0
  const preview =
    template && set
      ? buildCardCommand(template, set).command
      : normalizeLegacyCommand(command)

  return (
    <div
      ref={rootRef}
      className="shrink-0 rounded-container border bg-accent/20 p-3"
      data-testid="card-editor-panel"
    >
      {/* 行 1：名称 + 指令。 */}
      <FieldGroup className="flex-col gap-2 sm:flex-row sm:items-center">
        <Field className="sm:w-40">
          <FieldLabel htmlFor={`${baseId}-name`} className="sr-only">
            {t('card.nameLabel')}
          </FieldLabel>
          <Input
            id={`${baseId}-name`}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('card.nameLabel')}
            aria-label={t('card.nameLabel')}
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </Field>

        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor={`${baseId}-command`} className="sr-only">
            {t('card.commandLabel')}
          </FieldLabel>
          <CommandNameInput
            id={`${baseId}-command`}
            dataset={dataset}
            trailing={
              <ParamPopover
                open={paramsOpen}
                onOpenChange={setParamsOpen}
                dataset={dataset}
                def={def}
                sets={sets}
                setIndex={setIndex}
                onSetIndex={(next) => {
                  setSetIndex(next)
                  setTemplate(null)
                }}
                template={template}
                onTemplateChange={setTemplate}
                players={players}
                runtimeValues={runtimeValues}
                count={paramCount}
                emptyCommand={missingCommand}
              />
            }
            value={command}
            onChange={(next) => {
              setCommand(next)
              // 换成另一条指令才清掉已配的参数（同名保留，避免手抖重输就白配）。
              if (parseCardCommandInput(dataset, next).token !== parsed.token) setTemplate(null)
            }}
            onSubmit={submit}
            disabled={false}
          />
        </Field>
      </FieldGroup>

      {/* 行 2：操作按钮组（尺寸 / 自动执行 / 显示）+ 指令参数 + 取消 / 提交。 */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PanelToggle
          label={t('home.manageWidthTip', { size: t(WIDTH_LABEL_KEY[nextWidth]) })}
          active={false}
          onClick={() => {
            if (widthOptions.length > 1) setWidth(nextWidth)
          }}
          ariaLabel={currentWidthLabel}
          disabled={widthOptions.length <= 1}
        >
          {(() => {
            const Icon = WIDTH_ICON[width]
            return <Icon className="size-3.5" aria-hidden />
          })()}
          <span className="text-2xs">{currentWidthLabel}</span>
        </PanelToggle>

        <PanelToggle
          label={manual ? t('home.manageAutoOnTip') : t('home.manageAutoOffTip')}
          active={!manual}
          onClick={() => setManual(!manual)}
          ariaLabel={manual ? t('home.manageManualChip') : t('home.manageAutoChip')}
        >
          {manual ? <PlayOff className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          <span className="text-2xs">{manual ? t('card.panelManual') : t('card.panelAuto')}</span>
        </PanelToggle>

        <PanelToggle
          label={hidden ? t('home.manageShowTip') : t('home.manageHideTip')}
          active={!hidden}
          onClick={() => setHidden(!hidden)}
          ariaLabel={hidden ? t('home.manageHiddenChip') : t('home.manageVisibleChip')}
        >
          {hidden ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          <span className="text-2xs">{hidden ? t('card.panelHidden') : t('card.panelVisible')}</span>
        </PanelToggle>

        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('action.cancel')}
          </Button>
          <Button size="sm" variant="primary" disabled={!canSubmit} onClick={submit}>
            <Check data-icon="inline-start" />
            {submitLabel}
          </Button>
        </div>
      </div>

      {/* 提示行：只在需要解释「为什么不能提交」时出现。 */}
      {(inGameOnly || hasInlineArgs) && (
        <p className="mt-1.5 text-2xs text-warning">
          {inGameOnly
            ? t('card.inGameOnlyHint', { cmd: `/${parsed.token}` })
            : t('card.commandArgsWarn')}
        </p>
      )}

      {preview && (
        <p
          className="mt-1 truncate font-pixel text-2xs text-muted-foreground"
          data-testid="card-editor-preview"
        >
          {preview}
        </p>
      )}
    </div>
  )
}

/** 一段小按钮：图标 + 2xs 文字，悬停给「点了会发生什么」。 */
function PanelToggle({
  label,
  active,
  onClick,
  children,
  ariaLabel,
  disabled,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
              'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-control border px-1.5',
              'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active && 'text-foreground',
              disabled && 'cursor-default opacity-60 hover:bg-transparent',
            )}
            aria-label={ariaLabel}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** 指令输入框 + 指令库候选（名称 / 别名 / 中文帮助都能搜）。 */
function CommandNameInput({
  id,
  dataset,
  value,
  onChange,
  onSubmit,
  trailing,
  disabled,
}: {
  id: string
  dataset: Dataset
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  /** 输入框右侧的 addon（「指令参数」）。 */
  trailing?: ReactNode
  disabled?: boolean
}) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const candidates = useMemo(
    () => (open && !disabled ? searchCardCommands(dataset, value, lang, 8) : []),
    [open, disabled, dataset, value, lang],
  )

  const accept = (def: CommandDef) => {
    onChange(`/${def.name}`)
    setOpen(false)
  }

  return (
    <Popover open={open && candidates.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <InputGroup className="h-8">
          <InputGroupInput
          id={id}
          value={value}
          disabled={disabled}
          placeholder={t('card.commandPlaceholder')}
          aria-label={t('card.commandLabel')}
          autoComplete="off"
          aria-autocomplete="list"
          data-suggest-anchor="true"
          className="h-8 px-2 font-pixel text-xs"
          onChange={(e) => {
            onChange(e.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setHighlight((h) => Math.min(h + 1, Math.max(candidates.length - 1, 0)))
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const hit = open ? candidates[highlight] : undefined
              if (hit) accept(hit)
              else onSubmit()
              return
            }
            if (e.key === 'Escape' && open) {
              e.preventDefault()
              setOpen(false)
            }
          }}
          />
          {trailing && <InputGroupAddon align="inline-end" className="px-1">{trailing}</InputGroupAddon>}
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // 点输入框本身不该关候选（这里没有 PopoverTrigger，Radix 会把这次 click 当外部交互）。
        onInteractOutside={(e) => {
          const target = e.target as Element | null
          if (target?.closest?.('[data-suggest-anchor]')) e.preventDefault()
        }}
      >
        <ul role="listbox" className="flex max-h-56 flex-col overflow-y-auto">
          {candidates.map((def, index) => (
            <li key={def.name}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => accept(def)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-left',
                  index === highlight && 'bg-accent text-accent-foreground',
                )}
              >
                <code className="shrink-0 font-pixel text-xs">/{def.name}</code>
                <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                  {def.helpZh ?? def.help}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** 「指令参数」按钮 + 参数表浮层。 */
function ParamPopover({
  open,
  onOpenChange,
  dataset,
  def,
  sets,
  setIndex,
  onSetIndex,
  template,
  onTemplateChange,
  players,
  runtimeValues,
  count,
  emptyCommand,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dataset: Dataset
  def: CommandDef | null
  sets: NonNullable<CommandDef['paramSets']>
  setIndex: number
  onSetIndex: (next: number) => void
  template: CardTemplate | null
  onTemplateChange: (next: CardTemplate) => void
  players: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  count: number
  emptyCommand: boolean
}) {
  const { t, lang } = useI18n()
  const set = sets[setIndex] ?? null
  const disabled = !def || !set

  const updateArg = (index: number, patch: { mode?: CardArgMode; value?: string }) => {
    if (!template) return
    onTemplateChange({
      ...template,
      args: template.args.map((arg, i) => (i === index ? { ...arg, ...patch } : arg)),
    })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => onOpenChange(!open)}
                aria-expanded={open}
                aria-label={t('card.paramsButton')}
                className="h-6 w-auto gap-0.5 px-1 text-muted-foreground hover:text-foreground"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
                {count > 0 && (
                  <span className="text-2xs tabular-nums text-muted-foreground">{count}</span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('card.paramsButton')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(22rem,calc(100vw-2rem))] p-2"
        data-testid="card-params-popover"
      >
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <span className="text-xs font-medium text-foreground">{t('card.paramsTitle')}</span>
          <code className="font-pixel text-2xs text-muted-foreground">/{def?.name}</code>
        </div>
        {sets.length > 1 && (
          <Select value={String(setIndex)} onValueChange={(v) => onSetIndex(Number(v))}>
            <SelectTrigger size="sm" className="mb-1 w-full font-pixel" aria-label={t('card.setLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sets.map((s, index) => (
                <SelectItem key={s.syntax} value={String(index)} className="font-pixel">
                  {s.syntax}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {set && template ? (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            <p
              className="truncate px-1 font-pixel text-2xs text-muted-foreground"
              title={templateSummary(set)}
            >
              {templateSummary(set)}
            </p>
            {set.args.map((arg, index) => {
              const state = template.args[index]
              if (!state) return null
              if (isLiteralArg(arg)) {
                return (
                  <div key={index} className="flex items-center gap-2 px-1">
                    <code className="flex-1 font-pixel text-xs text-foreground">{arg.literal}</code>
                    {arg.required === false && (
                      <ParamModeSelect
                        value={state.mode === 'omit' ? 'omit' : 'fixed'}
                        options={['fixed', 'omit']}
                        onChange={(next) => updateArg(index, { mode: next })}
                        label={`${arg.literal} · ${t('card.modeLabel')}`}
                      />
                    )}
                  </div>
                )
              }
              return (
                <div key={index} className="flex flex-col gap-1 rounded-container bg-accent/40 p-1.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-2xs font-medium text-foreground">
                      {argLabel(arg, index, lang)}
                    </span>
                    <ParamModeSelect
                      value={state.mode}
                      options={arg.required ? ['fill', 'fixed'] : ['fill', 'fixed', 'omit']}
                      onChange={(next) => updateArg(index, { mode: next })}
                      label={`${argLabel(arg, index, lang)} · ${t('card.modeLabel')}`}
                    />
                  </div>
                  {state.mode !== 'omit' && (
                    <ParamValueControl
                      id={`param-${index}`}
                      dataset={dataset}
                      command={def as CommandDef}
                      arg={arg}
                      value={state.value}
                      onChange={(next) => updateArg(index, { value: next })}
                      players={players}
                      runtimeValues={runtimeValues}
                      label={argLabel(arg, index, lang)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="px-1 py-2 text-2xs text-muted-foreground">
            {emptyCommand ? t('card.paramsNeedCommand') : t('card.paramsNone')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
