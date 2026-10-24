import { Eye } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { Button } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/cn'
import type { Atlas, Item } from '@/types'

function splitRows(rows: Item[], twoCols: boolean): [Item[], Item[]] {
  const split = twoCols && rows.length > 8
  const half = split ? Math.ceil(rows.length / 2) : rows.length
  return [rows.slice(0, half), split ? rows.slice(half) : []]
}

function ItemTable({
  rows,
  atlas,
  selectedId,
  onSelect,
}: {
  rows: Item[]
  atlas: Atlas | undefined
  selectedId: number | null
  onSelect: (item: Item) => void
}) {
  const { t } = useI18n()
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-16" />
          <col className="w-10" />
          <col />
          <col />
          <col className="w-9" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-background/90 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-right font-medium">ID</th>
            <th className="px-1 py-2 text-center font-medium">{t('dataId.table.icon')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.name')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.key')}</th>
            <th className="w-9 px-1 py-2">
              <span className="sr-only">{t('dex.detail')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.id}
              title={`${item.name} #${item.id}`}
              className={cn(
                'group/row border-t border-border/50 transition-colors odd:bg-muted/25 hover:bg-primary/10',
                selectedId === item.id && 'bg-primary/10',
              )}
            >
              <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">
                {item.id}
              </td>
              <td className="px-1 py-0.5">
                <span data-testid="item-table-icon" className="inline-flex items-center justify-center">
                  <ItemIcon item={item} atlas={atlas} size={24} tooltip={false} />
                </span>
              </td>
              <td className="truncate px-3 py-1.5 text-foreground" title={item.name}>
                {item.name}
              </td>
              <td
                className="truncate px-3 py-1.5 font-mono text-xs text-muted-foreground"
                title={item.key}
              >
                {item.key}
              </td>
              <td className="px-1 py-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('dex.detail')}
                  onClick={() => onSelect(item)}
                  className="opacity-100 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100"
                >
                  <Eye />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ItemTableLayout({
  rows,
  atlas,
  selectedId,
  twoCols,
  onSelect,
}: {
  rows: Item[]
  atlas: Atlas | undefined
  selectedId: number | null
  twoCols: boolean
  onSelect: (item: Item) => void
}) {
  const [left, right] = splitRows(rows, twoCols)
  return (
    <div className={cn('grid gap-x-6 gap-y-3', right.length > 0 && 'xl:grid-cols-2')}>
      <ItemTable rows={left} atlas={atlas} selectedId={selectedId} onSelect={onSelect} />
      {right.length > 0 && (
        <ItemTable rows={right} atlas={atlas} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  )
}
