import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'

/**
 * 悬停提示（文本或两行小卡片）。
 *
 * 用 shadcn/Radix `Tooltip`（而不是原生 `title`）：槽位悬停时有 `-translate-y-0.5` 的位移，
 * 元素在指针下移动会反复触发 enter/leave，原生 tooltip 常常不弹出。
 *
 * 有物品的格子由 `ItemIcon` 自带的 `ItemTooltip`（游戏同款样式）负责；
 * 空格子、鱼店的非原生商品（借来的识别图，不是真物品）用本组件。
 */
export function SlotTooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
