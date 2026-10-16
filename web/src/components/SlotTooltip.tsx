import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'

/**
 * 空格子的**文本**提示。
 *
 * 用 shadcn/Radix `Tooltip`（而不是原生 `title`）：槽位悬停时有 `-translate-y-0.5` 的位移，
 * 元素在指针下移动会反复触发 enter/leave，原生 tooltip 常常不弹出。
 *
 * 只有**空格子**才用本组件；有物品的格子由 `ItemIcon` 自带的 `ItemTooltip`（游戏同款样式）负责。
 */
export function SlotTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
