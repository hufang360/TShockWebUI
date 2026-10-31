import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { PlrItemEditor } from '@/components/player/PlrItemEditor'
import {
  Card,
  CardBody,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import type { ItemLimits } from '@/lib/itemLimits'
import { PERMANENT_BOOSTERS } from '@/lib/playerBoosts'
import { LOADOUT_KEYS } from '@/lib/playerSlots'
import type { PlrBoostField, PlrEquipContainer, PlrPlayer, PlrStorageContainer, PlrTrack } from '@/lib/save/plr'
import type { PlrEditDraft, PlrEditIssue } from '@/lib/save/plrEdit'
import { releaseSegment } from '@/lib/save/plr'
import { playerGameVersion, versionOptionsFor } from '@/lib/save/playerVersions'
import type { PlrItemEdit } from '@/lib/save/plrWrite'
import { cn } from '@/lib/cn'

/** 「永久增强」在编辑面板里的条目；`itemId` 只用来显示图标。 */
type BoostRowField = PlrBoostField | 'unlockedSuperCart'
const BOOST_ROWS: { field: BoostRowField; itemId: number; superCart?: boolean }[] = [
  { field: 'extraAccessory', itemId: 3335 }, // 恶魔之心
  { field: 'unlockedBiomeTorches', itemId: 5043 }, // 火把神的恩宠
  { field: 'unlockedSuperCart', itemId: 5289, superCart: true }, // 矿车升级包
  ...PERMANENT_BOOSTERS.map((b) => ({ field: b.field as BoostRowField, itemId: b.itemId })),
]

/** 装备区可编辑的 5 列（顺序与只读视图一致：杂项染料 / 杂项装备 → 染料 / 时装 / 装备）。 */
const EQUIP_EDIT_COLUMNS: {
  container: PlrEquipContainer
  /** 该列在容器里的起始下标（装备 20 格：前 10 装备、后 10 时装）。 */
  offset: number
  groupKey: string
  count: number
}[] = [
  { container: 'miscDyes', offset: 0, groupKey: 'players.group.miscDye', count: 5 },
  { container: 'miscEquips', offset: 0, groupKey: 'players.group.miscEquip', count: 5 },
  { container: 'dye', offset: 0, groupKey: 'players.group.dye', count: 10 },
  { container: 'armor', offset: 10, groupKey: 'players.group.vanity', count: 10 },
  { container: 'armor', offset: 0, groupKey: 'players.group.armor', count: 10 },
]

/** 随身仓储四组（顺序与只读视图一致）。 */
const STORAGE_EDIT_GROUPS: { container: PlrStorageContainer; groupKey: string }[] = [
  { container: 'piggyBank', groupKey: 'players.group.piggy' },
  { container: 'safe', groupKey: 'players.group.safe' },
  { container: 'forge', groupKey: 'players.group.forge' },
  { container: 'voidVault', groupKey: 'players.group.void' },
]

/** 仓储里「有物品」的格子数（折叠标题上显示，避免用户以为没读到）。 */
function countStorageItems(draft: PlrEditDraft): number {
  return Object.values(draft.storage).reduce(
    (n, slots) => n + Object.values(slots).filter((it) => it.id > 0).length,
    0,
  )
}

interface PlrEditPanelProps {
  player: PlrPlayer
  track: PlrTrack
  draft: PlrEditDraft
  issues: PlrEditIssue[]
  limits: ItemLimits | null
  onChange: (next: PlrEditDraft) => void
}

/**
 * 「玩家存档」的编辑态：角色属性 + 永久增强 + 背包（点格子编辑数量 / 词缀）。
 *
 * 纯受控组件：草稿与校验都在父组件的 `lib/save/plrEdit.ts` 里，这里只负责渲染与收集输入。
 */
export function PlrEditPanel({
  player,
  track,
  draft,
  issues,
  limits,
  onChange,
}: PlrEditPanelProps) {
  const { t } = useI18n()
  const data = useDataset()
  /** 随身仓储 / 配装默认收起：这两块一次就是 250 个格子，展开会把属性区挤没。 */
  const [openStorage, setOpenStorage] = useState(false)
  const [openLoadouts, setOpenLoadouts] = useState(false)
  /** 正在编辑的槽：背包（`inventory`）或装备区（容器 + 下标）。 */
  const [editing, setEditing] = useState<
    | { kind: 'inventory'; slot: number }
    | { kind: 'equipment'; container: PlrEquipContainer; index: number }
    | { kind: 'storage'; container: PlrStorageContainer; index: number }
    | { kind: 'loadout'; loadout: number; group: 'armor' | 'dye'; index: number }
    | null
  >(null)
  // dataset 是首屏一起加载的，理论上不会缺；缺了就不渲染（避免拿不到物品名 / 补全数据）。
  if (!data) return null
  const dataset = data

  const err = (field: string): string | null => {
    const issue = issues.find((i) => i.field === field)
    return issue ? t(issue.messageKey, issue.vars) : null
  }

  const num = (field: keyof PlrEditDraft, label: string, extra?: string) => {
    const message = err(field)
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`plr-edit-${field}`}>{label}</Label>
        <Input
          id={`plr-edit-${field}`}
          type="number"
          value={String(draft[field])}
          aria-invalid={message ? true : undefined}
          onChange={(e) => onChange({ ...draft, [field]: Number(e.target.value) })}
        />
        {message ? (
          <p className="text-2xs text-destructive">{message}</p>
        ) : (
          extra && <p className="text-2xs text-muted-foreground tabular-nums">{extra}</p>
        )}
      </div>
    )
  }

  const seg = releaseSegment(player.release)
  const saveVersionLabel = playerGameVersion(player.release) ?? String(player.release)
  /** 这份存档里**不存在**的永久增强字段（更早的游戏版本还没有这些字节）。 */
  const unsupportedBoosts = BOOST_ROWS.filter(({ field, superCart }) =>
    superCart ? track.superCartBits == null : track.boosts[field as PlrBoostField] == null,
  )
  /** 不支持的项里，是不是因为**尾部变长数据读不出来**（而不是存档版本太老）。 */
  const unsupportedByTail =
    track.tailUnparsed === true && unsupportedBoosts.some(({ superCart }) => superCart)
  const unsupportedReason = (superCart: boolean | undefined) =>
    superCart && track.tailUnparsed
      ? t('save.edit.boostUnreadable')
      : t('save.edit.boostUnsupported', { version: saveVersionLabel })
  const versionOptions = versionOptionsFor(player.release)
  const releaseIssue = err('release')

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-4 pt-4">
          <div className="grid gap-4 @[720px]:grid-cols-[repeat(2,minmax(0,1fr))] @[1080px]:grid-cols-[repeat(4,minmax(0,1fr))]">
            {num('statLife', t('save.edit.life'), `/ ${draft.statLifeMax}`)}
            {num('statLifeMax', t('save.edit.lifeMax'), t('save.edit.lifeMaxHint'))}
            {num('statMana', t('save.edit.mana'), `/ ${draft.statManaMax}`)}
            {num('statManaMax', t('save.edit.manaMax'), t('save.edit.manaMaxHint'))}
            {num('anglerQuests', t('players.quests'))}
            {num('golferScore', t('players.golf'))}

            <div className="flex flex-col gap-2">
              <Label htmlFor="plr-edit-difficulty">{t('players.difficulty')}</Label>
              <Select
                value={String(draft.difficulty)}
                onValueChange={(next) => onChange({ ...draft, difficulty: Number(next) })}
              >
                <SelectTrigger id="plr-edit-difficulty" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['softcore', 'mediumcore', 'hardcore', 'journey'].map((key, index) => (
                    <SelectItem key={key} value={String(index)}>
                      {t(`players.difficulty.${key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err('difficulty') ? (
                <p className="text-2xs text-destructive">{err('difficulty')}</p>
              ) : (
                draft.difficulty !== player.difficulty &&
                draft.difficulty >= 2 && (
                  <p className="text-2xs text-destructive">{t('save.edit.difficultyWarn')}</p>
                )
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="plr-edit-version">{t('players.version')}</Label>
              <Select
                value={String(draft.release)}
                onValueChange={(next) => onChange({ ...draft, release: Number(next) })}
              >
                <SelectTrigger id="plr-edit-version" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versionOptions.map((v) => (
                    <SelectItem key={v.release} value={String(v.release)}>
                      {v.gameVersion}（{v.release}）
                    </SelectItem>
                  ))}
                  {versionOptions.every((v) => v.release !== player.release) && (
                    <SelectItem value={String(player.release)}>
                      {playerGameVersion(player.release) ?? '?'}（{player.release}）
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {releaseIssue ? (
                <p className="text-2xs text-destructive">{releaseIssue}</p>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  {t('save.edit.versionHint', {
                    lo: playerGameVersion(seg.lo) ?? String(seg.lo),
                    hi: playerGameVersion(seg.hi) ?? String(seg.hi),
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{t('players.boost.title')}</span>
              {unsupportedBoosts.length > 0 && (
                <span className="text-2xs text-muted-foreground">
                  {unsupportedByTail
                    ? t('save.edit.boostUnreadableHint')
                    : t('save.edit.boostUnsupportedHint', { version: saveVersionLabel })}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {BOOST_ROWS.map(({ field, itemId, superCart }) => {
                const boostField = field as PlrBoostField
                const supported = superCart
                  ? track.superCartBits != null
                  : track.boosts[boostField] != null
                const checked = superCart
                  ? draft.superCart.unlocked
                  : draft.boosts[boostField] === true
                const item = dataset.itemsById.get(itemId)
                return (
                  <label
                    key={field}
                    className={cn(
                      'flex items-center gap-2 text-sm',
                      !supported && 'text-muted-foreground/50',
                    )}
                    title={
                      supported
                        ? undefined
                        : unsupportedReason(superCart)
                    }
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!supported}
                      onCheckedChange={(next) => {
                        if (superCart) {
                          onChange({
                            ...draft,
                            superCart: { unlocked: next === true, enabled: next === true },
                          })
                          return
                        }
                        onChange({
                          ...draft,
                          boosts: { ...draft.boosts, [boostField]: next === true },
                        })
                      }}
                    />
                    <ItemIcon item={item} atlas={dataset.atlas} size={20} />
                    <span>{item?.name ?? `#${itemId}`}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3 pt-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{t('players.group.inventory')}</h3>
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Pencil className="size-3" aria-hidden />
              {t('save.edit.bagHint')}
            </span>
          </div>
          <div className="grid grid-cols-10 gap-1" style={{ maxWidth: 420 }}>
            {Array.from({ length: 58 }, (_, slot) => {
              const item = draft.inventory[slot]
              const def = item && item.id > 0 ? dataset.itemsById.get(item.id) : undefined
              const slotIssue = issues.some((i) => i.field.startsWith(`inventory.${slot}.`))
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setEditing({ kind: 'inventory', slot })}
                  aria-label={t('save.edit.item.open', { slot: slot + 1 })}
                  className={cn(
                    'relative flex size-9 items-center justify-center rounded border transition-colors',
                    slotIssue
                      ? 'border-destructive'
                      : 'border-muted-foreground/40 bg-muted/20 hover:border-foreground/60 hover:bg-muted/50',
                  )}
                >
                  {def ? (
                    <>
                      <ItemIcon item={def} atlas={dataset.atlas} size={30} />
                      {item.stack > 1 && (
                        <span className="absolute right-0.5 bottom-0 text-2xs font-bold text-white tabular-nums [text-shadow:0_0_2px_#000]">
                          {item.stack}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground tabular-nums">{slot + 1}</span>
                  )}
                </button>
              )
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3 pt-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{t('players.group.armor')}</h3>
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Pencil className="size-3" aria-hidden />
              {t('save.edit.equipHint')}
            </span>
          </div>
          <div className="flex items-start gap-x-2" data-testid="plr-edit-equipment">
            {EQUIP_EDIT_COLUMNS.map(({ container, offset, groupKey, count }) => (
              <div key={`${container}:${offset}`} className="flex flex-col items-center gap-1">
                <span className="text-2xs text-muted-foreground">{t(groupKey)}</span>
                <div className="flex flex-col gap-1">
                  {Array.from({ length: count }, (_, i) => {
                    const index = offset + i
                    const item = draft.equipment[container]?.[index]
                    const def = item && item.id > 0 ? dataset.itemsById.get(item.id) : undefined
                    const slotIssue = issues.some((iss) =>
                      iss.field.startsWith(`equipment.${container}.${index}.`),
                    )
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setEditing({ kind: 'equipment', container, index })}
                        aria-label={`${t(groupKey)} ${i + 1}`}
                        data-testid={`plr-edit-equip-${container}-${index}`}
                        className={cn(
                          'relative flex size-9 items-center justify-center rounded border transition-colors',
                          slotIssue
                            ? 'border-destructive'
                            : 'border-muted-foreground/40 bg-muted/20 hover:border-foreground/60 hover:bg-muted/50',
                        )}
                      >
                        {def ? (
                          <ItemIcon item={def} atlas={dataset.atlas} size={30} />
                        ) : (
                          <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3 pt-4">
          <Collapsible open={openStorage} onOpenChange={setOpenStorage}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 text-left"
                data-testid="plr-edit-storage-toggle"
              >
                <h3 className="text-sm font-medium">{t('save.edit.storageTitle')}</h3>
                <span className="text-2xs text-muted-foreground tabular-nums">
                  {countStorageItems(draft)}
                </span>
                <span className="ml-auto text-2xs text-muted-foreground">
                  {openStorage ? t('save.edit.collapse') : t('save.edit.expand')}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 flex flex-col gap-3" data-testid="plr-edit-storage">
            {STORAGE_EDIT_GROUPS.map(({ container, groupKey }) => (
              <div key={container} className="flex flex-col gap-1">
                <span className="text-2xs text-muted-foreground">{t(groupKey)}</span>
                <div className="grid grid-cols-10 gap-1" style={{ maxWidth: 420 }}>
                  {Array.from({ length: 40 }, (_, index) => {
                    const item = draft.storage[container]?.[index]
                    const def = item && item.id > 0 ? dataset.itemsById.get(item.id) : undefined
                    const slotIssue = issues.some((iss) =>
                      iss.field.startsWith(`storage.${container}.${index}.`),
                    )
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setEditing({ kind: 'storage', container, index })}
                        aria-label={`${t(groupKey)} ${index + 1}`}
                        data-testid={`plr-edit-storage-${container}-${index}`}
                        className={cn(
                          'relative flex size-9 items-center justify-center rounded border transition-colors',
                          slotIssue
                            ? 'border-destructive'
                            : 'border-muted-foreground/40 bg-muted/20 hover:border-foreground/60 hover:bg-muted/50',
                        )}
                      >
                        {def ? (
                          <>
                            <ItemIcon item={def} atlas={dataset.atlas} size={30} />
                            {item.stack > 1 && (
                              <span className="absolute right-0.5 bottom-0 text-2xs font-bold text-white tabular-nums [text-shadow:0_0_2px_#000]">
                                {item.stack}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardBody>
      </Card>

      {Object.keys(draft.loadouts).length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-3 pt-4">
            <Collapsible open={openLoadouts} onOpenChange={setOpenLoadouts}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 text-left"
                  data-testid="plr-edit-loadouts-toggle"
                >
                  <h3 className="text-sm font-medium">{t('save.edit.loadoutsTitle')}</h3>
                  <span className="ml-auto text-2xs text-muted-foreground">
                    {openLoadouts ? t('save.edit.collapse') : t('save.edit.expand')}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 flex flex-col gap-4" data-testid="plr-edit-loadouts">
              {LOADOUT_KEYS.map((loadoutKey, loadout) => {
                const groups = draft.loadouts[loadout]
                if (!groups) return null
                return (
                  <div key={loadoutKey} className="flex flex-col gap-1">
                    <span className="text-2xs text-muted-foreground">{t(loadoutKey)}</span>
                    {(['armor', 'dye'] as const).map((group) => {
                      const count = group === 'armor' ? 20 : 10
                      return (
                        <div key={group} className="flex flex-col gap-1">
                          <span className="text-2xs text-muted-foreground">
                            {group === 'armor'
                              ? `${t('players.group.armor')} / ${t('players.group.vanity')}`
                              : t('players.group.dye')}
                          </span>
                          <div className="grid grid-cols-10 gap-1" style={{ maxWidth: 420 }}>
                            {Array.from({ length: count }, (_, index) => {
                              const item = groups[group][index]
                              const def = item && item.id > 0 ? dataset.itemsById.get(item.id) : undefined
                              const slotIssue = issues.some((iss) =>
                                iss.field.startsWith(`loadouts.${loadout}.${group}.${index}.`),
                              )
                              return (
                                <button
                                  key={index}
                                  type="button"
                                  onClick={() => setEditing({ kind: 'loadout', loadout, group, index })}
                                  aria-label={`${t(loadoutKey)} ${group} ${index + 1}`}
                                  data-testid={`plr-edit-loadout-${loadout}-${group}-${index}`}
                                  className={cn(
                                    'relative flex size-9 items-center justify-center rounded border transition-colors',
                                    slotIssue
                                      ? 'border-destructive'
                                      : 'border-muted-foreground/40 bg-muted/20 hover:border-foreground/60 hover:bg-muted/50',
                                  )}
                                >
                                  {def ? (
                                    <>
                                      <ItemIcon item={def} atlas={dataset.atlas} size={30} />
                                      {item.stack > 1 && (
                                        <span className="absolute right-0.5 bottom-0 text-2xs font-bold text-white tabular-nums [text-shadow:0_0_2px_#000]">
                                          {item.stack}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  )
                })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardBody>
        </Card>
      )}

      {editing && (
        <PlrItemEditor
          open
          mode={editing.kind === 'equipment' ? 'equipment' : 'inventory'}
          slot={editing.kind === 'inventory' ? editing.slot : editing.index}
          title={
            editing.kind === 'inventory'
              ? t('save.edit.item.title', { slot: editing.slot + 1 })
              : editing.kind === 'equipment'
                ? `${t(
                    EQUIP_EDIT_COLUMNS.find((c) => c.container === editing.container && c.offset === 0)?.groupKey ??
                      'players.group.armor',
                  )} ${editing.index + 1}`
                : editing.kind === 'storage'
                  ? `${t(STORAGE_EDIT_GROUPS.find((g) => g.container === editing.container)?.groupKey ?? 'players.group.piggy')} ${
                      editing.index + 1
                    }`
                  : `${t(LOADOUT_KEYS[editing.loadout] ?? 'players.group.armor')} ${
                      editing.group === 'armor' ? t('players.group.armor') : t('players.group.dye')
                    } ${editing.index + 1}`
          }
          item={
            (editing.kind === 'inventory'
              ? draft.inventory[editing.slot]
              : editing.kind === 'equipment'
                ? draft.equipment[editing.container]?.[editing.index]
                : editing.kind === 'storage'
                  ? draft.storage[editing.container]?.[editing.index]
                  : draft.loadouts[editing.loadout]?.[editing.group]?.[editing.index]) ?? { id: 0, stack: 0, prefix: 0 }
          }
          dataset={dataset}
          limits={limits}
          onClose={() => setEditing(null)}
          onConfirm={(next: PlrItemEdit) => {
            if (editing.kind === 'inventory') {
              onChange({ ...draft, inventory: { ...draft.inventory, [editing.slot]: next } })
              return
            }
            if (editing.kind === 'loadout') {
              const { loadout, group } = editing
              const current = draft.loadouts[loadout] ?? { armor: {}, dye: {} }
              onChange({
                ...draft,
                loadouts: {
                  ...draft.loadouts,
                  [loadout]: { ...current, [group]: { ...current[group], [editing.index]: next } },
                },
              })
              return
            }
            if (editing.kind === 'storage') {
              const container = editing.container
              onChange({
                ...draft,
                storage: {
                  ...draft.storage,
                  [container]: { ...draft.storage[container], [editing.index]: next },
                },
              })
              return
            }
            const container = editing.container
            onChange({
              ...draft,
              equipment: {
                ...draft.equipment,
                [container]: { ...draft.equipment[container], [editing.index]: { ...next, stack: 0 } },
              },
            })
          }}
        />
      )}
    </div>
  )
}
