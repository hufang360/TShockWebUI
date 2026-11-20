import { useId } from 'react'
import { ParamValueField } from '@/components/card/ParamValueField'
import { isLiteralArg, type CardTemplate } from '@/lib/cardParams'
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
  const { t } = useI18n()
  const baseId = useId()

  const fields = set.args
    .map((arg, index) => ({ arg, index, state: template.args[index] }))
    .filter((field) => !isLiteralArg(field.arg) && field.state?.mode === 'fill')

  if (fields.length === 0) return null

  /** 卡片上按「渲染出来的第几个」编号：参数1 / 参数2 …（不含固定值、不传的那些）。 */
  const paramName = (order: number) => t('card.paramN', { n: order })

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="card-param-form"
    >
      {fields.map(({ arg, index, state }, order) => (
        <ParamValueField
          key={index}
          id={`${baseId}-${index}`}
          layout="inline"
          label={paramName(order + 1)}
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
      {missing.length > 0 && (
        <p className="basis-full text-2xs text-warning">
          {t('card.needArgs', {
            args: missing
              .map((index) => {
                const order = fields.findIndex((field) => field.index === index)
                return order >= 0 ? paramName(order + 1) : '?'
              })
              .join('、'),
          })}
        </p>
      )}
    </div>
  )
}
