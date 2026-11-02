import type { ReactNode } from 'react'
import type { CardWidth } from '@/lib/cardLayout'
import { cn } from '@/lib/cn'

export interface CardLayoutItem {
  id: string
  width: CardWidth
  node: ReactNode
}

interface CardLayoutGridProps {
  items: CardLayoutItem[]
  /** 测试定位用（首页传 `home-left` / `home-right`）。 */
  leftTestId?: string
  rightTestId?: string
  /** 右栏容器额外类名（如鱼店式的固定高度 + 内部滚动）。 */
  rightClassName?: string
}

/**
 * 按宽度排版的卡片网格：`half` / `full` 进左栏两列网格，`right` 进右侧 360px 列。
 *
 * - 半宽卡片是奇数张时，**最后一张独占整行**（不留半格空白）；
 * - 同一行的两张半宽卡等高（多出来的高度由卡片正文的灰底区吸收）；
 * - 右栏没有卡片时**不渲染**空列（`xl` 下不留 360px 空白）；
 * - 窄屏（`< xl`）按顺序叠成一列：先左栏全部卡，再右栏卡。
 */
export function CardLayoutGrid({
  items,
  leftTestId,
  rightTestId,
  rightClassName,
}: CardLayoutGridProps) {
  const left = items.filter((item) => item.width !== 'right')
  const right = items.filter((item) => item.width === 'right')
  const halves = left.filter((item) => item.width === 'half')
  const loneHalf = halves.length % 2 === 1 ? halves[halves.length - 1] : null

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-2',
        right.length > 0 && 'xl:grid-cols-[minmax(0,1fr)_360px]',
      )}
    >
      <div data-testid={leftTestId} className="grid min-w-0 content-start gap-2 sm:grid-cols-2">
        {left.map((item) => {
          const full = item.width === 'full' || item.id === loneHalf?.id
          return (
            <div
              key={item.id}
              className={cn(
                'min-w-0',
                full && 'sm:col-span-2',
                // 同一行的半宽卡片互相等高（网格行高 = 该行最高卡片）。
                !full && '[&>[data-slot=card]]:h-full',
              )}
            >
              {item.node}
            </div>
          )
        })}
      </div>
      {right.length > 0 && (
        <div
          data-testid={rightTestId}
          className={cn('flex min-w-0 flex-col gap-2', rightClassName)}
        >
          {right.map((item) => (
            <div key={item.id} className="min-w-0">
              {item.node}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
