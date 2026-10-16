import type { ComponentProps } from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'

/**
 * shadcn Collapsible（Radix）薄封装。
 * 用于「玩家管理」的银行 / 配装分区折叠；触发器一般包在自定义的标题按钮上。
 */
export function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

export function CollapsibleTrigger(
  props: ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>,
) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />
}

export function CollapsibleContent(
  props: ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>,
) {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />
}
