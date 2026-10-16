import { useMemo, useRef, useState } from 'react'
import { ExternalLink, Plus } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { Button, Input, NativeSelect, NativeSelectOption } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { formatItemTag, searchItems } from '@/lib/items'
import type { Dataset, Item } from '@/types'

type InsertKind = 'id' | 'name' | 'tag'

interface ItemSearchPanelProps {
  dataset: Dataset
  /** 把文本插入指令输入框（光标处）。 */
  onInsert: (text: string) => void
  /** 前往物品图鉴并显示该物品。 */
  onOpenInDex?: (itemId: number) => void
}

/**
 * 指令页右侧「物品」tab：搜索物品并插入 ID / 名称 / 标签。
 * 输入框按 ↓ / Enter 把焦点交给结果区；结果按 Enter 插入 ID（前后加空格）并回到指令输入框。
 */
export function ItemSearchPanel({ dataset, onInsert, onOpenInDex }: ItemSearchPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [insertKind, setInsertKind] = useState<InsertKind>('id')
  const debounced = useDebouncedValue(query, 180)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const results = useMemo(
    () => (debounced.trim() ? searchItems(dataset.items, debounced, 60) : []),
    [dataset.items, debounced],
  )

  const focusResult = (index: number) => {
    itemRefs.current[index]?.focus()
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'Enter') && results.length > 0) {
      e.preventDefault()
      focusResult(0)
    }
  }

  const onResultKeyDown = (e: React.KeyboardEvent, index: number, item: Item) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusResult(Math.min(index + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (index === 0) inputRef.current?.focus()
      else focusResult(index - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // 插入 ID（前后各一个空格）；onInsert 会把焦点交回指令输入框末尾。
      onInsert(` ${item.id} `)
    }
  }

  const insertValue = (item: Item) => {
    const value =
      insertKind === 'id' ? String(item.id) : insertKind === 'name' ? item.name : formatItemTag(item.id)
    onInsert(value)
  }

  return (
    <div className="-mx-2 flex h-full min-h-0 flex-col gap-2">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder={t('items.placeholder')}
        aria-label={t('items.title')}
        className="mx-2"
      />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-accent/40">
        {results.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t('items.startHint')}</p>
        ) : (
          <ul>
            {results.map((item, index) => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  ref={(el) => {
                    itemRefs.current[index] = el
                  }}
                  onClick={() => setSelected(item)}
                  onKeyDown={(e) => onResultKeyDown(e, index, item)}
                  className={cn(
                    'h-auto w-full cursor-pointer justify-start gap-2 rounded-none px-2 py-1.5 font-normal',
                    selected?.id === item.id && 'bg-accent',
                  )}
                >
                  <ItemIcon item={item} atlas={dataset.atlas} size={24} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm text-foreground">{item.name}</span>
                    <span className="block truncate font-pixel text-[10px] text-muted-foreground">
                      {item.key}
                    </span>
                  </span>
                  <span className="font-pixel text-[11px] text-muted-foreground">{item.id}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="mx-2 shrink-0 rounded-lg bg-accent/50 p-2.5">
          <div className="flex items-center gap-3">
            <ItemIcon item={selected} atlas={dataset.atlas} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{selected.name}</p>
              <p className="truncate font-pixel text-[11px] text-muted-foreground">
                {selected.id} · {selected.key}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <NativeSelect
                size="sm"
                value={insertKind}
                onChange={(e) => setInsertKind(e.target.value as InsertKind)}
                aria-label={t('items.insert')}
              >
                <NativeSelectOption value="id">{t('items.insertId')}</NativeSelectOption>
                <NativeSelectOption value="name">{t('items.insertName')}</NativeSelectOption>
                <NativeSelectOption value="tag">{t('items.insertTag')}</NativeSelectOption>
              </NativeSelect>
              <Button size="sm" variant="primary" onClick={() => insertValue(selected)}>
                <Plus data-icon="inline-start" />
                {t('items.insert')}
              </Button>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpenInDex?.(selected.id)}
            >
              <ExternalLink data-icon="inline-start" />
              {t('items.gotoDex')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
