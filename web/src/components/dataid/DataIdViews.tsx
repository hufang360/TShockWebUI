import { BuffIcon } from '@/components/BuffIcon'
import { CommandLine } from '@/components/CommandLine'
import { ItemIcon } from '@/components/ItemIcon'
import { NpcSprite } from '@/components/NpcSprite'
import { Badge } from '@/components/ui'
import { RowTip } from '@/components/RowTip'
import { cn } from '@/lib/cn'
import type { DataIdKind } from '@/lib/dataIdState'
import {
  DEFAULT_ICON_GRID_SIZE,
  iconPlateClass,
  ROW_PLATE_CLASS,
  type IconGridSize,
} from '@/lib/iconGridSize'
import { useI18n } from '@/lib/i18n'
import { gbuffCommand } from '@/lib/commandFormat'
import { useDataset } from '@/lib/datasetContext'
import { npcRelatedCommands } from '@/lib/npcRelatedCommands'
import { selectableRow } from '@/lib/rowSelect'
import type { CSSProperties } from 'react'
import type { Atlas, Buff, Item, Npc, TileWallEntry } from '@/types'

/**
 * 数据ID的**只读视图组件**（从 `DataIdPage` 抽出，见 docs/TODO.md U6）。
 * 纯展示：不持有页面状态，数据与回调由 `DataIdPage` 注入。
 */

interface DataIdSizeSpec {
  /** 贴图绘制区边长 */
  icon: number
  /** 图标区（hover 底色）边长：比图标大 8px */
  surface: number
  /** 格子宽度 = 图标区边长 */
  cell: number
  /** 是否显示 ID / 名称：小尺寸不显示（32px 图标下两行字会把格子撑得又高又挤） */
  showMeta: boolean
  gapDesktop: number
  gapMobile: number
  gapY: number
}

/**
 * 三档尺寸的唯一定义（页面设置 →「图标大小」）：Boss 分类把 icon / surface / cell 各乘 2
 * （大档就是原来的 128 贴图 / 144 格子）。物品 ID 与鱼店用同一套档位名，像素各自定义。
 */
export const DATA_ID_SIZES: Record<IconGridSize, DataIdSizeSpec> = {
  lg: {
    icon: 64,
    surface: 72,
    cell: 72,
    showMeta: true,
    gapDesktop: 16,
    gapMobile: 8,
    gapY: 16,
  },
  md: {
    icon: 48,
    surface: 56,
    cell: 56,
    showMeta: true,
    gapDesktop: 12,
    gapMobile: 8,
    gapY: 12,
  },
  sm: {
    icon: 32,
    surface: 40,
    cell: 40,
    showMeta: false,
    gapDesktop: 8,
    gapMobile: 8,
    gapY: 8,
  },
  // 横条：图标在左、ID 与名称在右竖排（名称单行截断）。图标 / 底板与小档一致，最小格宽 120 ≈ 5 个中文字。
  row: {
    icon: 32,
    surface: 40,
    cell: 160,
    showMeta: true,
    gapDesktop: 8,
    gapMobile: 8,
    gapY: 8,
  },
}

/**
 * 各数据源的默认档位：**一律「横条」**（图标在左、ID 与名称在右，三种数据源一致，
 * 一屏能铺更多条也读得全）。用户一旦在页面设置里选过，就按他选的来（见 `DataIdPage` 的 `rawIconSize`）。
 */
export const DATA_ID_DEFAULT_SIZES: Record<DataIdKind, IconGridSize> = {
  npc: 'row',
  tile: 'row',
  wall: 'row',
  buff: 'row',
}

/** 图标网格的容器样式：列宽 = 格子宽（`large` 时翻倍），间距按档位给。 */
export function iconGridStyle(
  size: IconGridSize,
  { large = false, mobile = false }: { large?: boolean; mobile?: boolean } = {},
): CSSProperties {
  const spec = DATA_ID_SIZES[size]
  // 横条档：列数按最小宽度自动填，再把剩余宽度平分成等宽列（与鱼店同一套做法）；Boss 的 ×2 对横条不生效。
  const row = size === 'row'
  const scale = large && !row ? 2 : 1
  const track = row ? `minmax(${spec.cell}px, 1fr)` : `${spec.cell * scale}px`
  return {
    gridTemplateColumns: `repeat(auto-fill, ${track})`,
    columnGap: mobile ? spec.gapMobile : spec.gapDesktop,
    rowGap: spec.gapY * scale,
  }
}

/**
 * 格子：宽度 = 图标区宽度（由 `DATA_ID_SIZES` 给），ID / 名称都在这个宽度内截断。
 * hover 时**整格**（图标 + 文字）一起上浮，只有图标区在 hover 时才出现底色。
 */
const CELL_CLASS =
  'group/cell flex cursor-pointer flex-col items-center gap-1 rounded-container text-center transition'
/** 横条格子：横向排布（图标左、文字右）。 */
const ROW_CELL_CLASS =
  'group/cell flex h-14 cursor-pointer items-center gap-2 text-left transition-colors duration-150 md:h-14'
/** 横条不做上浮（与合成表条目一致，只过渡颜色）。 */
const ROW_HOVER = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring '
const CELL_HOVER =
  'hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring '
/** 图标区（格子底板）：只有小档垫底板，其余只留 hover 淡色（见 `lib/iconGridSize` 的 `iconPlateClass`）。 */
const ICON_CELL_BG = 'flex items-center justify-center transition'

const iconSurfaceClass = (size: IconGridSize) => cn(ICON_CELL_BG, iconPlateClass(size))

/** 横条档右侧的文字块：ID 在上、名称在下（名称单行截断）。横条的意义就是带文字，所以忽略「隐藏 ID 和名称」。 */
function RowMeta({ id, name }: { id: string | number; name: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
      <span className="font-pixel text-2xs leading-none text-muted-foreground">{id}</span>
      <span className="w-full truncate text-xs leading-4 text-foreground">{name}</span>
    </span>
  )
}

/**
 * 数据表格的一行：斑马纹 + hover / 键盘聚焦高亮 + **整行可点**（指针变手型）。
 * `cursor-pointer` 与 `selectableRow()` 的事件配对使用。
 */
const ROW_CLASS =
  'cursor-pointer border-t border-border/50 transition-colors odd:bg-muted/25 hover:bg-primary/10 focus-visible:bg-primary/10 '

export function NpcCell({
  npc,
  size = DEFAULT_ICON_GRID_SIZE,
  large = false,
  hideMeta = false,
  onSelect,
}: {
  npc: Npc
  /** 图标尺寸档位（贴图 / 格子 / 图标区都从 `DATA_ID_SIZES` 取）。 */
  size?: IconGridSize
  /** Boss 分类：贴图 / 格子 / 图标区各放大一倍。 */
  large?: boolean
  /** 页面设置里「隐藏 ID 和名称」：只留图标（小尺寸强制只图标）。 */
  hideMeta?: boolean
  onSelect: (npc: Npc) => void
}) {
  const spec = DATA_ID_SIZES[size]
  const row = size === 'row'
  // 横条档不按 Boss 分类放大：一行 360px 宽没有意义，格子会撑得比屏幕还宽。
  const scale = large && !row ? 2 : 1
  const showMeta = row || (spec.showMeta && !hideMeta)
  return (
    <button
      type="button"
      title={`${npc.name} #${npc.id}`}
      onClick={() => onSelect(npc)}
      className={cn(row ? cn(ROW_CELL_CLASS, ROW_PLATE_CLASS) : CELL_CLASS, row ? ROW_HOVER : CELL_HOVER)}
      // 横条平分整行宽度：格子填满 1fr 轨道，别再写死格宽
      style={{ width: row ? '100%' : spec.cell * scale }}
    >
      {row ? (
        // 横条：提示锚点放在整条格子上（NPC 没有物品，用「#ID + 名称」）
        <RowTip id={npc.id} name={npc.name}>
          <span
            data-testid="dataid-icon-surface"
            className={iconSurfaceClass(size)}
            style={{ width: spec.surface * scale, height: spec.surface * scale }}
          >
            <NpcSprite id={npc.id} size={spec.icon * scale} name={npc.name} />
          </span>
          <RowMeta id={npc.id} name={npc.name} />
        </RowTip>
      ) : (
        <>
          <span
            data-testid="dataid-icon-surface"
            className={iconSurfaceClass(size)}
            style={{ width: spec.surface * scale, height: spec.surface * scale }}
          >
            <NpcSprite id={npc.id} size={spec.icon * scale} name={npc.name} />
          </span>
          {
        showMeta && (
          <>
            <span className="w-full truncate font-pixel text-2xs leading-none text-muted-foreground">
              {npc.id}
            </span>
            <span className="w-full truncate text-xs leading-4 text-foreground">{npc.name}</span>
          </>
          )}
        </>
      )}
    </button>
  )
}

/** NPC 表格视图：ID / 贴图 / 名称 / 内部名；整行可点（含键盘 Enter / 空格），打开详情抽屉。 */
export function NpcTableLayout({
  rows,
  twoCols = false,
  onSelect,
}: {
  rows: Npc[]
  /** 是否允许排成两列（与图格 / 墙 / Buff 共用同一个 checkbox）。 */
  twoCols?: boolean
  onSelect: (npc: Npc) => void
}) {
  const [left, right] = splitRows(rows, twoCols)
  return (
    <div className={cn('grid gap-x-6 gap-y-3', right.length > 0 && 'xl:grid-cols-2')}>
      <NpcTable rows={left} onSelect={onSelect} />
      {right.length > 0 && <NpcTable rows={right} onSelect={onSelect} />}
    </div>
  )
}

/**
 * 单张 NPC 表：ID / 图标 / 名称 / 英文名（英文界面下这一列是内部名）。
 *
 * 为什么要英文名而不是内部名：内部名（`EyeofCthulhu`）对人没用，而英文名（`Eye of Cthulhu`）
 * 是 `/sb`、`/tpnpc` 等指令认的那个名字（`Npc.en`，来源 `loc.en-US` 的 `NPCName`）。
 */
function NpcTable({ rows, onSelect }: { rows: Npc[]; onSelect: (npc: Npc) => void }) {
  const { t, lang } = useI18n()
  /** 英文界面下「名称」已经是英文，这一列改回内部名（指令里的枚举名）。 */
  const secondary = (npc: Npc) => (lang === 'en' ? npc.key : (npc.en ?? npc.key))
  return (
    <div className="overflow-clip rounded-control border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          <col />
        </colgroup>
        <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-right font-medium">{t('dataId.table.id')}</th>
            <th className="px-1 py-2 text-center font-medium">{t('dataId.table.icon')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('dataId.table.name')}</th>
            <th className="px-3 py-2 text-left font-medium">
              {lang === 'en' ? t('dataId.table.key') : t('dataId.table.english')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((npc) => (
            <tr
              key={npc.id}
              title={`${npc.name} #${npc.id}`}
              tabIndex={0}
              {...selectableRow(() => onSelect(npc))}
              className={ROW_CLASS}
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
                title={secondary(npc)}
              >
                {secondary(npc)}
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

/** Buff 速查表：ID / 图标 / 名称 / 内部名（图标来自 `data/buff-atlas.webp`）。行多时同图格一样可排两列。 */
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
  size = DEFAULT_ICON_GRID_SIZE,
  mobile = false,
  hideMeta = false,
  onSelect,
}: {
  rows: Buff[]
  /** 图标尺寸档位 */
  size?: IconGridSize
  /** 窄屏：列间距收紧到 8px（与物品 ID 一致） */
  mobile?: boolean
  hideMeta?: boolean
  onSelect: (buff: Buff) => void
}) {
  const spec = DATA_ID_SIZES[size]
  const row = size === 'row'
  const showMeta = row || (spec.showMeta && !hideMeta)
  return (
    <div className="grid" style={iconGridStyle(size, { mobile })}>
      {rows.map((buff) => (
        <button
          key={buff.id}
          type="button"
          title={`${buff.name} #${buff.id}`}
          onClick={() => onSelect(buff)}
          className={cn(row ? cn(ROW_CELL_CLASS, ROW_PLATE_CLASS) : CELL_CLASS, row ? ROW_HOVER : CELL_HOVER)}
          style={{ width: row ? '100%' : spec.cell }}
        >
          {row ? (
            // 横条：提示锚点放在整条格子上。Buff 本身不是物品（来源物品可能有很多件，弹某一件的属性会误导），
            // 所以用「#ID + 名称 + 游戏内描述」。
            <RowTip id={buff.id} name={buff.name} note={buff.tip}>
              <span
                data-testid="dataid-icon-surface"
                className={iconSurfaceClass(size)}
                style={{ width: spec.surface, height: spec.surface }}
              >
                <BuffIcon id={buff.id} size={spec.icon} name={buff.name} />
              </span>
              <RowMeta id={buff.id} name={buff.name} />
            </RowTip>
          ) : (
            <>
              <span
                data-testid="dataid-icon-surface"
                className={iconSurfaceClass(size)}
                style={{ width: spec.surface, height: spec.surface }}
              >
                <BuffIcon id={buff.id} size={spec.icon} name={buff.name} />
              </span>
              {showMeta && (
                <>
                  <span className="w-full truncate font-pixel text-2xs leading-none text-muted-foreground">
                    {buff.id}
                  </span>
                  <span className="w-full truncate text-xs leading-4 text-foreground">
                    {buff.name}
                  </span>
                </>
              )}
            </>
          )}
        </button>
      ))}
    </div>
  )
}

/** 单张 Buff 表：ID / 图标 / 名称 / 内部名；整行可点，打开详情抽屉；表头吸顶。 */
function BuffTable({ rows, onSelect }: { rows: Buff[]; onSelect: (buff: Buff) => void }) {
  const { t } = useI18n()
  return (
    <div className="overflow-clip rounded-control border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          <col />
        </colgroup>
        {/* 表头不铺白底：用页面背景色（半透明 + 模糊），吸顶时也不会看到下面的行糊在一起 */}
        <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-right font-medium">{t('dataId.table.id')}</th>
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
              {...selectableRow(() => onSelect(buff))}
              className={ROW_CLASS}
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
  size = DEFAULT_ICON_GRID_SIZE,
  mobile = false,
  hideMeta = false,
  onSelect,
}: {
  rows: TileWallEntry[]
  nameOf: (e: TileWallEntry) => string
  itemOf: (e: TileWallEntry) => Item | undefined
  atlas: Atlas | undefined
  /** 图标尺寸档位 */
  size?: IconGridSize
  /** 窄屏：列间距收紧到 8px（与物品 ID 一致） */
  mobile?: boolean
  hideMeta?: boolean
  onSelect: (entry: TileWallEntry) => void
}) {
  const { t } = useI18n()
  const spec = DATA_ID_SIZES[size]
  const row = size === 'row'
  const showMeta = row || (spec.showMeta && !hideMeta)
  return (
    <div className="grid" style={iconGridStyle(size, { mobile })}>
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
            className={cn(row ? cn(ROW_CELL_CLASS, ROW_PLATE_CLASS) : CELL_CLASS, row ? ROW_HOVER : CELL_HOVER)}
            style={{ width: row ? '100%' : spec.cell }}
          >
            <span
              data-testid="dataid-icon-surface"
              className={iconSurfaceClass(size)}
              style={{ width: spec.surface, height: spec.surface }}
            >
              {item ? (
                <ItemIcon
                  item={item}
                  atlas={atlas}
                  size={spec.icon}
                  name={name}
                  tooltip={false}
                />
              ) : (
                <span
                  className="inline-block rounded bg-muted/60"
                  style={{ width: spec.icon, height: spec.icon }}
                  aria-hidden
                />
              )}
            </span>
            {row ? (
              <RowMeta id={displayId} name={name} />
            ) : (
              showMeta && (
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
              )
            )}
          </button>
        )
      })}
    </div>
  )
}

/** 单张表：ID / 图标 / 名称 / 尺寸（图格）/ 内部名；整行可点，打开详情抽屉；表头吸顶。 */
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
    <div className="overflow-clip rounded-control border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-10" />
          <col />
          {isTile && <col className="w-12" />}
          <col />
        </colgroup>
        {/* 表头不铺白底：用页面背景色（半透明 + 模糊），吸顶时也不会看到下面的行糊在一起 */}
        <thead className="sticky top-[var(--page-sticky-top,0px)] z-10 bg-background/90 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-right font-medium">{t('dataId.table.id')}</th>
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
                {...selectableRow(() => onSelect(entry))}
                className={ROW_CLASS}
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
 * NPC 详情：贴图 + `#ID 名称` / 英文名 / 内部名，底部是「相关指令」。
 *
 * 相关指令**不按权限隐藏**：玩家照常能看到 / 复制（能不能执行由 TShock 判定，
 * 与「小抄」页一致：不把权限当展示门槛）。行内 ⭐ / 填入指令 / 复制见 `CommandLine`。
 */
export function NpcDetail({
  npc,
  large = false,
  username = null,
  onFilled,
}: {
  npc: Npc
  large?: boolean
  /** 当前登录玩家名：Boss 召唤物那条要拼 `/give <物品> <玩家>`（未登录就没有这一行）。 */
  username?: string | null
  /** 点了「填入指令」后关掉抽屉（搜索面板是模态的，不叠两层）。 */
  onFilled?: () => void
}) {
  const { t, lang } = useI18n()
  const dataset = useDataset()
  // 英文名只在**非英文界面**显示（英文界面上它就是 NPC 的本名，重复一遍没意义）。
  const enName = lang === 'en' ? '' : (npc.en ?? '')
  const itemName = (itemId: number) => dataset?.itemsById.get(itemId)?.name
  return (
    <div className={cn('flex flex-col gap-2', large && 'gap-4')}>
      <div className={cn(large ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3')}>
        <NpcSprite
          id={npc.id}
          size={large ? 128 : 32}
          name={npc.name}
          mode={large ? 'fit' : 'game'}
        />
        {/* 图标下方一行：`#4 克苏鲁之眼`（ID 弱色，与图标格的写法一致）。 */}
        <div className={cn('min-w-0', large && 'text-center')}>
          <div className={cn('truncate font-semibold text-foreground', large ? 'text-base' : 'text-sm')}>
            <span className="text-muted-foreground">#{npc.id}</span> {npc.name}
          </div>
        </div>
      </div>
      {enName && <DetailRow label={t('dataId.field.en')} value={enName} />}
      <DetailRow label={t('dataId.field.internal')} value={npc.key} mono />
      <CommandLine
        label={t('commandLine.related')}
        commands={npcRelatedCommands(npc, { itemName, username })}
        onFilled={onFilled}
      />
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
  itemsById,
  atlas,
  onFilled,
}: {
  buff: Buff
  large?: boolean
  /** 点了「填入指令」后关掉抽屉（搜索面板是模态的）。 */
  onFilled?: () => void
  /**
   * 当前玩家名 → 显示 `/gbuff <玩家> <buffID>`；未登录 / 不知道玩家名传 null（拼不出来，不显示）。
   * 不探测权限（见 `DataIdPage`：本页不请求 `/api/me`）。
   */
  gbuffPlayer?: string | null
  /** 解析 buff.items（能获得它的物品的图标 / 名称）；不传时这一行只显示条数或不显示明细。 */
  itemsById?: Map<number, Item>
  atlas?: Atlas
}) {
  const { t } = useI18n()
  const items = (buff.items ?? [])
    .map((id) => itemsById?.get(id))
    .filter((item): item is Item => item != null)
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
      {buff.tip && (
        <p
          data-testid="buff-tip"
          className={cn('text-xs text-muted-foreground', large && 'text-center text-sm')}
        >
          {buff.tip}
        </p>
      )}
      <DetailRow label={t('dataId.field.internal')} value={buff.key} mono />
      <div className="flex flex-col gap-1">
        <div className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 text-xs">
          <span className="text-muted-foreground">{t('dataId.field.buffItems')}</span>
          {items.length === 0 ? (
            <span className="text-right text-muted-foreground">—</span>
          ) : items.length === 1 ? (
            <span className="flex min-w-0 items-center justify-end gap-2">
              <ItemIcon item={items[0]} atlas={atlas} size={20} name={items[0]!.name} />
              <span className="truncate text-foreground">
                {items[0]!.name} #{items[0]!.id}
              </span>
            </span>
          ) : (
            <span className="text-right text-muted-foreground">
              {t('dataId.field.buffItemsCount', { n: items.length })}
            </span>
          )}
        </div>
        {/* 多件（吃得好有 42 种食物）：单列限高滚动。抽屉只有 ~384px 宽，两列会把物品名截成四五个字。 */}
        {items.length > 1 && (
          <div
            data-testid="buff-items"
            className="flex max-h-60 flex-col gap-1 overflow-y-auto overscroll-contain"
          >
            {items.map((item) => (
              <div
                key={item.id}
                className="flex min-w-0 items-center gap-2 rounded-control border border-border/60 px-2 py-1"
              >
                <ItemIcon item={item} atlas={atlas} size={20} name={item.name} />
                <span className="truncate text-xs text-foreground">{item.name}</span>
                <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                  #{item.id}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {gbuffPlayer && (
        <CommandLine
          label={t('commandLine.related')}
          commands={[gbuffCommand(gbuffPlayer, buff.id)]}
          onFilled={onFilled}
        />
      )}
    </div>
  )
}
