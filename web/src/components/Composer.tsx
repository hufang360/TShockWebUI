import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * 输入区外壳：**输入在上、工具行在下**（左上角放工具按钮、右下角放发送）。
 *
 * 指令输入框（`CommandEditor`）用它，聊天发言（同一个输入框的聊天模式）也用它 ——
 * 输入区的圆角、内边距、高度只有这一份定义，切模式时输入框不会跳。
 */
export function Composer({
  leading,
  trailing,
  invalid = false,
  children,
}: {
  /** 工具行左侧（如指令库 / 物品 / 收藏 / 历史按钮）。 */
  leading?: ReactNode
  /** 工具行右侧（如发送按钮）。 */
  trailing?: ReactNode
  /** 只能游戏内执行等错误态：整体描红。 */
  invalid?: boolean
  /** 输入行（单行 textarea / input）。 */
  children: ReactNode
}) {
  return (
    <div
      data-slot="composer"
      className={cn(
        'flex flex-col rounded-container border border-border bg-card',
        'px-2 py-1.5',
        'transition-[border-color,box-shadow] duration-150',
        // 聚焦是**外发光**（柔和的主色光圈，画在边框外面），不是硬描边；
        // 外层容器留 `p-1`，光圈才不会被相邻元素的边缘切掉。
        'focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/25',
        invalid &&
          'border-destructive/60 focus-within:border-destructive/70 focus-within:ring-destructive/25',
      )}
    >
      {children}
      <div className="mt-1 flex items-center gap-1">
        {leading}
        <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div>
      </div>
    </div>
  )
}
