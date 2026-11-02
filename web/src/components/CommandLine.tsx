import { useState } from 'react'
import { Check, Copy, Star, Terminal } from 'lucide-react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { IconAction } from '@/components/IconAction'
import { ItemIcon } from '@/components/ItemIcon'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useCommandFavoritesState } from '@/hooks/useCommandFavoritesState'
import { cn } from '@/lib/cn'
import { useDataset } from '@/lib/datasetContext'
import type { CommandFavoritesApi } from '@/lib/favorites'
import { useI18n } from '@/lib/i18n'
import type { RelatedCommand } from '@/lib/npcRelatedCommands'
import { RECIPE_SECTION_TONE } from '@/lib/sectionTones'
import { useTerminal } from '@/lib/terminalContext'

/** 「相关指令」标题前的图标：149 号物品（书）。与物品详情的「合成」分组同一套图标语言。 */
const RELATED_ICON_ID = 149

/**
 * 「相关指令」分组：标题可折叠（与物品详情的「合成」分组同一套观感：物品图标 + 同色标题 + 折角箭头），
 * **标题后面带条目数量**；下面每条指令一行 —— **外观同合成记录**（无描边、浅底 `bg-accent/40`、悬停加深）。
 *
 * 交互（与合成记录一致，但**整行本身什么也不做**）：
 * - 终端：把指令填进右下角的**浮动终端**并让它弹出来（`terminal.open(command)`）；
 *   抽屉会挡在浮窗上面，所以给了 `onOpenTerminal` 时顺手让调用方关掉抽屉；
 * - ⭐ 收藏这条指令（写进「指令」页的收藏，与结果卡片同一份数据）；
 * - 复制：只复制，不执行。
 * 带 `note` 的条目（如 `/sb all` → 召唤所有Boss）悬停整行时用 Tooltip 出说明。
 */
export function CommandLine({
  label,
  commands,
  onOpenTerminal,
}: {
  label: string
  /** 指令条目：可以只给文本，也可以带 `note`（悬停说明）。 */
  commands: Array<string | RelatedCommand>
  /** 点了「填充指令」之后调用（用来关掉挡住浮动终端的抽屉）。 */
  onOpenTerminal?: () => void
}) {
  const { t } = useI18n()
  const dataset = useDataset()
  const [open, setOpen] = useState(true)
  // 收藏接口只取一次：多行共用同一份 `tswui:favorites`（`useLocalState` 的事件同步）。
  const { api: favorites } = useCommandFavoritesState()
  const iconItem = dataset?.itemsById.get(RELATED_ICON_ID)
  const items: RelatedCommand[] = commands.map((c) => (typeof c === 'string' ? { command: c } : c))
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1">
      <CollapsibleTrigger className="group/title flex w-full cursor-pointer items-center gap-2 text-sm font-medium">
        {iconItem && dataset && (
          <ItemIcon item={iconItem} atlas={dataset.atlas} size={20} tooltip={false} />
        )}
        <span className={cn('truncate', RECIPE_SECTION_TONE.use)}>
          {t('commandLine.withCount', { label, n: items.length })}
        </span>
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-1">
          {items.map((item) => (
            <CommandRow
              key={item.command}
              item={item}
              favorites={favorites}
              onOpenTerminal={onOpenTerminal}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function CommandRow({
  item,
  favorites,
  onOpenTerminal,
}: {
  item: RelatedCommand
  favorites: CommandFavoritesApi
  onOpenTerminal?: () => void
}) {
  const { t } = useI18n()
  const { open: openTerminal } = useTerminal()
  const [copied, setCopied] = useState(false)
  const { command } = item
  const note = item.note ? t(item.note.key, item.note.vars) : null
  const favorited = favorites.isFavorited(command)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  const row = (
    <div
      data-testid="command-row"
      // 有说明时说明走 Tooltip；没说明时用原生 title 兜底被截断的指令。
      title={note ? undefined : command}
      className={cn(
        'group/cmd flex w-full min-w-0 items-center gap-2 rounded-control bg-accent/40 px-3 py-2',
        'transition-colors duration-150 hover:bg-accent',
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{command}</code>
      {/* 悬停 / 聚焦才出现；`touch-visible` 让触屏常显（没有 hover）。 */}
      <span className="touch-visible flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/cmd:opacity-100 group-focus-within/cmd:opacity-100">
        <IconAction
          size="icon-xs"
          label={t('commandLine.terminal')}
          icon={Terminal}
          onClick={() => {
            openTerminal(command)
            onOpenTerminal?.()
          }}
        />
        <IconAction
          size="icon-xs"
          label={favorited ? t('commandLine.unfavorite') : t('commandLine.favorite')}
          icon={Star}
          iconClassName={cn(favorited && 'fill-current text-warning')}
          pressed={favorited}
          onClick={() => favorites.toggle(command)}
        />
        <IconAction
          size="icon-xs"
          label={copied ? t('action.copied') : t('action.copy')}
          icon={copied ? Check : Copy}
          onClick={() => void copy()}
        />
      </span>
    </div>
  )
  if (!note) return row
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent>{note}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
