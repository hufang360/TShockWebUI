import { useMemo, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { BatchDeleteControls } from '@/components/BatchDeleteControls'
import { ConfirmButton } from '@/components/ConfirmButton'
import { SearchInput } from '@/components/SearchInput'
import { SelectIndicator } from '@/components/SelectIndicator'
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { CollapseChevron } from '@/components/CollapseChevron'
import { useBatchSelect } from '@/hooks/useBatchSelect'
import { useRovingFocus } from '@/hooks/useRovingFocus'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import type { Dataset, FavoriteEntry } from '@/types'

interface CommandPickerPanelProps {
  view: 'commands' | 'favorites'
  dataset: Dataset
  /** 指令收藏（`view="favorites"` 用）。 */
  favorites?: FavoriteEntry[]
  /** 移除一个指令收藏。 */
  onRemoveFavorite?: (cmd: string) => void
  /** 清空全部指令收藏。 */
  onClearFavorites?: () => void
  /** 用指令替换编辑器内容（并把焦点移回输入框）。 */
  onLoad: (cmd: string) => void
}

/**
 * 编辑器右侧卡片：
 * - `view="commands"`：全部指令（按名称 / 别名 / 帮助搜索，前导 `/` 会被忽略），点击载入编辑器；
 * - `view="favorites"`：指令收藏（搜索 + 批量删除 / 清空 + 列表）。点击行即载入编辑器。
 * 两个视图都支持搜索框 ↑↓ 进入列表、列表内 ↑↓ 移动、Enter 确认。
 */
export function CommandPickerPanel({
  view,
  dataset,
  favorites = [],
  onRemoveFavorite,
  onClearFavorites,
  onLoad,
}: CommandPickerPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const batch = useBatchSelect()

  // 前导 `/` 不参与匹配（用户常直接粘贴 `/setup`）。
  const trimmed = query.trim().toLowerCase()
  const keyword = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed

  const filteredFavorites = useMemo(
    () => (keyword ? favorites.filter((f) => f.cmd.toLowerCase().includes(keyword)) : favorites),
    [favorites, keyword],
  )

  const commands = useMemo(() => {
    const list = dataset.commands
    if (!keyword) return list
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(keyword) ||
        c.aliases.some((a) => a.toLowerCase().includes(keyword)) ||
        (c.helpZh ?? c.help).toLowerCase().includes(keyword),
    )
  }, [dataset.commands, keyword])

  // `allowServer=false` 的指令（只能游戏内执行）统一排到最下，收进可折叠分组。
  const { runnable, inGame } = useMemo(() => {
    const ok: typeof commands = []
    const blocked: typeof commands = []
    for (const cmd of commands) (cmd.allowServer === false ? blocked : ok).push(cmd)
    return { runnable: ok, inGame: blocked }
  }, [commands])
  // 两个分组都可折叠；搜索时自动展开（否则搜到了也看不见），清空搜索后回到用户手动选择的状态。
  const [showAll, setShowAll] = useState(true)
  const [showInGame, setShowInGame] = useState(false)
  const allOpen = showAll || (keyword.length > 0 && runnable.length > 0)
  const inGameOpen = showInGame || (keyword.length > 0 && inGame.length > 0)
  // 键盘导航只用当前可见的行（折叠的分组跳过），下标从 0 连续排。
  const inGameBase = allOpen ? runnable.length : 0
  const visibleCount = inGameBase + (inGameOpen ? inGame.length : 0)

  const roving = useRovingFocus(
    view === 'commands' ? visibleCount : filteredFavorites.length,
  )

  const handleBatchDelete = () => {
    for (const key of batch.selected) {
      if (key.startsWith('cmd:')) onRemoveFavorite?.(key.slice(4))
    }
    batch.cancel()
  }

  /** 普通模式：点击/Enter 载入编辑器；批量模式：点击勾选。 */
  const activate = (key: string, cmd: string) => {
    if (batch.active) {
      batch.toggle(key)
      return
    }
    roving.reset()
    onLoad(cmd)
  }

  const onRowKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      roving.move(index, 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!roving.move(index, -1)) {
        roving.reset()
        inputRef.current?.focus()
      }
    }
  }

  /** 一行指令：**指令与说明同一行**（说明占满剩余宽度、超出截断，hover 出完整说明）。 */
  const renderRow = (cmd: Dataset['commands'][number], index: number) => {
    const inGameOnly = cmd.allowServer === false
    const help = cmd.helpZh ?? cmd.help
    return (
      <li key={cmd.name}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              ref={roving.setRef(index)}
              onFocus={() => roving.setActive(index)}
              onClick={() => onLoad(`/${cmd.name} `)}
              onKeyDown={(e) => onRowKeyDown(e, index)}
              className={cn(
                'h-7 w-full cursor-pointer justify-start gap-2 px-2 font-normal',
                roving.activeIndex === index && 'bg-accent',
              )}
            >
              <span
                className={cn(
                  'max-w-[40%] shrink-0 truncate font-pixel text-xs leading-5',
                  // 只能进游戏执行的指令用红色，和可执行的一眼区分（不再挂 badge）。
                  inGameOnly ? 'text-destructive' : 'text-foreground',
                )}
              >
                /{cmd.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-xs leading-5 text-muted-foreground">
                {help}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-80 text-balance">
            {help}
          </TooltipContent>
        </Tooltip>
      </li>
    )
  }

  /** 搜索框 ↑↓ / Enter 进入列表第一行。 */
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault()
      roving.move(-1, 1)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <SearchInput
        ref={inputRef}
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          roving.reset()
        }}
        onKeyDown={onInputKeyDown}
        placeholder={view === 'favorites' ? t('favorites.search') : t('cmd.search')}
        aria-label={view === 'favorites' ? t('favorites.search') : t('cmd.search')}
      />

      {view === 'favorites' ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {batch.active
                ? t('batch.hint')
                : t('favorites.commands', { n: filteredFavorites.length })}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <BatchDeleteControls
                active={batch.active}
                count={batch.count}
                disabled={favorites.length === 0}
                onEnter={batch.enter}
                onCancel={batch.cancel}
                onConfirm={handleBatchDelete}
              />
              {!batch.active && (
                <ConfirmButton
                  onConfirm={() => onClearFavorites?.()}
                  confirmLabel={t('action.clearConfirm')}
                >
                  {t('favorites.clear')}
                </ConfirmButton>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {filteredFavorites.length === 0 ? (
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Star />
                  </EmptyMedia>
                  <EmptyTitle>{keyword ? t('favorites.noMatch') : t('favorites.empty')}</EmptyTitle>
                  {!keyword && <EmptyDescription>{t('favorites.emptyHint')}</EmptyDescription>}
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {filteredFavorites.map((fav, index) => {
                  const key = `cmd:${fav.cmd}`
                  const isSelected = batch.active ? batch.has(key) : roving.activeIndex === index
                  return (
                    <li key={fav.cmd}>
                      <Button
                        variant="ghost"
                        ref={roving.setRef(index)}
                        aria-pressed={batch.active ? batch.has(key) : undefined}
                        title={batch.active ? undefined : t('favorites.loadHint')}
                        onFocus={() => roving.setActive(index)}
                        onClick={() => activate(key, fav.cmd)}
                        onKeyDown={(e) => onRowKeyDown(e, index)}
                        className={cn(
                          'h-auto w-full cursor-pointer justify-start gap-2 rounded-control bg-accent/40 px-2 py-1 font-normal hover:bg-accent',
                          isSelected && 'bg-accent',
                        )}
                      >
                        {batch.active && <SelectIndicator checked={batch.has(key)} />}
                        <code className="min-w-0 flex-1 truncate text-left font-pixel text-2xs text-foreground">
                          {fav.cmd}
                        </code>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <TooltipProvider delayDuration={300}>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-2">
            <Collapsible
              open={allOpen}
              onOpenChange={(open) => {
                setShowAll(open)
                roving.reset()
              }}
              className="flex flex-col"
            >
              {/* 分组标题在滚动区里**吸顶**（吸在搜索框下面那一行），滚动时不跟着走。 */}
              <CollapsibleTrigger className="group/title sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 border-b border-border/60 bg-popover py-1.5 text-left">
                <span className="text-xs text-muted-foreground">
                  {t('cmd.all', { n: commands.length })}
                </span>
                <CollapseChevron open={allOpen} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="pt-1">
                  {runnable.map((cmd, index) => renderRow(cmd, index))}
                  {runnable.length === 0 && inGame.length === 0 && (
                    <li className="px-2 py-2 text-xs text-muted-foreground">{t('cmd.noMatch')}</li>
                  )}
                </ul>
              </CollapsibleContent>
            </Collapsible>

            {inGame.length > 0 && (
              <Collapsible
                open={inGameOpen}
                onOpenChange={(open) => {
                  setShowInGame(open)
                  roving.reset()
                }}
                className="flex flex-col"
              >
                <CollapsibleTrigger className="group/title sticky top-0 z-10 mt-1 flex w-full cursor-pointer items-center gap-2 border-b border-border/60 bg-popover py-1.5 text-left">
                  <span className="text-xs text-muted-foreground">
                    {t('cmd.ingameGroup', { n: inGame.length })}
                  </span>
                  <CollapseChevron open={inGameOpen} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="pt-1">
                    {inGame.map((cmd, index) => renderRow(cmd, inGameBase + index))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </TooltipProvider>
      )}
    </div>
  )
}
