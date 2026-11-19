import { useId } from 'react'
import { ParamValueField } from '@/components/card/ParamValueField'
import { argMissingLabel, isLiteralArg, type CardTemplate } from '@/lib/cardParams'
import { useI18n } from '@/lib/i18n'
import type { CommandDef, CommandParamSet, Dataset } from '@/types'

export interface CardParamFormProps {
  dataset: Dataset
  command: CommandDef
  set: CommandParamSet
  template: CardTemplate
  /** 改某个参数的值（`fill` 参数：既是本次执行的值，也是下次的默认值）。 */
  onChange: (index: number, value: string) => void
  players?: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
  /** 缺值的必填参数下标（标红 + 一行提示）。 */
  missing?: number[]
  disabled?: boolean
}

/**
 * 参数卡片正文里的输入区：**只渲染「执行时填」的参数**。
 *
 * 固定值 / 不传的参数不在这里出现 —— 它们已经写进页脚那条指令预览里，
 * 卡片上多一行只读的框只会让人以为要填。
 */
export function CardParamForm({
  dataset,
  command,
  set,
  template,
  onChange,
  players = [],
  runtimeValues,
  missing = [],
  disabled,
}: CardParamFormProps) {
  const { t, lang } = useI18n()
  const baseId = useId()

  const fields = set.args
    .map((arg, index) => ({ arg, index, state: template.args[index] }))
    .filter((field) => !isLiteralArg(field.arg) && field.state?.mode === 'fill')

  if (fields.length === 0) return null

  const missingNames = missing.map((index) => {
    const arg = set.args[index]
    return arg ? argMissingLabel(arg, index, lang) : '?'
  })

  return (
    <div className="flex flex-col gap-1.5" data-testid="card-param-form">
      {fields.map(({ arg, index, state }) => (
        <ParamValueField
          key={index}
          id={`${baseId}-${index}`}
          dataset={dataset}
          command={command}
          arg={arg}
          value={state?.value ?? ''}
          onChange={(next) => onChange(index, next)}
          players={players}
          runtimeValues={runtimeValues}
          disabled={disabled}
          invalid={missing.includes(index)}
        />
      ))}
      {missingNames.length > 0 && (
        <p className="text-2xs text-warning">{t('card.needArgs', { args: missingNames.join('、') })}</p>
      )}
    </div>
  )
}
