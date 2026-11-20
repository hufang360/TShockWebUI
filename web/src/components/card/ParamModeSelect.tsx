import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import type { CardArgMode } from '@/lib/cardParams'
import { useI18n } from '@/lib/i18n'

const MODE_LABEL_KEY: Record<CardArgMode, string> = {
  fill: 'card.modeFill',
  fixed: 'card.modeFixed',
  omit: 'card.modeOmit',
}

/**
 * 参数的「取值方式」下拉：每次填写 / 固定值 / 不传。
 *
 * 必填参数只给前两项（`omit` 会让卡片永远发不出去）。
 */
export function ParamModeSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: CardArgMode
  options: CardArgMode[]
  onChange: (next: CardArgMode) => void
  /** 无障碍名称（带上参数名，避免同屏多个下拉重名）。 */
  label: string
}) {
  const { t } = useI18n()
  return (
    <Select value={value} onValueChange={(next) => onChange(next as CardArgMode)}>
      <SelectTrigger size="sm" className="w-24 shrink-0" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {t(MODE_LABEL_KEY[option])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
