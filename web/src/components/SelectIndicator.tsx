import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/** 批量选择状态下行首的勾选指示（纯展示，点击由整行按钮处理）。 */
export function SelectIndicator({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      data-checked={checked}
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-[4px] border border-input text-transparent',
        checked && 'border-primary bg-primary text-primary-foreground',
        className,
      )}
    >
      <Check className="size-3.5" />
    </span>
  )
}
