import { useMemo, useRef, useState } from 'react'
import { ExternalLink, Plus, Star } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { SearchInput } from '@/components/SearchInput'
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatItemTag, searchItems } from '@/lib/items'
import type { Dataset, Item, ItemFavorite } from '@/types'

type InsertKind = 'id' | 'name' | 'tag'

interface ItemSearchPanelProps {
  dataset: Dataset
  /** 把文本插入指令输入框（光标处）。 */
  onInsert: (text: string) => void
  /** 前往物品图鉴并显示该物品。 */
  onOpenInDex?: (itemId: number) => void
  /** 收藏物品：搜索为空时展示（默认视图）。 */
  favorites?: ItemFavorite[]
  /** 点收藏物品：把 ID 追加到指令（**保留**收藏记录，下次还能点）。 */
  onInsertFavorite?: (id: number) => void
  /**
   * 只插入 `[i:ID]` 标签（「聊天」页的物品弹框用）：
   * 点一条即插入，不再展示「ID / 名称 / 标签」选择与详情确认区。
   */
  tagOnly?: boolean
}

/**
 * 指令页右侧「物品」tab：
 * - 搜索为空时默认展示收藏物品，点击即为「追加 ID 到指令」（收藏保留）；
 * - 有搜索词时展示搜索结果，选中后可插入 ID / 名称 / 标签或前往图鉴。
 * 输入框 ↓/Enter 把焦点交给列表；列表内 ↑↓ 移动并高亮。
 */
export function ItemSearchPanel({
  dataset,
  onInsert,
  onOpenInDex,
  favorites = [],
  onInsertFavorite,
  tagOnly = false,
}: ItemSearchPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [insertKind, setInsertKind] = useState<InsertKind>('id')
  const debounced = useDebouncedValue(query, 180)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const showFavorites = !debounced.trim()

  const results = useMemo(
    () => (debounced.trim() ? searchItems(dataset.items, debounced, 60) : []),
    [dataset.items, debounced],
  )

  // 搜索为空 → 收藏物品；有词 → 搜索结果。
  const rows = useMemo(() => {
    if (!showFavorites) return results
    return favorites
      .map((f) => dataset.itemsById.get(f.id))
      .filter((it): it is Item => Boolean(it))
  }, [showFavorites, favorites, dataset.itemsById, results])

  const focusResult = (index: number) => {
    setActiveIndex(index)
    itemRefs.current[index]?.focus()
  }

  const onQueryChange = (value: string) => {
    setQuery(value)
    setActiveIndex(-1)
    if (!value.trim()) setSelected(null)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'Enter') && rows.length > 0) {
      e.preventDefault()
      focusResult(0)
    }
  }

  const activate = (item: Item, index: number) => {
    if (tagOnly) {
      // 聊天里只需要标签本身：一下点完，不再走「选中 → 选插入方式 → 点插入」。
      onInsert(formatItemTag(item.id))
      return
    }
    if (showFavorites) {
      // 收藏：只把 ID 追到指令里，**不**动收藏记录（父级处理）。
      onInsertFavorite?.(item.id)
      return
    }
    setActiveIndex(index)
    setSelected(item)
  }

  const onResultKeyDown = (e: React.KeyboardEvent, index: number, item: Item) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusResult(Math.min(index + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (index === 0) {
        setActiveIndex(-1)
        inputRef.current?.focus()
      } else {
        focusResult(index - 1)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showFavorites) onInsertFavorite?.(item.id)
      else if (tagOnly) onInsert(formatItemTag(item.id))
      else onInsert(` ${item.id} `)
    }
  }

  const insertValue = (item: Item) => {
    const value =
      insertKind === 'id' ? String(item.id) : insertKind === 'name' ? item.name : formatItemTag(item.id)
    onInsert(value)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <SearchInput
        ref={inputRef}
        value={query}
        onValueChange={onQueryChange}
        onKeyDown={onInputKeyDown}
        placeholder={t('items.placeholder')}
        aria-label={t('items.title')}
      />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-container bg-accent/40">
        {rows.length === 0 ? (
          showFavorites ? (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Star />
                </EmptyMedia>
                <EmptyTitle>{t('items.favoritesEmpty')}</EmptyTitle>
                <EmptyDescription>{t('items.favoritesEmptyHint')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty size="sm" className="p-3">
              <EmptyDescription>{t('items.noMatch')}</EmptyDescription>
            </Empty>
          )
        ) : (
          <ul>
            {rows.map((item, index) => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  ref={(el) => {
                    itemRefs.current[index] = el
                  }}
                  onClick={() => activate(item, index)}
                  onKeyDown={(e) => onResultKeyDown(e, index, item)}
                  title={showFavorites ? t('items.insertFavoriteHint') : undefined}
                  className={cn(
                    'h-auto w-full cursor-pointer justify-start gap-2 rounded-none px-2 py-2 font-normal',
                    // 选中 / 键盘高亮只用**更深的底色**表示：不要描边（默认聚焦光圈会画出一圈深色框）。
                    'focus-visible:ring-0 focus-visible:ring-offset-0',
                    selected?.id === item.id || activeIndex === index
                      ? 'bg-foreground/10'
                      : 'hover:bg-foreground/5',
                  )}
                >
                  <ItemIcon item={item} atlas={dataset.atlas} size={24} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm text-foreground">{item.name}</span>
                    <span className="block truncate font-pixel text-2xs text-muted-foreground">
                      {item.key}
                    </span>
                  </span>
                  <span className="font-pixel text-2xs text-muted-foreground">{item.id}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && !showFavorites && !tagOnly && (
        <div className="shrink-0 rounded-control bg-accent/50 p-3">
          <div className="flex items-center gap-3">
            <ItemIcon item={selected} atlas={dataset.atlas} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{selected.name}</p>
              <p className="truncate font-pixel text-2xs text-muted-foreground">
                {selected.id} · {selected.key}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Select
                value={insertKind}
                onValueChange={(next) => setInsertKind(next as InsertKind)}
              >
                <SelectTrigger size="sm" aria-label={t('items.insert')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="id">{t('items.insertId')}</SelectItem>
                  <SelectItem value="name">{t('items.insertName')}</SelectItem>
                  <SelectItem value="tag">{t('items.insertTag')}</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="primary" onClick={() => insertValue(selected)}>
                <Plus data-icon="inline-start" />
                {t('items.insert')}
              </Button>
            </div>
            <Button size="sm" variant="secondary" onClick={() => onOpenInDex?.(selected.id)}>
              <ExternalLink data-icon="inline-start" />
              {t('items.gotoDex')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
