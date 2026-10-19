import {
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Separator,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { PAGE_SIZES, paginationRange } from '@/lib/pagination'

interface DexPaginationProps {
  /** 当前筛选后的总件数。 */
  total: number
  gameVersion: string
  itemCount: number
  page: number
  pageCount: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}

/**
 * 物品图鉴底部翻页器（从 `ItemsPage` 抽出，见 docs/TODO.md U6）：
 * 件数 + 数据版本 + 每页数量 + shadcn `Pagination`。
 */
export function DexPagination({
  total,
  gameVersion,
  itemCount,
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
}: DexPaginationProps) {
  const { t } = useI18n()
  return (
    <div
      data-testid="dex-pager"
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{t('dex.summary', { n: total })}</span>
        <Separator orientation="vertical" className="h-3.5" />
        <span>{t('dex.version', { version: gameVersion, count: itemCount })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor="dex-page-size" className="font-normal text-muted-foreground">
            {t('dex.pageSize')}
          </FieldLabel>
          <NativeSelect
            id="dex-page-size"
            size="sm"
            className="w-20"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <NativeSelectOption key={size} value={size}>
                {size}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <span className="sr-only" aria-live="polite">
          {t('dex.page', { page, pages: pageCount })}
        </span>
        <Pagination aria-label={t('dex.pagination')} className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                aria-label={t('dex.prev')}
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
              />
            </PaginationItem>
            {paginationRange(page, pageCount).map((p, index) =>
              p === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === page}
                    aria-label={t('dex.goToPage', { page: p })}
                    onClick={() => onPage(p)}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                aria-label={t('dex.next')}
                disabled={page >= pageCount}
                onClick={() => onPage(page + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
