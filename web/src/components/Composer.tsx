import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * 输入区外壳（聊天式）：**输入在上、工具行在下**，左上角放工具按钮、右下角放发送。
 *
 * 指令输入框（`CommandEditor`）和网页发言（`WebChatInput`）共用同一个外壳，
 * 这样在「指令 ⇄ 聊天」之间切换时圆角、内边距、高度完全一致，输入框不会跳。
 */
export function Composer({
  leading,
  trailing,
  invalid = false,
  compact = false,
  children,
}: {
  /** 工具行左侧（如指令库 / 物品 / 收藏 / 历史按钮）。 */
  leading?: ReactNode
  /** 工具行右侧（如模式切换 + 发送按钮）。 */
  trailing?: ReactNode
  /** 只能游戏内执行等错误态：整体描红。 */
  invalid?: boolean
  /** 紧凑尺寸（浮动终端用）。 */
  compact?: boolean
  /** 输入行（单行 textarea / input）。 */
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border border-border bg-card',
        compact ? 'px-2 py-1.5' : 'px-3 py-2',
        'focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring',
        invalid && 'ring-1 ring-destructive/60',
      )}
    >
      {children}
      <div className={cn('flex items-center gap-1', compact ? 'mt-0.5' : 'mt-1')}>
        {leading}
        <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div>
      </div>
    </div>
  )
}
