import type { ComponentProps } from 'react'
import { X } from 'lucide-react'
import { Button, InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

type SearchInputProps = Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
  /** 输入框自身的额外类（如整体大一号：`text-sm`）。 */
  inputClassName?: string
}

/**
 * 紧凑搜索框：右侧内嵌圆形 ✕（有内容时才出现），点击清空并保持焦点。
 * 基于 shadcn `InputGroup`（不用 relative + 绝对定位）。
 */
export function SearchInput({
  value,
  onValueChange,
  className,
  inputClassName,
  ...props
}: SearchInputProps) {
  const { t } = useI18n()
  return (
    <InputGroup className={cn('h-8 w-full', className)}>
      <InputGroupInput
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn('px-2.5 text-xs', inputClassName)}
        {...props}
      />
      {value.length > 0 && (
        <InputGroupAddon align="inline-end">
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-full text-muted-foreground hover:text-foreground"
            aria-label={t('editor.clear')}
            title={t('editor.clear')}
            onClick={() => onValueChange('')}
          >
            <X data-icon="inline-start" />
          </Button>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
