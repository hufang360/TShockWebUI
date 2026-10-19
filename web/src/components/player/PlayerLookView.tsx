import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { CollapseChevron } from '@/components/CollapseChevron'
import { ItemIcon } from '@/components/ItemIcon'
import { SlotTooltip } from '@/components/SlotTooltip'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui'
import { useDataset } from '@/lib/datasetContext'
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
        className="group/title flex w-full cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
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
  const hasAny = cols.some((c) => sliceGroup(look, c).length > 0)
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

/** 永久增强消耗品（图标 id + 名称 key）。 */
const BOOSTERS: { field: keyof PlayerLook; itemId: number; labelKey: string }[] = [
  { field: 'ateArtisanBread', itemId: 5326, labelKey: 'players.boost.artisanBread' },
  { field: 'usedAegisCrystal', itemId: 5337, labelKey: 'players.boost.aegisCrystal' },
  { field: 'usedAegisFruit', itemId: 5338, labelKey: 'players.boost.aegisFruit' },
  { field: 'usedArcaneCrystal', itemId: 5339, labelKey: 'players.boost.arcaneCrystal' },
  { field: 'usedGalaxyPearl', itemId: 5340, labelKey: 'players.boost.galaxyPearl' },
  { field: 'usedGummyWorm', itemId: 5341, labelKey: 'players.boost.gummyWorm' },
  { field: 'usedAmbrosia', itemId: 5342, labelKey: 'players.boost.ambrosia' },
]

/** 一次性解锁 / 升级类标记。 */
const UNLOCKS: { field: keyof PlayerLook; itemId: number; labelKey: string }[] = [
  { field: 'extraSlot', itemId: 3335, labelKey: 'players.boost.demonHeart' },
  { field: 'unlockedBiomeTorches', itemId: 5043, labelKey: 'players.boost.torchGod' },
  { field: 'unlockedSuperCart', itemId: 5289, labelKey: 'players.boost.superCart' },
]

/** `/pm/look` 额外返回的只读信息：生命 / 魔力 / 渔夫任务 / 重生点 + 永久增强。 */
export function PlayerInfoPanel({ look }: { look: PlayerLook }) {
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
  // 属性行：标签走 muted、数值加重并等宽（tabular-nums），拉开「属性 · 属性值」的层次；
  // 上限 / 单位用 muted 弱化，不再和数值黏成一坨。
  const attr = (label: string, value: ReactNode) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </>
  )
  return (
    <div className="flex flex-col gap-2 text-sm text-foreground">
      <dl className="mt-1 grid w-fit max-w-full grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-1">
        {attr(
          t('players.hp'),
          <>
            {look.health}
            <span className="font-normal text-muted-foreground"> / {look.maxHealth}</span>
          </>,
        )}
        {attr(
          t('players.mp'),
          <>
            {look.mana}
            <span className="font-normal text-muted-foreground"> / {look.maxMana}</span>
          </>,
        )}
        {attr(
          t('players.quests'),
          <>
            {quests}
            <span className="font-normal text-muted-foreground"> {t('players.questsUnit')}</span>
          </>,
        )}
        {look.spawnX >= 0 && attr(t('players.spawn'), <>{look.spawnX}, {look.spawnY}</>)}
      </dl>
      {/* 恶魔之心 / 火把神 / 矿车升级 + 7 个消耗品：都归到「永久增强」下；
          容器只有半宽，图标多时自动换行（`flex-wrap`）。 */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="mr-0.5 text-muted-foreground">{t('players.boost.title')}</span>
        {UNLOCKS.map((b) => itemIcon(b.itemId, look[b.field] === true))}
        {BOOSTERS.map((b) => itemIcon(b.itemId, look[b.field] === true))}
      </div>
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
