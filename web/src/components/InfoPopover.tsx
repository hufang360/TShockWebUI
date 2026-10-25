import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'

interface InfoPopoverProps {
  /** 无障碍名称 / Tooltip 文本，如「页面说明」。 */
  label: string
  /** 可选标题（页面 / 卡片名称）。 */
  title?: string
  children: ReactNode
  className?: string
}

/**
 * 「页面说明」图标按钮：点击弹出 Popover，展示原先铺在正文里的小字说明。
 *
 * 顶栏空间有限，说明类文字收进这里，页面正文只留数据与操作。
 */
export function InfoPopover({ label, title, children, className }: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          title={label}
          className={className}
        >
          <Info />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs leading-5 text-muted-foreground">
        {title && <p className="mb-1 text-sm font-semibold text-foreground">{title}</p>}
        {children}
      </PopoverContent>
    </Popover>
  )
}
