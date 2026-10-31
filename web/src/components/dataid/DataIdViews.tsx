import { BuffIcon } from '@/components/BuffIcon'
import { CommandLine } from '@/components/CommandLine'
import { ItemIcon } from '@/components/ItemIcon'
import { NpcSprite } from '@/components/NpcSprite'
import { Eye } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { DataIdKind } from '@/lib/dataIdState'
import { useI18n } from '@/lib/i18n'
import { gbuffCommand } from '@/lib/commandFormat'
import { spawnBossCommand, spawnMobCommand } from '@/lib/spawnTips'
import type { Atlas, Buff, Item, Npc, TileWallEntry } from '@/types'

/**
 * 数据ID的**只读视图组件**（从 `DataIdPage` 抽出，见 docs/TODO.md U6）。
 * 纯展示：不持有页面状态，数据与回调由 `DataIdPage` 注入。
 */

/** 图标网格：宽度固定 72，间距固定（列 8px / 行 16px）。 */
const ICON_GRID =
  'grid grid-cols-[repeat(auto-fill,4.5rem)] gap-x-2 gap-y-4 md:gap-x-4'

/**
 * 格子固定 72 宽（= 图标区宽度），ID / 名称都在这个宽度内截断。
 * hover 时**整格**（图标 + 文字）一起上浮，只有 72×72 的图标区在 hover 时才出现底色。
 */
const CELL_CLASS =
  'group/cell flex w-18 cursor-pointer flex-col items-center gap-1 rounded-container text-center transition'
const CELL_HOVER =
  'hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
/** 图标区：默认**无底色**、无描边，72×72；hover 时才铺 `bg-primary/10`。 */
const ICON_CELL_BG =
  'flex size-18 items-center justify-center rounded-control transition-colors group-hover/cell:bg-primary/10'

export function NpcCell({
  npc,
  size,
  large = false,
  hideMeta = false,
  onSelect,
}: {
  npc: Npc
  /** 贴图绘制区边长（64 / Boss 128）。 */
  size: number
  /** Boss 分类：格子 / 图标区各放大一倍（144 / 128）。 */
  large?: boolean
  /** 页面设置里「隐藏 ID 和名称」：只留图标。 */
  hideMeta?: boolean
  onSelect: (npc: Npc) => void
}) {
  return (
    <button
      type="button"
      title={`${npc.name} #${npc.id}`}
      onClick={() => onSelect(npc)}
      className={cn(CELL_CLASS, CELL_HOVER, large ? 'w-36' : 'w-18')}
    >
      <span className={cn(ICON_CELL_BG, large ? 'size-36' : 'size-18')}>
        <NpcSprite id={npc.id} size={size} name={npc.name} />
      </span>
      {!hideMeta && (
        <>
          <span className="w-full truncate font-pixel text-2xs leading-none text-muted-foreground">
            {npc.id}
          </span>
          <span className="w-full truncate text-xs leading-4 text-foreground">{npc.name}</span>
        </>
      )}
    </button>
  )
}

/** NPC 表格视图：贴图 / ID / 名称 / 内部名；点行开 Popover。 */
export function NpcTableLayout({ rows, onSelect }: { rows: Npc[]; onSelect: (npc: Npc) => void }) {
  const { t } = useI18n()
  return (
    <div className="overflow-hidden rounded-control border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          <col />
          <col className="w-9" />
        </colgroup>
        <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-right font-medium">NPCID</th>
            <th className="px-1 py-2 text-center font-medium">{t('dataId.table.icon')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.name')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.key')}</th>
            <th className="w-9 px-1 py-2"><span className="sr-only">{t('dataId.detail')}</span></th>
            <th className="w-9 px-1 py-2"><span className="sr-only">{t('dataId.detail.buff')}</span></th>
            <th className="w-9 px-1 py-2"><span className="sr-only">{t('dataId.detail.npc')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((npc) => (
            <tr
              key={npc.id}
              title={`${npc.name} #${npc.id}`}
              tabIndex={0}
              className="group/row border-t border-border/50 transition-colors odd:bg-muted/25 hover:bg-primary/10"
            >
              <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                {npc.id}
              </td>
              <td className="px-1 py-0.5">
                <span className="inline-flex items-center justify-center">
                  <NpcSprite id={npc.id} size={24} name={npc.name} />
                </span>
              </td>
              <td className="truncate px-3 py-2 text-foreground" title={npc.name}>
                {npc.name}
              </td>
              <td
                className="truncate px-3 py-2 font-mono text-xs text-muted-foreground"
                title={npc.key}
              >
                {npc.key}
              </td>
              <td className="px-1 py-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('dataId.detail.npc')}
                  onClick={() => onSelect(npc)}
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

/** 行数够多时把列表对半分（图格 / 墙 / Buff 共用；「两列表格」开关关闭时不分）。 */
function splitRows<T>(rows: T[], twoCols: boolean): [T[], T[]] {
  const split = twoCols && rows.length > 8
  const half = split ? Math.ceil(rows.length / 2) : rows.length
  return [rows.slice(0, half), split ? rows.slice(half) : []]
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
  kind: DataIdKind
  /** 是否允许排成两列（在**表格上面一行**的 checkbox，默认开）。 */
  twoCols: boolean
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  onSelect: (entry: TileWallEntry) => void
}) {
  // 开启两列且行数够多时，在 xl 排成左右两张表（页面短一半，读起来也舒服）；行少就一张表。
  const [left, right] = splitRows(rows, twoCols)
  return (
    <div className={cn('grid gap-x-6 gap-y-3', right.length > 0 && 'xl:grid-cols-2')}>
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

/** Buff 速查表：ID / 图标 / 名称 / 内部名（图标来自 `data/buff-atlas.png`）。行多时同图格一样可排两列。 */
export function BuffTableLayout({
  rows,
  twoCols,
  onSelect,
}: {
  rows: Buff[]
  /** 是否允许排成两列（与图格 / 墙共用同一个 checkbox）。 */
  twoCols: boolean
  onSelect: (buff: Buff) => void
}) {
  const [left, right] = splitRows(rows, twoCols)
  return (
    <div className={cn('grid gap-x-6 gap-y-3', right.length > 0 && 'xl:grid-cols-2')}>
      <BuffTable rows={left} onSelect={onSelect} />
      {right.length > 0 && <BuffTable rows={right} onSelect={onSelect} />}
    </div>
  )
}

/** Buff 图标网格（默认视图）：图标 + BuffID + 名称；点击开 Popover。 */
export function BuffGrid({
  rows,
  hideMeta = false,
  onSelect,
}: {
  rows: Buff[]
  hideMeta?: boolean
  onSelect: (buff: Buff) => void
}) {
  return (
    <div className={ICON_GRID}>
      {rows.map((buff) => (
        <button
          key={buff.id}
          type="button"
          title={`${buff.name} #${buff.id}`}
          onClick={() => onSelect(buff)}
          className={cn(CELL_CLASS, CELL_HOVER)}
        >
          <span className={ICON_CELL_BG}>
            <BuffIcon id={buff.id} size={64} name={buff.name} />
          </span>
          {!hideMeta && (
            <>
              <span className="w-full truncate font-pixel text-2xs leading-none text-muted-foreground">
                {buff.id}
              </span>
              <span className="w-full truncate text-xs leading-4 text-foreground">{buff.name}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

/** 单张 Buff 表：斑马纹 + hover + 行可点（打开 Popover）；表头吸顶。 */
function BuffTable({ rows, onSelect }: { rows: Buff[]; onSelect: (buff: Buff) => void }) {
  const { t } = useI18n()
  return (
    <div className="overflow-hidden rounded-control border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          <col />
          <col className="w-9" />
        </colgroup>
        {/* 表头不铺白底：用页面背景色（半透明 + 模糊），吸顶时也不会看到下面的行糊在一起 */}
        <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-right font-medium">BuffID</th>
            <th className="px-1 py-2 text-center font-medium">{t('dataId.table.icon')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.name')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.key')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((buff) => (
            <tr
              key={buff.id}
              title={`${buff.name} #${buff.id}`}
              tabIndex={0}
              className="group/row border-t border-border/50 transition-colors odd:bg-muted/25 hover:bg-primary/10"
            >
              <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                {buff.id}
              </td>
              <td className="px-1 py-0.5">
                <span className="inline-flex items-center justify-center">
                  <BuffIcon id={buff.id} size={24} name={buff.name} />
                </span>
              </td>
              <td className="truncate px-3 py-2 text-foreground" title={buff.name}>
                {buff.name}
              </td>
              <td
                className="truncate px-3 py-2 font-mono text-xs text-muted-foreground"
                title={buff.key}
              >
                {buff.key}
              </td>
              <td className="px-1 py-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('dataId.detail.buff')}
                  onClick={() => onSelect(buff)}
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

/** 图格图标网格（默认视图）：代表物品图标 + TileID + 名称；多样式显示计数。点击打开抽屉。 */
export function TileIconGrid({
  rows,
  nameOf,
  itemOf,
  atlas,
  hideMeta = false,
  onSelect,
}: {
  rows: TileWallEntry[]
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  hideMeta?: boolean
  onSelect: (entry: TileWallEntry) => void
}) {
  const { t } = useI18n()
  return (
    <div className={ICON_GRID}>
      {rows.map((entry) => {
        const name = nameOf(entry)
        const item = itemOf(entry)
        const displayId = entry.subId != null ? `${entry.id}-${entry.subId}` : String(entry.id)
        return (
          <button
            key={displayId}
            type="button"
            title={`${name} #${displayId}`}
            onClick={() => onSelect(entry)}
            className={cn(CELL_CLASS, CELL_HOVER)}
          >
            <span className={ICON_CELL_BG}>
              {item ? (
                <ItemIcon item={item} atlas={atlas} size={64} name={name} tooltip={false} />
              ) : (
                <span className="inline-block size-16 rounded bg-muted/60" aria-hidden />
              )}
            </span>
            {!hideMeta && (
              <>
                <span className="w-full truncate font-pixel text-2xs leading-none text-muted-foreground">
                  {displayId}
                </span>
                <span className="w-full truncate text-xs leading-4 text-foreground">{name}</span>
                {entry.subId == null && (entry.styles?.length ?? 0) > 0 && (
                  <span className="max-w-full truncate rounded bg-accent/60 px-2 py-0.5 text-2xs text-muted-foreground">
                    {t('dataId.styles.count', { n: entry.styles!.length })}
                  </span>
                )}
              </>
            )}
          </button>
        )
      })}
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
  kind: DataIdKind
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  onSelect: (entry: TileWallEntry) => void
}) {
  const { t } = useI18n()
  const isTile = kind === 'tile'
  return (
    <div className="overflow-hidden rounded-control border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          {isTile && <col className="w-12" />}
          <col />
          <col className="w-9" />
        </colgroup>
        {/* 表头不铺白底：用页面背景色（半透明 + 模糊），吸顶时也不会看到下面的行糊在一起 */}
        <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-right font-medium">{isTile ? 'TileID' : 'WallID'}</th>
            <th className="px-1 py-2 text-center font-medium">{t('dataId.table.icon')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.name')}</th>
            {isTile && (
              <th className="px-2 py-2 text-center font-medium">{t('dataId.table.size')}</th>
            )}
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.key')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const name = nameOf(entry)
            const item = itemOf(entry)
            const displayId = entry.subId != null ? `${entry.id}-${entry.subId}` : String(entry.id)
            // 没有代表物品（名称就是内部名）→ 用等宽 + 弱色 + 斜体区分。
            const fallback = (entry.subId != null ? entry.styleItem : entry.item) == null
            return (
              <tr
                key={displayId}
                title={`${name} #${displayId}`}
                tabIndex={0}
                className="group/row border-t border-border/50 transition-colors odd:bg-muted/25 hover:bg-primary/10"
              >
                <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                  {displayId}
                </td>
                <td className="px-1 py-0.5">
                  <span className="inline-flex items-center justify-center">
                    {item ? (
                      <ItemIcon item={item} atlas={atlas} size={24} name={name} tooltip={false} />
                    ) : (
                      <span className="inline-block size-5 rounded bg-muted/60" aria-hidden />
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'truncate',
                        fallback ? 'font-mono text-muted-foreground italic' : 'text-foreground',
                      )}
                      title={name}
                    >
                      {name}
                    </span>
                    {isTile && entry.subId == null && (entry.styles?.length ?? 0) > 0 && (
                      <span className="shrink-0 rounded bg-accent/60 px-2 py-0.5 text-2xs text-muted-foreground">
                        {t('dataId.styles.count', { n: entry.styles!.length })}
                      </span>
                    )}
                  </span>
                </td>
                {isTile && (
                  <td className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">
                    {tileSizeLabel(entry) && (
                      <span className="inline-block rounded bg-accent/60 px-2 py-0.5 text-2xs">
                        {tileSizeLabel(entry)}
                      </span>
                    )}
                  </td>
                )}
                <td
                  className="truncate px-3 py-2 font-mono text-xs text-muted-foreground"
                  title={entry.key}
                >
                  {entry.key}
                </td>
                <td className="px-1 py-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('dataId.detail')}
                    onClick={() => onSelect(entry)}
                    className="opacity-100 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100"
                  >
                    <Eye />
                  </Button>
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

/**
 * 一条只读指令：左 = 属性 / 命令名，右 = 指令原文，末尾复制按钮。
 * 与「内部名」那行同一套左右布局。
 */
/** Boss 的单字简写（优先 `sbAliases` 里不等于全名的项，其次取全名第一个词）。 */
function bossShortAlias(npc: Npc): string | null {
  if (!npc.sb) return null
  const alias = npc.sbAliases?.find((a) => a && a !== npc.sb)
  const short = alias ?? npc.sb.split(/\s+/)[0]
  return short && short !== npc.sb ? short : null
}

export function NpcDetail({ npc, large = false }: { npc: Npc; large?: boolean }) {
  const { t } = useI18n()
  // 召唤指令**不按权限隐藏**：玩家照常能看到 / 复制（能不能执行由 TShock 判定，
  // 与「小抄」页一致：不把权限当展示门槛）。
  const shortAlias = bossShortAlias(npc)
  const bossCommands = npc.sb
    ? [spawnBossCommand(npc.sb), shortAlias ? `/sb ${shortAlias}` : null].filter(
        (c): c is string => c !== null,
      )
    : []
  return (
    <div className={cn('flex flex-col gap-2', large && 'gap-4')}>
      <div className={cn(large ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3')}>
        <NpcSprite
          id={npc.id}
          size={large ? 128 : 32}
          name={npc.name}
          mode={large ? 'fit' : 'game'}
        />
        <div className={cn('min-w-0', large && 'text-center')}>
          <div className={cn('truncate font-semibold text-foreground', large ? 'text-base' : 'text-sm')}>
            {npc.name}
          </div>
          <div className="font-pixel text-xs text-muted-foreground">NPCID #{npc.id}</div>
        </div>
      </div>
      <DetailRow label={t('dataId.field.internal')} value={npc.key} mono />
      {/* 召唤指令：Boss 的完整写法与单字简写合并成一块（一行一条），下面再一条 NPC 召唤。 */}
      <div className="flex flex-col gap-2">
        {bossCommands.length > 0 && (
          <CommandLine label={t('dataId.cmd.spawnboss')} commands={bossCommands} />
        )}
        <CommandLine label={t('dataId.cmd.spawnmob')} commands={[spawnMobCommand(npc.id)]} />
      </div>
    </div>
  )
}

export function DataDetail({
  entry,
  kind,
  item,
  atlas,
  itemsById,
}: {
  entry: TileWallEntry
  kind: DataIdKind
  item: Item | undefined
  atlas: Atlas | undefined
  /** 子 ID 列表里解析各样式代表物品用。 */
  itemsById?: Map<number, Item>
}) {
  const { t } = useI18n()
  const name = item?.name ?? entry.key
  const fallback = !item
  const size = entry.size ?? [1, 1]
  const multi = size[0] > 1 || size[1] > 1
  const sizeLabel = entry.size
    ? `${size[0]}×${size[1]}`
    : entry.frameImportant
      ? t('dataId.size.variable')
      : '1×1'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-40 items-center justify-center rounded-container bg-accent">
          {item ? (
            <ItemIcon item={item} atlas={atlas} size={64} name={name} tooltip={false} />
          ) : (
            <span className="inline-block size-16 rounded bg-muted/60" aria-hidden />
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
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge tone="neutral">
            {kind === 'wall' ? t('dataId.tab.wall') : t('dataId.tab.tile')}
          </Badge>
          {kind === 'tile' && multi && <Badge tone="accent">{t('tiles.badge.multi')}</Badge>}
          {kind === 'tile' && !entry.size && entry.frameImportant && (
            <Badge tone="warn">{t('dataId.size.variable')}</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <DetailRow label={t('dataId.field.internal')} value={entry.key} mono />
        <div className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 text-xs">
          <span className="text-muted-foreground">{t('dataId.field.item')}</span>
          {item ? (
            <span className="flex min-w-0 items-center justify-end gap-2">
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
            label={t('dataId.field.size')}
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

      {kind === 'tile' && (entry.styles?.length ?? 0) > 0 && (
        <div data-testid="dataid-styles" className="flex flex-col gap-1">
          <div className="text-xs text-muted-foreground">
            {t('dataId.styles.title')}（{entry.styles!.length}）
          </div>
          <div className="grid grid-cols-2 gap-1">
            {entry.styles!.map((s) => {
              const styleItem = s.item != null ? itemsById?.get(s.item) : undefined
              return (
                <div
                  key={s.subId}
                  className="flex min-w-0 items-center gap-2 rounded-control border border-border/60 px-2 py-1"
                >
                  {styleItem ? (
                    <ItemIcon item={styleItem} atlas={atlas} size={20} tooltip={false} />
                  ) : null}
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                    {entry.id}-{s.subId}
                  </span>
                  <span className="truncate text-xs text-foreground">
                    {styleItem?.name ?? t('dataId.styles.fallback', { n: s.subId })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function BuffDetail({
  buff,
  large = false,
  gbuffPlayer = null,
}: {
  buff: Buff
  large?: boolean
  /**
   * 有 `tshock.buff.others` 时传当前玩家名 → 显示 `/gbuff <玩家> <buffID>`；
   * 未登录 / 无权限传 null（不显示）。
   */
  gbuffPlayer?: string | null
}) {
  const { t } = useI18n()
  return (
    <div className={cn('flex flex-col gap-2', large && 'gap-4')}>
      <div className={cn(large ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3')}>
        <BuffIcon id={buff.id} size={large ? 128 : 32} name={buff.name} />
        <div className={cn('min-w-0', large && 'text-center')}>
          <div className={cn('truncate font-semibold text-foreground', large ? 'text-base' : 'text-sm')}>
            {buff.name}
          </div>
          <div className="font-pixel text-xs text-muted-foreground">BuffID #{buff.id}</div>
        </div>
      </div>
      <DetailRow label={t('dataId.field.internal')} value={buff.key} mono />
      {gbuffPlayer && (
        <CommandLine
          label={t('dataId.cmd.gbuff')}
          commands={[gbuffCommand(gbuffPlayer, buff.id)]}
        />
      )}
    </div>
  )
}
