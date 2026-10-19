import { ItemIcon } from '@/components/ItemIcon'
import { NpcSprite } from '@/components/NpcSprite'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { CodexKind } from '@/lib/codexState'
import { useI18n } from '@/lib/i18n'
import type { Atlas, Item, Npc, TileWallEntry } from '@/types'

/**
 * 数据图鉴的**只读视图组件**（从 `CodexPage` 抽出，见 docs/TODO.md U6）。
 * 纯展示：不持有页面状态，数据与回调由 `CodexPage` 注入。
 */

const CELL_CLASS =
  'flex cursor-pointer flex-col items-center gap-1 rounded-xl px-1 py-2 text-center transition'
const CELL_HOVER =
  'hover:-translate-y-0.5 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function NpcCell({
  npc,
  size,
  selected,
  onSelect,
}: {
  npc: Npc
  /** 贴图绘制区边长（64 / Boss 128）。 */
  size: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${npc.name} #${npc.id}`}
      className={cn(CELL_CLASS, CELL_HOVER, selected && 'bg-primary/20')}
    >
      <NpcSprite id={npc.id} size={size} name={npc.name} />
      <span className="font-pixel text-2xs leading-none text-muted-foreground">{npc.id}</span>
      <span className="w-full truncate text-xs leading-4 text-foreground">{npc.name}</span>
    </button>
  )
}

/** 图格尺寸标签：1×1（或无尺寸）不显示；多格才显示 `W×H`（如 1×2 / 2×2）。 */
function tileSizeLabel(entry: TileWallEntry): string {
  const s = entry.size
  if (!s) return ''
  const [w, h] = s
  return w === 1 && h === 1 ? '' : `${w}×${h}`
}

/** 图格 / 墙：用表格展示（图标 / ID / 名称 / 内部名，图格另有尺寸列）。列少，大屏排成左右两张表。 */
export function DataTableLayout({
  rows,
  kind,
  twoCols,
  nameOf,
  itemOf,
  atlas,
  onSelect,
}: {
  rows: TileWallEntry[]
  kind: CodexKind
  /** 是否允许排成两列（右上角 checkbox，默认开）。 */
  twoCols: boolean
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  onSelect: (entry: TileWallEntry) => void
}) {
  // 开启两列且行数够多时，在 xl 排成左右两张表（页面短一半，读起来也舒服）；行少就一张表。
  const split = twoCols && rows.length > 8
  const half = split ? Math.ceil(rows.length / 2) : rows.length
  const left = rows.slice(0, half)
  const right = split ? rows.slice(half) : []
  return (
    <div className={cn('grid gap-x-6 gap-y-3', split && 'xl:grid-cols-2')}>
      <DataTable
        rows={left}
        kind={kind}
        nameOf={nameOf}
        itemOf={itemOf}
        atlas={atlas}
        onSelect={onSelect}
      />
      {right.length > 0 && (
        <DataTable
          rows={right}
          kind={kind}
          nameOf={nameOf}
          itemOf={itemOf}
          atlas={atlas}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}

/** 单张表：图标 + ID + 名称 + 尺寸（图格）+ 内部名；斑马纹 + hover + 行可点（打开详情）；表头吸顶。 */
function DataTable({
  rows,
  kind,
  nameOf,
  itemOf,
  atlas,
  onSelect,
}: {
  rows: TileWallEntry[]
  kind: CodexKind
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  onSelect: (entry: TileWallEntry) => void
}) {
  const { t } = useI18n()
  const isTile = kind === 'tile'
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          {isTile && <col className="w-12" />}
          <col />
        </colgroup>
        {/* 表头不铺白底：用页面背景色（半透明 + 模糊），吸顶时也不会看到下面的行糊在一起 */}
        <thead className="sticky top-0 z-10 bg-background/90 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-right font-medium">{isTile ? 'TileID' : 'WallID'}</th>
            <th className="px-1 py-2 text-center font-medium">{t('codex.table.icon')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('codex.table.name')}</th>
            {isTile && (
              <th className="px-2 py-2 text-center font-medium">{t('codex.table.size')}</th>
            )}
            <th className="px-3 py-2 text-left font-medium">{t('codex.table.key')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const name = nameOf(entry)
            const item = itemOf(entry)
            // 没有代表物品（名称就是内部名）→ 用等宽 + 弱色 + 斜体区分。
            const fallback = entry.item == null
            return (
              <tr
                key={entry.id}
                title={`${name} #${entry.id}`}
                tabIndex={0}
                onClick={() => onSelect(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(entry)
                  }
                }}
                className={cn(
                  'cursor-pointer border-t border-border/50 transition-colors',
                  // 斑马纹（奇数行浅底）+ hover / 键盘聚焦
                  'odd:bg-muted/25 hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none',
                )}
              >
                <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">
                  {entry.id}
                </td>
                <td className="px-1 py-0.5">
                  <span className="flex items-center justify-center">
                    {item ? (
                      <ItemIcon item={item} atlas={atlas} size={24} name={name} tooltip={false} />
                    ) : (
                      <span className="inline-block size-5 rounded bg-muted/60" aria-hidden />
                    )}
                  </span>
                </td>
                <td
                  className={cn(
                    'truncate px-3 py-1.5',
                    fallback ? 'font-mono text-muted-foreground italic' : 'text-foreground',
                  )}
                  title={name}
                >
                  {name}
                </td>
                {isTile && (
                  <td className="px-2 py-1.5 text-center font-mono text-xs text-muted-foreground">
                    {tileSizeLabel(entry) && (
                      <span className="inline-block rounded bg-accent/60 px-1.5 py-0.5 text-2xs">
                        {tileSizeLabel(entry)}
                      </span>
                    )}
                  </td>
                )}
                <td
                  className="truncate px-3 py-1.5 font-mono text-xs text-muted-foreground"
                  title={entry.key}
                >
                  {entry.key}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  title,
}: {
  label: string
  value: string
  mono?: boolean
  title?: string
}) {
  return (
    <div className="grid w-full grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn('truncate text-right text-foreground', mono && 'font-mono')}
        title={title ?? value}
      >
        {value}
      </span>
    </div>
  )
}

export function NpcDetail({ npc }: { npc: Npc }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex size-40 items-center justify-center rounded-xl bg-accent/60">
        {/* 详情大图用 fit：小动物（如 10×16 的萤火虫）在 game 模式下会只有十像素，看不见 */}
        <NpcSprite id={npc.id} size={144} name={npc.name} mode="fit" />
      </div>
      <div className="text-center">
        <div className="text-base font-semibold text-foreground">{npc.name}</div>
        <div className="font-pixel text-xs text-muted-foreground">#{npc.id}</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {npc.sb && <Badge tone="mock">{t('npcs.badge.boss')}</Badge>}
        {npc.sbAll && <Badge tone="purple">/sb all</Badge>}
      </div>
      <DetailRow label={t('codex.field.internal')} value={npc.key} mono />
    </div>
  )
}

export function DataDetail({
  entry,
  kind,
  item,
  atlas,
}: {
  entry: TileWallEntry
  kind: CodexKind
  item: Item | undefined
  atlas: Atlas | undefined
}) {
  const { t } = useI18n()
  const name = item?.name ?? entry.key
  const fallback = !item
  const size = entry.size ?? [1, 1]
  const multi = size[0] > 1 || size[1] > 1
  const sizeLabel = entry.size
    ? `${size[0]}×${size[1]}`
    : entry.frameImportant
      ? t('codex.size.variable')
      : '1×1'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-40 items-center justify-center rounded-xl bg-accent/60">
          {item ? (
            <ItemIcon item={item} atlas={atlas} size={96} name={name} tooltip={false} />
          ) : (
            <span className="inline-block size-24 rounded bg-muted/60" aria-hidden />
          )}
        </div>
        <div className="text-center">
          <div
            className={cn(
              'text-base font-semibold',
              fallback ? 'font-mono text-muted-foreground italic' : 'text-foreground',
            )}
          >
            {name}
          </div>
          <div className="font-pixel text-xs text-muted-foreground">
            {kind === 'wall' ? 'WallID' : 'TileID'} #{entry.id}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <Badge tone="neutral">
            {kind === 'wall' ? t('codex.tab.wall') : t('codex.tab.tile')}
          </Badge>
          {kind === 'tile' && multi && <Badge tone="accent">{t('tiles.badge.multi')}</Badge>}
          {kind === 'tile' && !entry.size && entry.frameImportant && (
            <Badge tone="warn">{t('codex.size.variable')}</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <DetailRow label={t('codex.field.internal')} value={entry.key} mono />
        <div className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 text-xs">
          <span className="text-muted-foreground">{t('codex.field.item')}</span>
          {item ? (
            <span className="flex min-w-0 items-center justify-end gap-1.5">
              {/* 带悬停提示（游戏同款物品提示） */}
              <ItemIcon item={item} atlas={atlas} size={20} name={item.name} />
              <span className="truncate text-foreground">
                {item.name} #{item.id}
              </span>
            </span>
          ) : (
            <span className="text-right text-muted-foreground">—</span>
          )}
        </div>
        {kind === 'tile' && (
          <DetailRow
            label={t('codex.field.size')}
            value={sizeLabel}
            title={
              entry.size
                ? multi
                  ? t('tiles.badge.multi')
                  : undefined
                : entry.frameImportant
                  ? t('tiles.size.variable')
                  : undefined
            }
          />
        )}
      </div>

      <ul className="flex list-disc flex-col gap-1 rounded-lg bg-muted/40 py-2.5 pr-3 pl-7 text-2xs leading-relaxed text-muted-foreground">
        <li>{t('tiles.note.name')}</li>
        <li>{t('tiles.note.size')}</li>
        <li>{t('tiles.note.version')}</li>
      </ul>
    </div>
  )
}
