import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { BuffIcon } from '@/components/BuffIcon'
import { CollapseChevron } from '@/components/CollapseChevron'
import { ItemIcon } from '@/components/ItemIcon'
import { SlotTooltip } from '@/components/SlotTooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui'
import { useDataset } from '@/lib/datasetContext'
import type { Dataset } from '@/types'
import { PERMANENT_BOOSTS } from '@/lib/playerBoosts'
import {
  formatBuffTime,
  formatPlayTime,
  formatSaveTime,
  playerDifficultyKey,
} from '@/lib/playerPage'
import { useI18n, type I18n } from '@/lib/i18n'
import {
  EQUIP_GROUP_A,
  EQUIP_GROUP_B,
  findGroup,
  loadoutColumns,
  type SlotGroup,
} from '@/lib/playerSlots'
import { cn } from '@/lib/cn'
import type { PlayerItem, PlayerLook } from '@/lib/tshock'

/**
 * 玩家背包 / 装备的**只读视图**（从 `PlayerManagerPage` 抽出，见 docs/TODO.md U6）。
 * 纯展示：不发起请求、不持有页面状态；数据来自 `PlayerLook`。
 */

/** 取分组对应的槽位（数据不足时只返回已有的，库层不对齐不补空格）。 */
export function sliceGroup(
  look: PlayerLook,
  group: { start: number; count: number },
): PlayerItem[] {
  return look.items.slice(group.start, group.start + group.count)
}

/** 分组里非空格子的数量（id <= 0 视为空）。 */
const countItems = (items: PlayerItem[]) => items.filter((it) => it && it.id > 0).length

type LabelKind = 'number' | 'none' | 'trash' | 'armor' | 'vanity' | 'dye' | 'miscEquip'

/** 空格子 tooltip 的文案类型；`none` = 不显示 tooltip（钱币 / 弹药）。 */
function labelKindOf(groupKey: string): LabelKind {
  switch (groupKey) {
    case 'players.group.coins':
    case 'players.group.ammo':
      return 'none'
    case 'players.group.trash':
      return 'trash'
    case 'players.group.armor':
      return 'armor'
    case 'players.group.vanity':
      return 'vanity'
    case 'players.group.dye':
    case 'players.group.miscDye':
      return 'dye'
    case 'players.group.miscEquip':
      return 'miscEquip'
    default:
      return 'number'
  }
}

/** 空格子 tooltip；`null` = 不显示。 */
function slotLabel(t: I18n['t'], kind: LabelKind, index: number): string | null {
  switch (kind) {
    case 'none':
      return null
    case 'trash':
      return t('players.group.trash')
    case 'armor':
    case 'vanity': {
      if (index === 0) return t('players.slot.helmet')
      if (index === 1) return t('players.slot.shirt')
      if (index === 2) return t('players.slot.pants')
      const n = index - 2
      return kind === 'vanity'
        ? t('players.slot.socialAccessory', { n })
        : t('players.slot.accessory', { n })
    }
    case 'dye':
      return t('players.slot.dye', { n: index + 1 })
    case 'miscEquip': {
      const names = [
        t('players.slot.pet'),
        t('players.slot.lightPet'),
        t('players.slot.minecart'),
        t('players.slot.mount'),
        t('players.slot.hook'),
      ]
      return names[index] ?? t('players.slot.number', { n: index + 1 })
    }
    default:
      return t('players.slot.number', { n: index + 1 })
  }
}

/** 可折叠的分组标题（银行 / 配装共用）：chevron + 可选物品图标 + 名称。 */
function CollapsibleTitle({
  label,
  titleIconId,
  open,
}: {
  label: string
  titleIconId?: number
  open: boolean
}) {
  const dataset = useDataset()
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className="group/title flex w-full cursor-pointer items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {titleIconId != null && (
          <ItemIcon
            item={dataset?.itemsById.get(titleIconId)}
            atlas={dataset?.atlas}
            size={18}
            tooltip={false}
          />
        )}
        <span className="truncate">{label}</span>
        <CollapseChevron open={open} />
      </button>
    </CollapsibleTrigger>
  )
}

/** 普通分组：标题（可带物品图标）+ 网格（cols 列）。无数据时整块不渲染；支持折叠。 */
export function Group({
  group,
  items,
  titleIconId,
  open,
  onToggle,
}: {
  group: SlotGroup
  items: PlayerItem[]
  titleIconId?: number
  open: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  if (items.length === 0) return null
  const kind = labelKindOf(group.key)
  const n = countItems(items)
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="flex flex-col gap-1.5">
      <CollapsibleTitle
        label={n > 0 ? `${t(group.key)}（${n}）` : t(group.key)}
        titleIconId={titleIconId}
        open={open}
      />
      <CollapsibleContent>
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${group.cols}, minmax(0, 1fr))`,
            maxWidth: group.cols * 40,
          }}
        >
          {items.map((it, i) => (
            <Slot key={it.slot} item={it} label={slotLabel(t, kind, i)} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** 单格宽的竖列（钱币 / 弹药 / 装备区每一列）。 */
function ArrowColumn({
  groupKey,
  items,
  dimLast,
  hideLabel,
}: {
  groupKey: string
  items: PlayerItem[]
  /** 恶魔之心未吃时，最后一格（额外配饰槽）半透明。 */
  dimLast?: boolean
  /** 不显示列顶标签（配装块用：直接用「配装 N」作标题）。 */
  hideLabel?: boolean
}) {
  const { t } = useI18n()
  if (items.length === 0) return null
  const kind = labelKindOf(groupKey)
  return (
    <section className="flex flex-col gap-1.5">
      {!hideLabel && (
        <h3 className="text-center text-xs font-medium whitespace-nowrap text-muted-foreground">
          {t(groupKey)}
        </h3>
      )}
      <div
        className="mx-auto grid gap-1"
        style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 40 }}
      >
        {items.map((it, i) => (
          <Slot
            key={it.slot}
            item={it}
            label={slotLabel(t, kind, i)}
            dim={dimLast === true && i === items.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * 背包簇（仿游戏）：主格 10×5 + 钱币 / 弹药两列在右侧（列间隔减半），
 * 垃圾桶在主格右下角（最后一列下方），空格时显示半透明垃圾桶图标。
 */
export function BackpackCluster({ look }: { look: PlayerLook }) {
  const { t } = useI18n()
  const main = sliceGroup(look, findGroup('players.group.inventory'))
  const coins = sliceGroup(look, findGroup('players.group.coins'))
  const ammo = sliceGroup(look, findGroup('players.group.ammo'))
  const trash = sliceGroup(look, findGroup('players.group.trash'))[0]
  if (main.length === 0) return null

  return (
    // 与右侧配装块顶部对齐；不额外留空行。
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('players.group.inventory')}
        </h3>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', maxWidth: 400 }}
        >
          {main.map((it, i) => (
            <Slot key={it.slot} item={it} label={slotLabel(t, 'number', i)} />
          ))}
          {/* 垃圾桶：主格最后一列正下方（第 6 行、第 10 列）。 */}
          {trash && (
            <Slot
              item={trash}
              label={t('players.group.trash')}
              style={{ gridColumnStart: 10 }}
              emptyIcon={<Trash2 className="size-5 text-muted-foreground/40" />}
            />
          )}
        </div>
      </section>
      {/* 钱币 + 弹药作为一个整体：窄屏时一起换到背包的下一行（列间隔已缩小）。 */}
      <div className="flex items-start gap-x-1">
        <ArrowColumn groupKey="players.group.coins" items={coins} />
        <ArrowColumn groupKey="players.group.ammo" items={ammo} />
      </div>
    </div>
  )
}

/** 恶魔之心未吃时，额外配饰槽那一格（装备/时装/染料竖列的最下面一格）半透明。 */
function accessoryLocked(look: PlayerLook, key: string): boolean {
  if (look.extraSlot) return false
  return (
    key === 'players.group.armor' || key === 'players.group.vanity' || key === 'players.group.dye'
  )
}

/**
 * 装备区：两组、整体**居左**；B组（杂项染料 / 杂项装备）在左，A组（染料 / 时装 / 装备）在右，
 * 组内列间隔减半，两组之间保持原间隔。
 */
export function EquipCluster({ look }: { look: PlayerLook }) {
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      <div className="flex items-start gap-x-1">
        {EQUIP_GROUP_B.map((key) => (
          <ArrowColumn key={key} groupKey={key} items={sliceGroup(look, findGroup(key))} />
        ))}
      </div>
      <div className="flex items-start gap-x-1">
        {EQUIP_GROUP_A.map((key) => (
          <ArrowColumn
            key={key}
            groupKey={key}
            items={sliceGroup(look, findGroup(key))}
            dimLast={accessoryLocked(look, key)}
          />
        ))}
      </div>
    </div>
  )
}

/** 配装块：标题 + 3 列（染料 / 时装 / 装备，与装备区 A 组一致）。 */
export function LoadoutBlock({
  look,
  groupKey,
  open,
  onToggle,
}: {
  look: PlayerLook
  groupKey: string
  open: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  const cols = loadoutColumns(findGroup(groupKey).start)
  // 注意：`sliceGroup` 永远返回固定长度的窗口（组的大小），**不能**用 `.length > 0` 判断有没有东西，
  // 否则三块配装即使全空也会一直渲染出来（正是这个 bug，已用单测钉住）。
  const hasAny = cols.some((c) => countItems(sliceGroup(look, c)) > 0)
  if (!hasAny) return null
  const total = cols.reduce((n, c) => n + countItems(sliceGroup(look, c)), 0)
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="flex flex-col gap-1.5">
      <CollapsibleTitle
        label={total > 0 ? `${t(groupKey)}（${total}）` : t(groupKey)}
        open={open}
      />
      <CollapsibleContent>
        <div className="flex items-start gap-x-1.5">
          {cols.map((c) => (
            <ArrowColumn
              key={`${c.key}:${c.start}`}
              groupKey={c.key}
              items={sliceGroup(look, c)}
              dimLast={accessoryLocked(look, c.key)}
              hideLabel
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function PlayerInfoPanel({ look }: { look: PlayerLook }) {
  /** 研究进度明细弹窗（只有本地存档带 `research` 时可点）。 */
  const [researchOpen, setResearchOpen] = useState(false)
  const [researchQuery, setResearchQuery] = useState('')
  const { t } = useI18n()
  const dataset = useDataset()
  // 只显示物品图标（名字交给物品 tooltip），不再重复写文字；未使用/未解锁的变淡。
  const itemIcon = (itemId: number, on: boolean) => (
    <ItemIcon
      key={itemId}
      item={dataset?.itemsById.get(itemId)}
      atlas={dataset?.atlas}
      size={20}
      className={on ? undefined : 'opacity-40'}
    />
  )
  const quests = Number(look.questsCompleted ?? 0)
  const playTime = formatPlayTime(look.playTimeTicks)
  const savedAt = formatSaveTime(look.lastSaved)
  // 死亡次数：只有真的死过才显示，免得每份存档都多一行「0 / 0」。
  const deaths = Number(look.deathsPve ?? 0) + Number(look.deathsPvp ?? 0)

  /**
   * 属性行：**成对**排两列（生命 / 魔力、模式 / 版本、游戏时间 / 最后保存、Golf / 渔夫任务），
   * 容器够窄时自动退回一列。只有本地 `.plr` 才有的字段没数据就整行不出现。
   */
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: t('players.hp'),
      value: (
        <>
          {look.health}
          <span className="font-normal text-muted-foreground"> / {look.maxHealth}</span>
        </>
      ),
    },
    {
      label: t('players.mp'),
      value: (
        <>
          {look.mana}
          <span className="font-normal text-muted-foreground"> / {look.maxMana}</span>
        </>
      ),
    },
    ...(look.difficulty != null
      ? [
          {
            label: t('players.difficulty'),
            value: t(`players.difficulty.${playerDifficultyKey(look.difficulty)}`),
          },
        ]
      : []),
    ...(look.gameVersion ? [{ label: t('players.version'), value: look.gameVersion }] : []),
    ...(playTime ? [{ label: t('players.playTime'), value: playTime }] : []),
    ...(savedAt ? [{ label: t('players.lastSaved'), value: savedAt }] : []),
    ...(look.golferScore != null ? [{ label: t('players.golf'), value: look.golferScore }] : []),
    {
      label: t('players.quests'),
      value: (
        <>
          {quests}
          <span className="font-normal text-muted-foreground"> {t('players.questsUnit')}</span>
        </>
      ),
    },
    ...(deaths > 0 ? [{ label: t('players.deaths'), value: deaths }] : []),
    ...(look.researchedCount != null
      ? [
          {
            label: t('players.research'),
            value: (
              <>
                {look.research && look.research.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setResearchOpen(true)}
                    className="underline decoration-dotted underline-offset-2 hover:text-primary"
                    data-testid="players-research-open"
                  >
                    {look.researchedCount}
                  </button>
                ) : (
                  look.researchedCount
                )}
                <span className="font-normal text-muted-foreground"> {t('players.researchUnit')}</span>
              </>
            ),
          },
        ]
      : []),
    ...(look.spawnX >= 0
      ? [
          {
            label: t('players.spawn'),
            value: (
              <>
                {look.spawnX}, {look.spawnY}
              </>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-2 text-sm text-foreground">
      {/* 两列网格用**自身宽度**判断（`@container` + `@[260px]`），不看视口：
          侧栏展开 / 收起、窗口缩放时都不会把数值挤成两行。 */}
      <div className="@container mt-1">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 @[260px]:grid-cols-2">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex min-w-0 items-baseline gap-2">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {/* 恶魔之心 / 火把神 / 矿车升级 + 7 个消耗品：都归到「永久增强」下；
          容器只有半宽，图标多时自动换行（`flex-wrap`）。 */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="mr-0.5 text-muted-foreground">{t('players.boost.title')}</span>
        {PERMANENT_BOOSTS.map((b) => itemIcon(b.itemId, look[b.field] === true))}
      </div>
      {/* 研究进度明细：点「已研究 N 种」打开。持久 ID 与 `data/items.json` 的 `key` 一致，
          所以不需要额外数据表就能对回物品名。 */}
      {researchOpen && look.research && (
        <ResearchDialog
          entries={look.research}
          open={researchOpen}
          query={researchQuery}
          onQuery={setResearchQuery}
          onClose={() => setResearchOpen(false)}
        />
      )}
      {/* 重生点：`.plr` 是**按世界分开**存的（世界名 + 坐标）。只在本地存档里出现；
          导出图片不含这一堆（条目数不定），图片里只带 `/pm/look` 能给的当前重生点。 */}
      {look.spawns && look.spawns.length > 0 && (
        <div className="flex flex-col gap-0.5" data-testid="players-spawns">
          <span className="text-muted-foreground">
            {t('players.spawns.title')}（{look.spawns.length}）
          </span>
          <ul className="flex flex-col gap-0.5 text-2xs text-muted-foreground">
            {look.spawns.map((spawn) => (
              <li key={`${spawn.worldId}:${spawn.x}:${spawn.y}`} className="flex min-w-0 gap-2">
                <span className="min-w-0 truncate">{spawn.world || `#${spawn.worldId}`}</span>
                <span className="shrink-0 tabular-nums">
                  {spawn.x}, {spawn.y}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* 当前 BUFF：图标 + 剩余时间（名字看图标 tooltip）；没有 BUFF 时整行不显示。 */}
      {look.buffs && look.buffs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground">{t('players.buff.title')}</span>
          {look.buffs.map((buff) => {
            const name = dataset?.buffsById.get(buff.type)?.name ?? `#${buff.type}`
            return (
              <SlotTooltip key={buff.type} label={`${name} · ${formatBuffTime(buff.ticks)}`}>
                <span className="flex items-center gap-1">
                  <BuffIcon id={buff.type} size={22} name={name} />
                  <span className="text-2xs tabular-nums text-muted-foreground">
                    {formatBuffTime(buff.ticks)}
                  </span>
                </span>
              </SlotTooltip>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Slot({
  item,
  label,
  emptyIcon,
  dim,
  style,
}: {
  item: PlayerItem
  /** 空格子提示文案；`null` = 不显示（钱币 / 弹药）；缺省显示「空格子」。 */
  label?: string | null
  /** 空格子时显示的占位图标（如垃圾桶）。 */
  emptyIcon?: ReactNode
  /** 不可用（如未吃恶魔之心的额外配饰槽）：整格半透明。 */
  dim?: boolean
  style?: CSSProperties
}) {
  const { t } = useI18n()
  const dataset = useDataset()
  const prefixName = useMemo(
    () => (item.prefix > 0 ? (dataset?.prefixesById.get(item.prefix)?.name ?? null) : null),
    [dataset, item.prefix],
  )
  const empty = !item || item.id <= 0
  // 空格子用 shadcn Tooltip；有物品的格子由 ItemIcon 自带的 ItemTooltip 负责。
  const tipLabel = empty ? (label === null ? null : (label ?? t('players.slotEmpty'))) : null
  const frame = (
    <span
      className={cn(
        'group/slot relative inline-block size-9 transition-transform duration-100 ease-out hover:-translate-y-0.5',
        dim && 'opacity-40',
      )}
      style={style}
    >
      <span
        aria-hidden
        data-slot-frame
        className="absolute inset-0 rounded border border-muted-foreground/40 bg-muted/20 transition-colors group-hover/slot:border-foreground/60 group-hover/slot:bg-muted/50"
      />
      {empty ? (
        emptyIcon ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            {emptyIcon}
          </span>
        ) : null
      ) : (
        <ItemIcon
          item={dataset?.itemsById.get(item.id)}
          atlas={dataset?.atlas}
          size={36}
          stack={item.stack}
          prefix={prefixName}
          className="relative"
        />
      )}
    </span>
  )

  return tipLabel ? <SlotTooltip label={tipLabel}>{frame}</SlotTooltip> : frame
}

/**
 * 研究进度明细弹窗：按「物品名 / 内部键名」搜索，列出「物品 × 已研究数量」。
 *
 * `persistentId` 就是物品的内部键名（`data/items.json` 的 `key`），与游戏
 * `ContentSamples.ItemPersistentIdsByNetIds` 完全一致（已用 GameDump 导出对过 6161 条，0 不一致）。
 */
function ResearchDialog({
  entries,
  open,
  query,
  onQuery,
  onClose,
}: {
  entries: { persistentId: string; count: number }[]
  open: boolean
  query: string
  onQuery: (next: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const dataset = useDataset()
  // 内部键名 → 物品（一次建表；8195 件物品量级可忽略）
  const byKey = useMemo(() => {
    const map = new Map<string, PlayerItemIconItem>()
    for (const item of dataset?.items ?? []) map.set(item.key, item)
    return map
  }, [dataset])
  const q = query.trim().toLowerCase()
  const filtered = q
    ? entries.filter(
        (e) =>
          e.persistentId.toLowerCase().includes(q) ||
          (byKey.get(e.persistentId)?.name ?? '').toLowerCase().includes(q),
      )
    : entries
  const shown = filtered.slice(0, 300)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('players.research.title')}</DialogTitle>
          <DialogDescription>
            {t('players.research.desc', { n: entries.length })}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('players.research.search')}
          aria-label={t('players.research.search')}
        />
        <p className="text-2xs text-muted-foreground tabular-nums">
          {t('players.research.matched', { n: filtered.length, total: entries.length })}
        </p>
        <ul className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto" data-testid="players-research-list">
          {shown.map((entry) => {
            const item = byKey.get(entry.persistentId)
            return (
              <li key={entry.persistentId} className="flex items-center gap-2 text-sm">
                {item ? (
                  <ItemIcon item={item} atlas={dataset?.atlas} size={20} />
                ) : (
                  <span className="size-5 shrink-0 rounded bg-muted" aria-hidden />
                )}
                <span className="min-w-0 truncate">{item?.name ?? entry.persistentId}</span>
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
                  ×{entry.count}
                </span>
              </li>
            )
          })}
          {shown.length === 0 && (
            <li className="px-1 py-3 text-center text-sm text-muted-foreground">
              {t('players.research.none')}
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/** `ResearchDialog` 只需要图标 + 名字这两个字段。 */
type PlayerItemIconItem = Dataset['items'][number]
