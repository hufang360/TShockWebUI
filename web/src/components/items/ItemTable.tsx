import { useEffect, useRef, useState } from 'react'
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

/**
 * 表格每批渲染的行数。物品最多 6000+ 条，一次性挂全会明显卡顿（每行还有图标），
 * 所以按批增量渲染：滚动到底部附近再追加下一批。
 */
const TABLE_PAGE_SIZE = 200

function ItemTable({
  rows,
  atlas,
  selectedId,
  onSelect,
  resetKey,
}: {
  rows: Item[]
  atlas: Atlas | undefined
  selectedId: number | null
  onSelect: (item: Item) => void
  /** 筛选 / 搜索 / 视图变化时重置已渲染的行数。 */
  resetKey: string
}) {
  const { t } = useI18n()
  const [limit, setLimit] = useState(TABLE_PAGE_SIZE)
  const sentinelRef = useRef<HTMLTableRowElement | null>(null)

  // 换筛选条件（或切两列）后回到第一批，避免带着上一次的滚动深度渲染几千行。
  useEffect(() => {
    setLimit(TABLE_PAGE_SIZE)
  }, [resetKey])

  const hasMore = limit < rows.length
  useEffect(() => {
    const el = sentinelRef.current
    if (!hasMore || !el) return
    if (typeof IntersectionObserver === 'undefined') {
      // 兜底：没有 IO 的环境（旧浏览器 / 极简 jsdom）直接一次渲染完。
      setLimit(rows.length)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((n) => Math.min(rows.length, n + TABLE_PAGE_SIZE))
        }
      },
      // 提前一屏开始追加，滚动时不会露出空白。
      { rootMargin: '800px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, limit, rows.length])

  const shown = rows.slice(0, limit)
  return (
    <div className="overflow-hidden rounded-control border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-16" />
          <col className="w-10" />
          <col />
          <col />
          <col className="w-9" />
        </colgroup>
        <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-xs text-muted-foreground backdrop-blur">
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
          {shown.map((item) => (
            <tr
              key={item.id}
              title={`${item.name} #${item.id}`}
              className={cn(
                'group/row border-t border-border/50 transition-colors odd:bg-muted/25 hover:bg-primary/10',
                selectedId === item.id && 'bg-primary/10',
              )}
            >
              <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                {item.id}
              </td>
              <td className="px-1 py-0.5">
                <span data-testid="item-table-icon" className="inline-flex items-center justify-center">
                  <ItemIcon item={item} atlas={atlas} size={24} tooltip={false} />
                </span>
              </td>
              <td className="truncate px-3 py-2 text-foreground" title={item.name}>
                {item.name}
              </td>
              <td
                className="truncate px-3 py-2 font-mono text-xs text-muted-foreground"
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
          {hasMore && (
            <tr ref={sentinelRef}>
              <td
                colSpan={5}
                className="border-t border-border/50 px-3 py-2 text-center text-xs text-muted-foreground"
              >
                {t('dex.table.moreHint', { shown: shown.length, total: rows.length })}
              </td>
            </tr>
          )}
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
  resetKey = '',
}: {
  rows: Item[]
  atlas: Atlas | undefined
  selectedId: number | null
  twoCols: boolean
  onSelect: (item: Item) => void
  /** 筛选条件签名：变化时表格回到第一批（见 `ItemTable`）。 */
  resetKey?: string
}) {
  const [left, right] = splitRows(rows, twoCols)
  return (
    <div className={cn('grid gap-x-6 gap-y-3', right.length > 0 && 'xl:grid-cols-2')}>
      <ItemTable
        rows={left}
        atlas={atlas}
        selectedId={selectedId}
        onSelect={onSelect}
        resetKey={resetKey}
      />
      {right.length > 0 && (
        <ItemTable
          rows={right}
          atlas={atlas}
          selectedId={selectedId}
          onSelect={onSelect}
          resetKey={resetKey}
        />
      )}
    </div>
  )
}
