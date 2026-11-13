import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Check, Copy, ExternalLink, Search, Terminal } from 'lucide-react'
import {
  Button,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Dialog,
  DialogContent,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { IconAction } from '@/components/IconAction'
import { SearchInput } from '@/components/SearchInput'
import { useStickyHeaderOffset } from '@/hooks/usePageScroll'
import { useTerminal } from '@/lib/terminalContext'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import {
  COMMON_TABLES,
  tableText,
  type CommonTableRow,
  type CommonTableSection,
  type SeedTable,
} from '@/lib/commonTables'
import { LinkTable } from '@/components/tables/LinkTable'
import { ModifierTable } from '@/components/tables/ModifierTable'
import { useI18n } from '@/lib/i18n'
import { DATA_ROW_CLASS, dataRowStripe } from '@/lib/tableRowStyles'
import { consumeTablesView, useTablesViewRequest, type TablesView } from '@/lib/tablesView'
import { useSearchIntent } from '@/lib/searchIntent'
import type { Dataset, TabId } from '@/types'
import { CommandTipsPage } from './CommandTipsPage'

const BASE = import.meta.env.BASE_URL

/**
 * 常用表格：指令小抄 + 游戏资料里的几张表（只读，不发请求、不执行指令）。
 *
 * 表格数据在 `lib/commonTables.ts`；加新表只改那个数组。
 * 行样式与「指令小抄」共用 `lib/tableRowStyles`，两张表手感一致。
 * 单元格一律单行截断，完整信息在**点击行弹出的浮层**里（浮层跟着鼠标位置走，点同一条收起）。
 */
export function TablesPage({
  dataset,
  onNavigate,
}: {
  dataset: Dataset
  onNavigate?: (tab: TabId) => void
}) {
  const { t, lang } = useI18n()
  const [view, setView] = useState<TablesView>(() => consumeTablesView() ?? 'tips')
  // 全局搜索选中某条指令：切到「指令小抄」并把词带过去（换 key 重挂，页面从干净状态开始）。
  const [tipQuery, setTipQuery] = useState('')
  const select = useCallback((next: TablesView) => setView(next), [])

  useTablesViewRequest(select)
  useSearchIntent(
    'tables',
    useCallback((intent) => {
      if (intent.query == null) return
      setTipQuery(intent.query)
      setView('tips')
    }, []),
  )

  const table = COMMON_TABLES.find((item) => item.id === view)
  // wiki 入口跟搜索框同一行、紧挨分组按钮的左边。
  const wikiLink = table ? (
    <Button variant="secondary" size="sm" asChild>
      <a href={tableText(table.wiki, lang)} target="_blank" rel="noreferrer noopener">
        <ExternalLink />
        {t('dex.wiki')}
      </a>
    </Button>
  ) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Tabs value={view} onValueChange={setView} className="min-w-0 gap-0">
          <TabsList
            variant="line"
            aria-label={t('nav.tables')}
            className="max-w-full justify-start overflow-x-auto"
          >
            <TabsTrigger value="tips" className="flex-none">
              {t('tables.tab.commands')}
            </TabsTrigger>
            {COMMON_TABLES.map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="flex-none">
                {tableText(item.name, lang)}
              </TabsTrigger>
            ))}
            <TabsTrigger value="links" className="flex-none">
              {t('tables.links')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === 'links' ? (
        <LinkTable />
      ) : view === 'tips' || !table ? (
        <CommandTipsPage
          key={`tips:${tipQuery}`}
          dataset={dataset}
          onNavigate={onNavigate}
          searchQuery={tipQuery}
        />
      ) : table.kind === 'modifiers' ? (
        <ModifierTable table={table} prefixesById={dataset.prefixesById} wikiLink={wikiLink} />
      ) : (
        <SeedDataTable table={table} wikiLink={wikiLink} />
      )}
    </div>
  )
}

/** 一张资料表：分类分隔行 + 斑马纹数据行 + 点击行浮层。 */
function SeedDataTable({ table, wikiLink }: { table: SeedTable; wikiLink?: ReactNode }) {
  const { t, lang } = useI18n()
  const [copied, setCopied] = useState<string | null>(null)
  const [detail, setDetail] = useState<CommonTableRow | null>(null)
  const [query, setQuery] = useState('')
  // 搜索条吸顶在顶栏下方，表头再吸在它下面（高度实测，避免写死偏移）。
  const toolbarRef = useRef<HTMLDivElement>(null)
  const stickyTop = useStickyHeaderOffset(toolbarRef)

  const { open: openTerminal } = useTerminal()

  const copyCode = (code: string) => {
    void copyText(code).then((ok) => {
      if (!ok) return
      setCopied(code)
      window.setTimeout(() => setCopied((current) => (current === code ? null : current)), 1200)
    })
  }


  // 搜索：名称 / 内部名称 / 种子代码 / 描述，大小写不敏感；分类没有命中行就不显示标题。
  const q = query.trim().toLowerCase()
  const sections = q
    ? table.sections
        .map((section) => ({
          ...section,
          rows: section.rows.filter((row) =>
            `${tableText(row.name, lang)} ${row.internal} ${row.codes.join(' ')} ${tableText(row.desc, lang)}`
              .toLowerCase()
              .includes(q),
          ),
        }))
        .filter((section) => section.rows.length > 0)
    : table.sections
  const total = sections.reduce((sum, section) => sum + section.rows.length, 0)

  const rowProps = (row: CommonTableRow) => ({
    onClick: () => setDetail(row),
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      setDetail(row)
    },
  })

  return (
    <>
      <div
        ref={toolbarRef}
        className="sticky top-12 z-20 flex items-center gap-2 bg-background py-1.5"
      >
        <div className="w-full max-w-sm min-w-0">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('tables.search.placeholder')}
            aria-label={t('tables.search.placeholder')}
            leadingIcon={<Search className="size-4 text-muted-foreground" />}
            shortcut
          />
        </div>
        {wikiLink && <div className="ml-auto flex shrink-0 items-center gap-2">{wikiLink}</div>}
      </div>

      {total === 0 ? (
        <Empty className="min-h-40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>{t('tables.search.empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
      <>
      {/* 外框 + 圆角：`overflow-clip` 不是滚动容器，表头吸顶照旧生效。 */}
      <div className="min-w-0 overflow-clip rounded-container border border-border/60">
        {/* 列宽写在表头单元格上（`table-fixed` 用第一行的宽度定列）：
            桌面 名称 / 内部名称 / 种子 各 13rem、描述吃剩余；<md 隐藏「内部名称」列，免得挤到没法读 */}
        <table className="w-full table-fixed border-collapse text-left">
          <thead
            className="sticky z-10 bg-background"
            style={{ top: stickyTop }}
          >
            {/* 表头带底色：`thead` 本身吸顶要不透明，所以底色挂在行上（叠在 bg-background 上）。 */}
            <tr className="divide-x divide-border/60 border-b border-border/60 bg-muted/50 text-2xs font-semibold text-muted-foreground">
              <th scope="col" className="w-[34%] truncate px-2 py-2 font-semibold md:w-[13rem]">
                {t('tables.column.name')}
              </th>
              {/* 小屏压成 0 宽并裁掉文字：分类分隔行的 colSpan 固定为 4，列数不能变 */}
              <th
                scope="col"
                className="w-0 overflow-hidden px-0 py-2 font-semibold whitespace-nowrap md:w-[13rem] md:px-2"
              >
                <span className="hidden md:inline">{t('tables.column.internal')}</span>
              </th>
              <th scope="col" className="w-[34%] truncate px-2 py-2 font-semibold md:w-[13rem]">
                {t('tables.column.seed')}
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                {t('tables.column.desc')}
              </th>
            </tr>
          </thead>
          {sections.map((section, sectionIndex) => (
            <tbody key={section.id}>
              {section.name && (
                <tr>
                  <th
                    colSpan={4}
                    scope="rowgroup"
                    className="px-2 pt-4 pb-1 text-left text-2xs font-semibold text-muted-foreground"
                  >
                    {tableText(section.name, lang)}
                  </th>
                </tr>
              )}
              {section.rows.map((row, index) => (
                <tr
                  key={row.internal}
                  data-row={row.internal}
                  tabIndex={0}
                  {...rowProps(row)}
                  className={cn(
                    DATA_ROW_CLASS,
                    'divide-x divide-border/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ',
                    // 每段最后一行补下边线：行只有 border-t，否则分类末尾和下一个标题之间是空的
                    index === section.rows.length - 1 && 'border-b border-border/40',
                    dataRowStripe(sectionRowStart(sections, sectionIndex) + index),
                  )}
                >
                  <td className="truncate px-2 py-2 text-xs text-foreground">
                    <span className="flex items-center gap-2">
                      {(row.icon ?? table.icon) && (
                        <img
                          src={`${BASE}data/${row.icon ?? table.icon}`}
                          alt=""
                          className="h-4 w-auto shrink-0 [image-rendering:pixelated]"
                        />
                      )}
                      {tableText(row.name, lang)}
                    </span>
                  </td>
                  <td className="w-0 overflow-hidden px-0 py-2 text-xs whitespace-nowrap text-muted-foreground md:w-[13rem] md:px-2">
                    <span className="hidden md:inline">{row.internal}</span>
                  </td>
                  <td className="truncate px-2 py-2 font-mono text-xs text-foreground">
                    {row.codes.join(', ')}
                  </td>
                  <td className="truncate px-2 py-2 text-xs text-muted-foreground">
                    {tableText(row.desc, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      </>
      )}

      <Dialog
        open={detail !== null}
        onOpenChange={(next) => {
          if (!next) setDetail(null)
        }}
      >
        <DialogContent data-testid="table-row-detail" radius="container" className="max-w-md">
          {detail && (
            <div className="flex max-h-[min(28rem,70dvh)] flex-col gap-2 overflow-y-auto overscroll-contain">
              <div className="flex items-center gap-2">
                {(detail.icon ?? table.icon) && (
                  <img
                    src={`${BASE}data/${detail.icon ?? table.icon}`}
                    alt=""
                    className="h-8 w-auto shrink-0 [image-rendering:pixelated]"
                  />
                )}
                <span className="text-sm font-semibold">{tableText(detail.name, lang)}</span>
              </div>
              <p className="font-mono text-2xs text-muted-foreground">{detail.internal}</p>
              <div className="flex flex-wrap items-center gap-1">
                {detail.codes.map((code) => (
                  <CodeChip key={code} code={code} copied={copied === code} onCopy={copyCode} />
                ))}
              </div>
              {detail.wm && (
                <div className="flex items-center gap-1.5">
                  <span className="text-2xs text-muted-foreground">{t('tables.wm.label')}</span>
                  <CodeChip
                    code={`/wm s ${detail.wm}`}
                    copied={copied === `/wm s ${detail.wm}`}
                    onCopy={copyCode}
                    actions={
                      <IconAction
                        size="icon-xs"
                        label={t('tables.wm.fill')}
                        icon={Terminal}
                        iconClassName="size-3.5"
                        onClick={() => {
                          openTerminal(`/wm s ${detail.wm}`)
                          // 填完就关掉弹框：终端在右下角浮出来，不被遮罩挡住
                          setDetail(null)
                        }}
                      />
                    }
                  />
                </div>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {tableText(detail.desc, lang)}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 某个分类在全表里的起始行号（分类分隔行不占号，斑马纹跨 tbody 连续）。 */
function sectionRowStart(sections: CommonTableSection[], index: number): number {
  return sections.slice(0, index).reduce((sum, section) => sum + section.rows.length, 0)
}

/**
 * 浮层里的代码块（带底色，和正文区分开）。
 *
 * `actions` 渲染在复制键**左边紧挨着**（如「相关指令」的填入终端键）；
 * 容器本身不是按钮，避免按钮套按钮——复制键单独可点。
 */
function CodeChip({
  code,
  copied,
  onCopy,
  actions,
}: {
  code: string
  copied: boolean
  onCopy: (code: string) => void
  actions?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-control bg-muted/60 px-2 py-0.5 font-mono text-xs whitespace-nowrap text-foreground',
        'hover:bg-muted',
      )}
    >
      {code}
      {actions}
      <button
        type="button"
        title={t('tables.copySeed')}
        aria-label={t('tables.copySeedWith', { seed: code })}
        onClick={(event) => {
          // 复制不打开行浮层
          event.stopPropagation()
          onCopy(code)
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className="shrink-0 cursor-pointer rounded-control text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring "
      >
        {copied ? (
          <Check className="size-3 text-primary" />
        ) : (
          <Copy className="size-3 opacity-60 group-hover:opacity-100" />
        )}
      </button>
    </span>
  )
}
