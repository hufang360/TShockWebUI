import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Card,
  CardBody,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui'
import { cn } from '@/lib/cn'

interface CollapsibleCardProps {
  title: ReactNode
  icon?: ReactNode
  /** 头部右侧额外控件（如「重新检测」），不参与折叠点击区。 */
  headerExtra?: ReactNode
  defaultOpen?: boolean
  bodyClassName?: string
  className?: string
  children: ReactNode
}

/**
 * 可折叠卡片：头部（标题 + 折叠箭头 + 右侧控件）固定，内容可收起。
 * 设置页各分区 / 账户分区共用。
 */
export function CollapsibleCard({
  title,
  icon,
  headerExtra,
  defaultOpen = true,
  bodyClassName,
  className,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className={className}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
            >
              {icon}
              <span className="truncate text-sm font-semibold tracking-wide text-foreground">
                {title}
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
            </button>
          </CollapsibleTrigger>
          {headerExtra}
        </CardHeader>
        <CollapsibleContent>
          <CardBody className={bodyClassName}>{children}</CardBody>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
