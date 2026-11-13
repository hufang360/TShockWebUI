import { ExternalLink } from 'lucide-react'
import { tableText } from '@/lib/commonTables'
import { LINK_GROUPS } from '@/lib/links'
import { useI18n } from '@/lib/i18n'
import { dataRowStripe } from '@/lib/tableRowStyles'
import { cn } from '@/lib/cn'

/** 给每个分组记下它在全表里的起始行号（斑马纹跨 tbody 连续）。 */
function withRowOffsets(
  groups: typeof LINK_GROUPS,
): Array<{ group: (typeof LINK_GROUPS)[number]; start: number }> {
  return groups.reduce<Array<{ group: (typeof LINK_GROUPS)[number]; start: number }>>(
    (acc, group) => {
      const previous = acc.at(-1)
      acc.push({ group, start: previous ? previous.start + previous.group.links.length : 0 })
      return acc
    },
    [],
  )
}

/**
 * 常用链接：和「世界种子」同一套表格样式（分组分隔行 + 斑马纹 + 列间竖线）。
 *
 * 纯静态数据（`lib/links.ts`）；中文界面打开中文 wiki 条目，英文界面打开英文站点。
 * 地址列显示可读文本（中文条目名就是中文），点击名称或地址都在新窗口打开。
 */
export function LinkTable() {
  const { t, lang } = useI18n()

  return (
    <div className="min-w-0 overflow-clip rounded-container border border-border/60">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-12 z-10 bg-background">
          <tr className="divide-x divide-border/60 border-b border-border/60 bg-muted/50 text-2xs font-semibold text-muted-foreground">
            <th scope="col" className="w-[16rem] px-2 py-2 font-medium">
              {t('tables.column.name')}
            </th>
            <th scope="col" className="w-full max-w-0 px-2 py-2 font-medium">
              {t('tables.column.url')}
            </th>
          </tr>
        </thead>
        {withRowOffsets(LINK_GROUPS).map(({ group, start }) => {
          return (
            <tbody key={group.id}>
              <tr>
                <th
                  colSpan={2}
                  scope="rowgroup"
                  className="px-2 pt-4 pb-1 text-left text-2xs font-semibold text-muted-foreground"
                >
                  {tableText(group.name, lang)}
                </th>
              </tr>
              {group.links.map((link, index) => {
                const href = tableText(link.href, lang)
                return (
                  <tr
                    key={link.id}
                    className={cn(
                      'divide-x divide-border/60 border-t border-border/40 align-top transition-colors hover:bg-accent/25',
                      // 每段最后一行补下边线（行只有 border-t）
                      index === group.links.length - 1 && 'border-b border-border/40',
                      dataRowStripe(start + index),
                    )}
                  >
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                      {/* 名称即超链接（下划线在悬停 / 聚焦时出现） */}
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring "
                      >
                        {tableText(link.label, lang)}
                      </a>
                    </td>
                    <td className="w-full max-w-0 px-2 py-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="min-w-0 truncate font-mono text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {href}
                        </a>
                        <button
                          type="button"
                          title={t('tables.open')}
                          aria-label={t('tables.open')}
                          onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
                          className="shrink-0 cursor-pointer rounded-control text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring "
                        >
                          <ExternalLink className="size-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}
