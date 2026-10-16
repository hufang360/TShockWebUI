import { useMemo, useState } from 'react'
import { Check, Copy, Play, Star, Trash2 } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { Badge, Button, Empty, EmptyHeader, EmptyMedia, EmptyTitle, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { inspectCommand } from '@/lib/commands'
import { useI18n } from '@/lib/i18n'
import type { Dataset, FavoriteEntry, ItemFavorite } from '@/types'

interface CommandPickerPanelProps {
  view: 'commands' | 'favorites'
  dataset: Dataset
  favorites: FavoriteEntry[]
  /** 物品收藏（来自物品图鉴，展示在「收藏」tab）。 */
  itemFavorites?: ItemFavorite[]
  /** 当前编辑器文本是否已收藏（星标高亮）。 */
  currentKey: string
  favoritedCurrent: boolean
  onToggleCurrent: () => void
  onRemoveFavorite: (cmd: string) => void
  /** 移除一个物品收藏。 */
  onRemoveItemFavorite?: (id: number) => void
  /** 把物品 ID（前后带空格）插入指令输入框。 */
  onInsertItemId?: (id: number) => void
  /** 载入编辑器（不执行）。 */
  onLoad: (cmd: string) => void
  /** 立即执行（追加一条结果卡片）。 */
  onRun: (cmd: string) => void
  authenticated: boolean
  running: boolean
}

/**
 * 编辑器右侧卡片：
 * - `view="commands"`：全部指令（可按名称 / 别名 / 帮助搜索），右上角可收藏当前输入；
 * - `view="favorites"`：我的收藏（执行 / 载入 / 复制 / 删除）。
 */
export function CommandPickerPanel({
  view,
  dataset,
  favorites,
  itemFavorites = [],
  currentKey,
  favoritedCurrent,
  onToggleCurrent,
  onRemoveFavorite,
  onRemoveItemFavorite,
  onInsertItemId,
  onLoad,
  onRun,
  authenticated,
  running,
}: CommandPickerPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const keyword = query.trim().toLowerCase()

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

  const copy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(cmd)
      window.setTimeout(() => setCopied((cur) => (cur === cmd ? null : cur)), 1200)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={view === 'favorites' ? t('favorites.search') : t('cmd.search')}
          aria-label={view === 'favorites' ? t('favorites.search') : t('cmd.search')}
        />
        {view === 'commands' && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onToggleCurrent}
            disabled={!currentKey}
            aria-pressed={favoritedCurrent}
            aria-label={favoritedCurrent ? t('editor.unfavorite') : t('editor.favorite')}
            title={favoritedCurrent ? t('editor.unfavorite') : t('editor.favorite')}
          >
            <Star
              className={cn(favoritedCurrent && 'fill-current text-warning')}
              data-icon="inline-start"
            />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
        {view === 'favorites' ? (
          <section className="flex flex-col gap-3">
            {itemFavorites.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[11px] text-muted-foreground">
                  {t('favorites.items', { n: itemFavorites.length })}
                </h3>
                <ul className="flex flex-col gap-1">
                  {itemFavorites.map((f) => {
                    const item = dataset.itemsById.get(f.id)
                    return (
                      <li
                        key={f.id}
                        className="flex items-center gap-2 rounded-lg bg-accent/40 px-1.5 py-1"
                      >
                        <Button
                          variant="ghost"
                          className="h-auto min-w-0 flex-1 cursor-pointer justify-start gap-2 px-0.5 py-0.5 font-normal"
                          title={item?.name ?? `#${f.id}`}
                          onClick={() => onInsertItemId?.(f.id)}
                        >
                          <ItemIcon item={item} atlas={dataset.atlas} size={22} />
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-xs text-foreground">
                              {item?.name ?? `#${f.id}`}
                            </span>
                            <span className="block truncate font-pixel text-[10px] text-muted-foreground">
                              {f.id}
                            </span>
                          </span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 px-1.5"
                          aria-label={t('favorites.remove')}
                          title={t('favorites.remove')}
                          onClick={() => onRemoveItemFavorite?.(f.id)}
                        >
                          <Trash2 data-icon="inline-start" />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[11px] text-muted-foreground">
                {t('favorites.count', { n: filteredFavorites.length })}
              </h3>
              {filteredFavorites.length === 0 ? (
                itemFavorites.length === 0 && (
                  <Empty className="py-6">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Star />
                      </EmptyMedia>
                      <EmptyTitle>
                        {keyword ? t('favorites.noMatch') : t('favorites.empty')}
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {filteredFavorites.map((fav) => {
                    const check = inspectCommand(fav.cmd, dataset)
                    const inGameOnly = check.executability === 'in_game_only'
                    return (
                      <li key={fav.cmd} className="rounded-lg bg-accent/40 p-2">
                        <code className="block truncate font-pixel text-[11px] text-foreground" title={fav.cmd}>
                          {fav.cmd}
                        </code>
                        <div className="mt-1 flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-1.5"
                            disabled={!authenticated || inGameOnly || running}
                            title={t('favorites.run')}
                            onClick={() => onRun(fav.cmd)}
                          >
                            <Play data-icon="inline-start" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-1.5"
                            title={t('favorites.load')}
                            onClick={() => onLoad(fav.cmd)}
                          >
                            {t('favorites.load')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-1.5"
                            title={t('favorites.copy')}
                            onClick={() => void copy(fav.cmd)}
                          >
                            {copied === fav.cmd ? (
                              <Check data-icon="inline-start" />
                            ) : (
                              <Copy data-icon="inline-start" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto px-1.5"
                            aria-label={t('favorites.remove')}
                            title={t('favorites.remove')}
                            onClick={() => onRemoveFavorite(fav.cmd)}
                          >
                            <Trash2 data-icon="inline-start" />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        ) : (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-[11px] text-muted-foreground">
              {t('cmd.all', { n: commands.length })}
            </h3>
            <ul>
              {commands.map((cmd) => {
                const inGameOnly = !cmd.allowServer
                return (
                  <li key={cmd.name}>
                    <Button
                      variant="ghost"
                      onClick={() => onLoad(`/${cmd.name} `)}
                      title={cmd.helpZh ?? cmd.help}
                      className="h-auto w-full cursor-pointer flex-col items-start gap-0.5 px-2 py-1.5 font-normal"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-pixel text-xs text-foreground">/{cmd.name}</span>
                        {inGameOnly && <Badge tone="warn">{t('editor.badge.inGame')}</Badge>}
                      </span>
                      <span className="block w-full truncate text-left text-[10px] text-muted-foreground">
                        {cmd.helpZh ?? cmd.help}
                      </span>
                    </Button>
                  </li>
                )
              })}
              {commands.length === 0 && (
                <li className="px-2 py-2 text-[11px] text-muted-foreground">{t('cmd.noMatch')}</li>
              )}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
