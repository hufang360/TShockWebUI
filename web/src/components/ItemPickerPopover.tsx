import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { ItemSearchPanel } from '@/components/ItemSearchPanel'
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
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatItemTag } from '@/lib/items'
import type { Dataset, ItemFavorite } from '@/types'

/**
 * 「聊天」页输入框左下角的**物品**入口：点开一个搜物品的弹框，选中即把 `[i:ID]` 交给调用方。
 *
 * 与指令页的工具弹框同一套交互（贴在按钮上方展开、点外面收起、打开即可打字筛选），
 * 区别只有两点：这里**没有 tab 栏**（只有一个「物品」面板），并且只插标签（`formatItemTag`），
 * 不提供「ID / 名称 / 标签」选择 —— 聊天里能认出物品的只有 `[i:ID]`。
 */
export function ItemPickerPopover({
  dataset,
  favorites,
  onPick,
  onOpenInDex,
}: {
  dataset: Dataset
  /** 搜索框为空时展示的收藏物品。 */
  favorites?: ItemFavorite[]
  /** 选中物品：拿到 `[i:ID]`（调用方负责追加到输入框）。 */
  onPick: (tag: string) => void
  /** 前往物品图鉴（可选；不传则面板不显示该入口）。 */
  onOpenInDex?: (itemId: number) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const pick = (tag: string) => {
    onPick(tag)
    setOpen(false)
  }

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
                aria-label={t('editor.tab.items')}
                aria-haspopup="dialog"
              >
                <BookOpen />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('editor.tab.items')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        aria-label={t('editor.tab.items')}
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className={cn(
          'flex h-[min(28rem,60dvh)] flex-col gap-2 overflow-hidden p-2',
          PANEL_POPOVER_WIDTH,
          'max-w-none',
        )}
        // 焦点还给聊天输入框：这里拦下 Radix 的默认回焦（否则落到物品按钮上）。
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ItemSearchPanel
          dataset={dataset}
          tagOnly
          favorites={favorites}
          onInsert={pick}
          onInsertFavorite={(id) => pick(formatItemTag(id))}
          onOpenInDex={onOpenInDex}
        />
      </PopoverContent>
    </Popover>
  )
}
