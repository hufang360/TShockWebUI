import { useState, type ReactNode } from 'react'
import { CollapseChevron } from '@/components/CollapseChevron'
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
 * 可折叠卡片：头部（图标 + 标题 + 折叠箭头 + 右侧控件）固定，内容可收起。
 * 折叠箭头走全站统一的 `CollapseChevron`（展开时 hover 标题才显示、折叠时始终向右）。
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
        <CardHeader className="group/header">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group/title flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              {icon}
              <span className="truncate text-sm font-semibold tracking-wide text-foreground">
                {title}
              </span>
            </button>
          </CollapsibleTrigger>
          {headerExtra && (
            <div
              className={cn(
                'flex shrink-0 items-center gap-1',
                open ? 'opacity-0 transition-opacity group-hover/header:opacity-100' : 'hidden',
              )}
            >
              {headerExtra}
            </div>
          )}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="shrink-0 cursor-pointer"
              aria-label={typeof title === 'string' ? title : undefined}
            >
              <CollapseChevron open={open} reveal="group-hover/header:opacity-100" />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardBody className={cn(bodyClassName)}>{children}</CardBody>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
