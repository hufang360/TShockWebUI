import { useState } from 'react'
import { Hammer } from 'lucide-react'
import { FavoriteRecipesPanel } from '@/components/FavoriteRecipesPanel'
import {
  Button,
  PANEL_POPOVER_WIDTH,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { useRecipeFavoritesState } from '@/hooks/useRecipeFavoritesState'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import type { Dataset } from '@/types'

/**
 * 「聊天」页输入框左下角的**合成表**入口（与物品入口并排）：收藏过的合成记录，点一条填进发言框。
 *
 * 点开是收藏过的合成记录（`tswui:recipeFavorites`，在物品图鉴的合成表条目上点 ⭐ 收藏）；
 * **点一条就把它填进输入框**，用带 `[i:ID]` 标签的文本（聊天里只有标签能显示成物品图标）：
 * `[i:11] x3 @ [i:17] → [i:22]`。
 */
export function RecipeFavoritesPopover({
  dataset,
  onPick,
}: {
  dataset: Dataset
  /** 选中一条：拿到带标签的文本（调用方负责追加到输入框）。 */
  onPick: (text: string) => void
}) {
  const { t } = useI18n()
  const { list } = useRecipeFavoritesState()
  // 是否显示物品名称跟随「物品图鉴 → 页面设置 → 合成记录」的同一个开关（跨页面同步）。
  const [showNames] = useLocalState<boolean>(StorageKeys.dexRecipeShowNames, false)
  const [open, setOpen] = useState(false)
  const label = t('chat.recipeFavorites')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 rounded-control text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3"
                aria-label={label}
                aria-haspopup="dialog"
              >
                <Hammer />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        aria-label={label}
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className={cn(
          'flex h-[min(28rem,60dvh)] flex-col gap-2 overflow-hidden p-2',
          PANEL_POPOVER_WIDTH,
          'max-w-none',
        )}
        // 焦点还给聊天输入框：这里拦下 Radix 的默认回焦（否则落到按钮上）。
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
        <FavoriteRecipesPanel
          dataset={dataset}
          favorites={list}
          // 固定单列（这里默认就是 1 列视图）。
          iconOnly={!showNames}
          twoColumn={false}
          onPick={(text) => {
            onPick(text)
            setOpen(false)
          }}
        />
        </div>
      </PopoverContent>
    </Popover>
  )
}
