import { useMemo, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { BatchDeleteControls } from '@/components/BatchDeleteControls'
import { ConfirmButton } from '@/components/ConfirmButton'
import { SearchInput } from '@/components/SearchInput'
import { SelectIndicator } from '@/components/SelectIndicator'
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui'
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

  const roving = useRovingFocus(view === 'commands' ? commands.length : filteredFavorites.length)

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
            <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
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
                          'h-auto w-full cursor-pointer justify-start gap-2 rounded-lg bg-accent/40 px-1.5 py-1 font-normal hover:bg-accent',
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
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <section className="flex flex-col gap-1.5">
            <h3 className="text-2xs text-muted-foreground">
              {t('cmd.all', { n: commands.length })}
            </h3>
            <ul>
              {commands.map((cmd, index) => {
                const inGameOnly = !cmd.allowServer
                return (
                  <li key={cmd.name}>
                    <Button
                      variant="ghost"
                      ref={roving.setRef(index)}
                      onFocus={() => roving.setActive(index)}
                      onClick={() => onLoad(`/${cmd.name} `)}
                      onKeyDown={(e) => onRowKeyDown(e, index)}
                      title={cmd.helpZh ?? cmd.help}
                      className={cn(
                        'h-auto w-full cursor-pointer flex-col items-start gap-0.5 px-2 py-1.5 font-normal',
                        roving.activeIndex === index && 'bg-accent',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-pixel text-xs text-foreground">/{cmd.name}</span>
                        {inGameOnly && <Badge tone="warn">{t('editor.badge.inGame')}</Badge>}
                      </span>
                      <span className="block w-full truncate text-left text-2xs text-muted-foreground">
                        {cmd.helpZh ?? cmd.help}
                      </span>
                    </Button>
                  </li>
                )
              })}
              {commands.length === 0 && (
                <li className="px-2 py-2 text-2xs text-muted-foreground">{t('cmd.noMatch')}</li>
              )}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
