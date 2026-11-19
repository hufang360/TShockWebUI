import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import {
  Field,
  FieldLabel,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { argLabel, argPlaceholder } from '@/lib/cardParams'
import { enumLabelsFor } from '@/lib/commandMeta'
import { paramValueCandidates, type ParamValueCandidate } from '@/lib/completion'
import { useI18n } from '@/lib/i18n'
import type { CommandDef, CommandParam, Dataset } from '@/types'

export interface ParamValueFieldProps {
  /** 输入控件的 id（label 用）。 */
  id: string
  dataset: Dataset
  command: CommandDef
  arg: CommandParam
  value: string
  onChange: (next: string) => void
  players: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  disabled?: boolean
  /** 必填但没填：标红（错误文案由卡片统一给一行，不逐项重复）。 */
  invalid?: boolean
  /** 控件的无障碍名称（弹框里没有可见 label 时用）。 */
  label?: string
}

/**
 * 一个参数取值控件：
 * - `enum` 用 `Select`（取值来自参数表，选项名取自 `lib/commandMeta.ts` 的中文备注）；
 * - 其余有数据源的（玩家 / 物品 / NPC / Buff / 词缀 / 区域 / 传送点 / 用户组 / 权限）用输入框 + 候选下拉，
 *   候选与指令编辑器的补全**同源**（`paramValueCandidates`），但**允许手输任意值**
 *   （离线玩家、自定义组、运行期才存在的名字都合法，TShock 自己校验）。
 */
export function ParamValueField({
  id,
  dataset,
  command,
  arg,
  value,
  onChange,
  players,
  runtimeValues,
  disabled,
  invalid,
  label: ariaLabel,
}: ParamValueFieldProps) {
  const { lang } = useI18n()
  const label = argLabel(arg, 0, lang)
  return (
    <Field className="gap-1" data-slot="card-param-field">
      <FieldLabel htmlFor={id} className="text-2xs text-muted-foreground">
        {label}
      </FieldLabel>
      <ParamValueControl
        id={id}
        dataset={dataset}
        command={command}
        arg={arg}
        value={value}
        onChange={onChange}
        players={players}
        runtimeValues={runtimeValues}
        disabled={disabled}
        invalid={invalid}
        label={ariaLabel ?? label}
      />
    </Field>
  )
}

/** 不带 label 的取值控件（卡片表单与「添加 / 编辑卡片」弹框共用）。 */
export function ParamValueControl({
  id,
  dataset,
  command,
  arg,
  value,
  onChange,
  players = [],
  runtimeValues,
  disabled,
  invalid,
  label,
}: Omit<ParamValueFieldProps, 'id'> & { id?: string }) {
  const { t, lang } = useI18n()
  if (arg.kind === 'enum') {
    return (
      <EnumSelect
        id={id}
        arg={arg}
        command={command}
        dataset={dataset}
        value={value}
        onChange={onChange}
        disabled={disabled}
        invalid={invalid}
        emptyLabel={t('card.argEmpty')}
        ariaLabel={label}
        placeholder={argPlaceholder(arg, lang)}
      />
    )
  }
  return (
    <SuggestInput
      id={id}
      dataset={dataset}
      command={command}
      arg={arg}
      value={value}
      onChange={onChange}
      players={players}
      runtimeValues={runtimeValues}
      disabled={disabled}
      invalid={invalid}
      ariaLabel={label}
      placeholder={argPlaceholder(arg, lang)}
    />
  )
}

function EnumSelect({
  id,
  arg,
  command,
  dataset,
  value,
  onChange,
  disabled,
  invalid,
  emptyLabel,
  ariaLabel,
  placeholder,
}: {
  id?: string
  ariaLabel?: string
  arg: CommandParam
  command: CommandDef
  dataset: Dataset
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  invalid?: boolean
  emptyLabel: string
  placeholder?: string
}) {
  const { lang } = useI18n()
  const values = arg.values ?? []
  const labels = useMemo(
    () => enumLabelsFor(command.name, lang, dataset.npcs),
    [command.name, lang, dataset.npcs],
  )
  // Radix Select 不允许空字符串取值：可选参数用哨兵值表示「不填」，
  // 必填参数空着时传 undefined，才会显示 placeholder（受控空串不显示）。
  const EMPTY = '__tswui_empty__'
  const current = value !== '' ? value : arg.required ? undefined : EMPTY
  // 值可能不在取值表里（旧数据 / 手工改过）：仍显示原文，不静默改成别的值。
  const known = value === '' || values.includes(value)
  return (
    <Select
      value={current}
      onValueChange={(next) => onChange(next === EMPTY ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn('w-full', invalid && 'border-destructive')}
      >
        {/* 空值时也要有提示：只有一个占位符的下拉看着像坏了（`/time` 这类必填枚举）。 */}
        <SelectValue placeholder={arg.required ? placeholder : emptyLabel} />
      </SelectTrigger>
      <SelectContent>
        {!arg.required && <SelectItem value={EMPTY}>{emptyLabel}</SelectItem>}
        {!known && <SelectItem value={value}>{value}</SelectItem>}
        {values.map((v) => (
          <SelectItem key={v} value={v}>
            {labels[v] ? `${labels[v]} · ${v}` : v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SuggestInput({
  id,
  dataset,
  command,
  arg,
  value,
  onChange,
  players,
  runtimeValues,
  disabled,
  invalid,
  ariaLabel,
  placeholder,
}: {
  id?: string
  ariaLabel?: string
  dataset: Dataset
  command: CommandDef
  arg: CommandParam
  value: string
  onChange: (next: string) => void
  players: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  disabled?: boolean
  invalid?: boolean
  placeholder: string
}) {
  const { lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const candidates = useMemo(() => {
    if (!open || disabled) return []
    return paramValueCandidates({
      dataset,
      command,
      arg,
      word: value,
      players,
      lang,
      runtimeValues,
    })
  }, [open, disabled, dataset, command, arg, value, players, lang, runtimeValues])

  const accept = (candidate: ParamValueCandidate) => {
    onChange(candidate.value)
    setOpen(false)
  }

  return (
    <Popover open={open && candidates.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-autocomplete="list"
          aria-expanded={open && candidates.length > 0}
          className={cn('h-7 text-xs', invalid && 'border-destructive')}
          onChange={(e) => {
            onChange(e.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onFocus={() => {
            setHighlight(0)
            setOpen(true)
          }}
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
            if (e.key === 'Enter' && open && candidates[highlight]) {
              e.preventDefault()
              accept(candidates[highlight])
              return
            }
            if (e.key === 'Escape' && open) {
              e.preventDefault()
              setOpen(false)
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-48 p-1"
        // 候选是输入框的延伸：不抢焦点，焦点始终留在输入框（否则接着打字会断）。
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ul role="listbox" className="flex max-h-56 flex-col overflow-y-auto">
          {candidates.map((candidate, index) => (
            <li key={`${candidate.label}:${candidate.value}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => accept(candidate)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-left text-xs',
                  index === highlight && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                {candidate.detail && (
                  <span className="max-w-[45%] shrink-0 truncate text-2xs text-muted-foreground">
                    {candidate.detail}
                  </span>
                )}
                {candidate.value === value && <Check aria-hidden className="size-3 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
