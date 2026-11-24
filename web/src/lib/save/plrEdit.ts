/**
 * `.plr` 编辑的**纯逻辑**：草稿 ↔ 校验 ↔ 差异补丁。
 *
 * 校验口径与游戏加载存档时的一致性检查一一对应（见 `docs/计划-plr编辑.md` §4）：
 * - `Player.Deserialize`：`statLifeMax ≤ 500`、`statManaMax ≤ 200`、`statMana ≤ 400`
 *   （超出部分游戏会截断，所以这里直接拦）。
 * - `Item.FixAgainstExploit()`：`stack ≤ maxStack`、词缀必须 ∈ `Item.GetRollablePrefixes()`
 *   （= `data/prefix-sets.json`）、`ItemID.Sets.ItemsThatShouldNotBeInInventory` 里的物品会被变成空气。
 * - `release`：同一布局段内直接改数字；跨段走版本转换（`plrConvert.ts`）——
 *   往高插入目标版本多出来的字段，往低删掉目标版本没有的字段（丢的是那些内容本身，UI 会提示）。
 * - 标量数值（生命 / 魔力 / 渔夫 / Golf…）只校验**用户改过的**：存档里原本就可能超出原版上限
 *   （SSC 服务器给过额外生命），原样保留不该让整份存档存不出去。
 */
import {
  type PlrBoostField,
  type PlrEquipContainer,
  type PlrPlayer,
  type PlrStorageContainer,
  type PlrTrack,
} from './plr'
import { checkPlrConvert } from './plrConvert'
import type { PlrEdits, PlrItemEdit } from './plrWrite'

/** 存档里能写死的硬上限（与游戏一致）。 */
export const PLR_LIMITS = {
  lifeMax: 500,
  manaMax: 200,
  /** `statMana` 的值上限（游戏允许临时超过上限到 400）。 */
  manaValueMax: 400,
  anglerMax: 9999,
} as const

/** 编辑草稿：所有可编辑字段的**目标值**（未改的也会带着原值）。 */
export interface PlrEditDraft {
  statLife: number
  statLifeMax: number
  statMana: number
  statManaMax: number
  anglerQuests: number
  golferScore: number
  difficulty: number
  release: number
  boosts: Partial<Record<PlrBoostField, boolean>>
  superCart: { unlocked: boolean; enabled: boolean }
  /** 背包 58 格的目标状态（下标 = `.plr` 的 inventory 下标）。 */
  inventory: Record<number, PlrItemEdit>
  /** 装备区（键 = 容器；值 = 该容器内下标 → 目标物品）。这几组没有 stack（写回时忽略）。 */
  equipment: Record<PlrEquipContainer, Record<number, PlrItemEdit>>
  /** 随身仓储（猪猪 / 保险箱 / 熔炉 / 虚空袋）：结构同背包。 */
  storage: Record<PlrStorageContainer, Record<number, PlrItemEdit>>
  /** 三套配装（键 = 配装下标，0–2）：`armor` 20 格 / `dye` 10 格，结构同背包。 */
  loadouts: Record<number, { armor: Record<number, PlrItemEdit>; dye: Record<number, PlrItemEdit> }>
}

/** 校验时按「只查改动」处理的标量字段（`PlrPlayer` 上同名的就是存档原值）。 */
type PlrScalarField =
  | 'statLife'
  | 'statLifeMax'
  | 'statMana'
  | 'statManaMax'
  | 'anglerQuests'
  | 'golferScore'
  | 'difficulty'

/** 物品校验需要的最小目录（UI 用 dataset + `data/item-limits.json` 适配；测试里可以给假数据）。 */
export interface PlrItemCatalog {
  hasItem(id: number): boolean
  maxStack(id: number): number | undefined
  blocked(id: number): boolean
  /** 该物品可滚的词缀；`undefined`/空数组 = 不能上词缀。 */
  prefixes(id: number): readonly number[] | undefined
}

/** 校验结果：`field` 是 UI 定位用的键（`statLife` / `inventory.3.stack` …）。 */
export interface PlrEditIssue {
  field: string
  messageKey: string
  vars?: Record<string, string | number>
}

/** 从解析结果生成草稿。 */
export function draftFromPlayer(p: PlrPlayer, track: PlrTrack): PlrEditDraft {
  const inventory: Record<number, PlrItemEdit> = {}
  p.inventory.forEach((item, i) => {
    inventory[i] = { id: item.id, stack: item.stack, prefix: item.prefix }
  })
  const boosts: Partial<Record<PlrBoostField, boolean>> = {}
  for (const key of Object.keys(track.boosts) as PlrBoostField[]) {
    boosts[key] = p[key] as boolean
  }
  return {
    statLife: p.statLife,
    statLifeMax: p.statLifeMax,
    statMana: p.statMana,
    statManaMax: p.statManaMax,
    anglerQuests: p.anglerQuests,
    golferScore: p.golferScore,
    difficulty: p.difficulty,
    release: p.release,
    boosts,
    superCart: { unlocked: p.unlockedSuperCart, enabled: p.enabledSuperCart },
    inventory,
    equipment: {
      armor: itemsToEdits(p.armor),
      dye: itemsToEdits(p.dye),
      miscEquips: itemsToEdits(p.miscEquips),
      miscDyes: itemsToEdits(p.miscDyes),
    },
    storage: {
      piggyBank: itemsToEdits(p.piggyBank),
      safe: itemsToEdits(p.safe),
      forge: itemsToEdits(p.forge),
      voidVault: itemsToEdits(p.voidVault),
    },
    loadouts: Object.fromEntries(
      p.loadouts.map((loadout, i) => [
        i,
        { armor: itemsToEdits(loadout.armor), dye: itemsToEdits(loadout.dye) },
      ]),
    ),
  }
}

/**
 * 装备区一组物品 → 草稿。
 *
 * 这几组在文件里**没有 stack 字段**（`readItemEquip` 读出来是 0，`normalize` 再把有物品的格子补成 1），
 * 所以草稿里的 `stack` 只是跟随解析值，写回与校验都**不看它**。
 */
function itemsToEdits(items: { id: number; stack: number; prefix: number }[]): Record<number, PlrItemEdit> {
  const out: Record<number, PlrItemEdit> = {}
  items.forEach((item, i) => {
    out[i] = { id: item.id, stack: item.stack, prefix: item.prefix }
  })
  return out
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/**
 * 校验草稿。返回空数组 = 可以保存。
 *
 * 所有数值都要求整数（存档里是 int32），并对超出游戏上限的值给出具体原因，
 * 避免「写进去被游戏静默截断」。
 */
export function validatePlrDraft(
  draft: PlrEditDraft,
  ctx: { catalog: PlrItemCatalog; original: PlrPlayer; track?: PlrTrack },
): PlrEditIssue[] {
  const issues: PlrEditIssue[] = []
  const { catalog, original } = ctx
  const num = (field: keyof PlrEditDraft, value: number, min: number, max: number) => {
    if (!isInt(value)) {
      issues.push({ field, messageKey: 'save.edit.err.int' })
      return false
    }
    if (value < min || value > max) {
      issues.push({ field, messageKey: 'save.edit.err.range', vars: { min, max } })
      return false
    }
    return true
  }

  /**
   * 标量字段只在**用户改过**时校验：真实存档（尤其 SSC / 插件给过额外生命的服）里
   * 本来就可能有超过原版上限的值（实测生命 600 / 1000 / 30000），原样保留不该让
   * 整份存档都存不出去 —— 与物品槽位「只校验改过的格子」是同一口径。
   */
  const scalar = (field: PlrScalarField, min: number, max: number) => {
    if ((draft[field] as number) === (original[field] as number)) return false
    return num(field, draft[field] as number, min, max)
  }
  const lifeMaxChanged = scalar('statLifeMax', 0, PLR_LIMITS.lifeMax)
  const lifeChanged = scalar('statLife', 0, PLR_LIMITS.lifeMax)
  // 关系检查也只看改动：存档原本就是 1000 生命 / 500 上限（游戏读的时候会夹上限），不该报错。
  if ((lifeChanged || lifeMaxChanged) && draft.statLife > draft.statLifeMax) {
    issues.push({ field: 'statLife', messageKey: 'save.edit.err.lifeOverMax' })
  }
  scalar('statManaMax', 0, PLR_LIMITS.manaMax)
  scalar('statMana', 0, PLR_LIMITS.manaValueMax)
  scalar('anglerQuests', 0, PLR_LIMITS.anglerMax)
  scalar('golferScore', 0, 2_147_483_647)
  scalar('difficulty', 0, 3)

  if (!isInt(draft.release)) {
    issues.push({ field: 'release', messageKey: 'save.edit.err.int' })
  } else if (draft.release !== original.release) {
    // 双向：往高走插入新字段，往低走删掉目标版本没有的字段（会丢内容，UI 负责提示）。
    const problem = checkPlrConvert(original.release, draft.release, ctx.track)
    if (problem === 'sourceTooOld') {
      issues.push({ field: 'release', messageKey: 'save.edit.err.releaseTooOld' })
    } else if (problem === 'targetTooOld') {
      issues.push({ field: 'release', messageKey: 'save.edit.err.releaseTargetTooOld' })
    } else if (problem === 'tooNew') {
      issues.push({ field: 'release', messageKey: 'save.edit.err.releaseTooNew' })
    } else if (problem === 'tailUnreadable') {
      issues.push({ field: 'release', messageKey: 'save.edit.err.releaseUnreadable' })
    } else if (problem === 'refundsPresent') {
      issues.push({ field: 'release', messageKey: 'save.edit.err.releaseRefunds' })
    }
  }

  for (const [key, item] of Object.entries(draft.inventory)) {
    const slot = Number(key)
    const prefix = `inventory.${slot}`
    // 只校验**改过**的槽位：玩家存档里原本就有历史遗留词缀（游戏自己会在加载时按当前规则重置），
    // 我们没动它就不该标红。
    const before = original.inventory[slot]
    if (
      before &&
      before.id === item.id &&
      before.stack === item.stack &&
      before.prefix === item.prefix
    ) {
      continue
    }
    if (!isInt(item.id) || !isInt(item.stack) || !isInt(item.prefix)) {
      issues.push({ field: `${prefix}.id`, messageKey: 'save.edit.err.int' })
      continue
    }
    if (item.id === 0) {
      if (item.stack !== 0 || item.prefix !== 0) {
        issues.push({ field: `${prefix}.stack`, messageKey: 'save.edit.err.emptySlot' })
      }
      continue
    }
    if (!catalog.hasItem(item.id)) {
      issues.push({ field: `${prefix}.id`, messageKey: 'save.edit.err.badItem', vars: { id: item.id } })
      continue
    }
    if (catalog.blocked(item.id)) {
      issues.push({ field: `${prefix}.id`, messageKey: 'save.edit.err.blockedItem' })
    }
    const max = catalog.maxStack(item.id)
    if (max != null) {
      if (item.stack < 1 || item.stack > max) {
        issues.push({
          field: `${prefix}.stack`,
          messageKey: 'save.edit.err.stackRange',
          vars: { max },
        })
      }
    } else if (item.stack < 1) {
      issues.push({ field: `${prefix}.stack`, messageKey: 'save.edit.err.stackRange', vars: { max: 1 } })
    }
    const allowed = catalog.prefixes(item.id) ?? []
    if (item.prefix !== 0 && !allowed.includes(item.prefix)) {
      issues.push({ field: `${prefix}.prefix`, messageKey: 'save.edit.err.badPrefix' })
    }
  }

  // 随身仓储（猪猪 / 保险箱 / 熔炉 / 虚空袋）：规则与背包完全一致（有 stack）
  for (const [container, slots] of Object.entries(draft.storage) as [
    PlrStorageContainer,
    Record<number, PlrItemEdit>,
  ][]) {
    const originalItems = original[container]
    for (const [key, item] of Object.entries(slots)) {
      const slot = Number(key)
      const field = `storage.${container}.${slot}`
      const before = originalItems[slot]
      if (before && before.id === item.id && before.stack === item.stack && before.prefix === item.prefix) {
        continue
      }
      if (!isInt(item.id) || !isInt(item.stack) || !isInt(item.prefix)) {
        issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.int' })
        continue
      }
      if (item.id === 0) {
        if (item.stack !== 0 || item.prefix !== 0) {
          issues.push({ field: `${field}.stack`, messageKey: 'save.edit.err.emptySlot' })
        }
        continue
      }
      if (!catalog.hasItem(item.id)) {
        issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.badItem', vars: { id: item.id } })
        continue
      }
      if (catalog.blocked(item.id)) {
        issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.blockedItem' })
      }
      const max = catalog.maxStack(item.id)
      if (max != null) {
        if (item.stack < 1 || item.stack > max) {
          issues.push({ field: `${field}.stack`, messageKey: 'save.edit.err.stackRange', vars: { max } })
        }
      } else if (item.stack < 1) {
        issues.push({ field: `${field}.stack`, messageKey: 'save.edit.err.stackRange', vars: { max: 1 } })
      }
      const allowed = catalog.prefixes(item.id) ?? []
      if (item.prefix !== 0 && !allowed.includes(item.prefix)) {
        issues.push({ field: `${field}.prefix`, messageKey: 'save.edit.err.badPrefix' })
      }
    }
  }

  // 三套配装：规则与背包一致（有 stack），只校验改过的格子
  for (const [key, groups] of Object.entries(draft.loadouts)) {
    const originalLoadout = original.loadouts[Number(key)]
    if (!originalLoadout) continue
    for (const group of ['armor', 'dye'] as const) {
      const originalItems = originalLoadout[group]
      for (const [slotKey, item] of Object.entries(groups[group])) {
        const slot = Number(slotKey)
        const field = `loadouts.${Number(key)}.${group}.${slot}`
        const before = originalItems[slot]
        if (before && before.id === item.id && before.stack === item.stack && before.prefix === item.prefix) {
          continue
        }
        if (!isInt(item.id) || !isInt(item.stack) || !isInt(item.prefix)) {
          issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.int' })
          continue
        }
        if (item.id === 0) {
          if (item.stack !== 0 || item.prefix !== 0) {
            issues.push({ field: `${field}.stack`, messageKey: 'save.edit.err.emptySlot' })
          }
          continue
        }
        if (!catalog.hasItem(item.id)) {
          issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.badItem', vars: { id: item.id } })
          continue
        }
        if (catalog.blocked(item.id)) {
          issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.blockedItem' })
        }
        const max = catalog.maxStack(item.id)
        if (max != null) {
          if (item.stack < 1 || item.stack > max) {
            issues.push({ field: `${field}.stack`, messageKey: 'save.edit.err.stackRange', vars: { max } })
          }
        } else if (item.stack < 1) {
          issues.push({ field: `${field}.stack`, messageKey: 'save.edit.err.stackRange', vars: { max: 1 } })
        }
        const allowed = catalog.prefixes(item.id) ?? []
        if (item.prefix !== 0 && !allowed.includes(item.prefix)) {
          issues.push({ field: `${field}.prefix`, messageKey: 'save.edit.err.badPrefix' })
        }
      }
    }
  }

  // 装备区（装备 / 时装 / 染料 / 杂项）：规则与背包一致，但这几组**没有 stack**，
  // 所以只校验 id 与词缀；数量输入在界面上是禁用的。
  for (const [container, slots] of Object.entries(draft.equipment) as [
    PlrEquipContainer,
    Record<number, PlrItemEdit>,
  ][]) {
    const originalItems = containerItems(original, container)
    for (const [key, item] of Object.entries(slots)) {
      const slot = Number(key)
      const field = `equipment.${container}.${slot}`
      const before = originalItems[slot]
      if (before && before.id === item.id && before.prefix === item.prefix) continue
      if (!isInt(item.id) || !isInt(item.prefix)) {
        issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.int' })
        continue
      }
      if (item.id === 0) {
        if (item.prefix !== 0) {
          issues.push({ field: `${field}.prefix`, messageKey: 'save.edit.err.emptySlot' })
        }
        continue
      }
      if (!catalog.hasItem(item.id)) {
        issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.badItem', vars: { id: item.id } })
        continue
      }
      if (catalog.blocked(item.id)) {
        issues.push({ field: `${field}.id`, messageKey: 'save.edit.err.blockedItem' })
      }
      const allowed = catalog.prefixes(item.id) ?? []
      if (item.prefix !== 0 && !allowed.includes(item.prefix)) {
        issues.push({ field: `${field}.prefix`, messageKey: 'save.edit.err.badPrefix' })
      }
    }
  }

  return issues
}

/** 取原存档里某个装备容器的物品数组。 */
function containerItems(player: PlrPlayer, container: PlrEquipContainer): { id: number; prefix: number }[] {
  return player[container]
}

/** 草稿 → 只包含**真正变化**的补丁（没改的字段不进补丁，写回时就不会碰它们）。 */
export function buildPlrEdits(original: PlrPlayer, track: PlrTrack, draft: PlrEditDraft): PlrEdits {
  const edits: PlrEdits = {}

  if (draft.release !== original.release) edits.release = draft.release
  if (draft.difficulty !== original.difficulty) edits.difficulty = draft.difficulty
  if (draft.statLife !== original.statLife) edits.statLife = draft.statLife
  if (draft.statLifeMax !== original.statLifeMax) edits.statLifeMax = draft.statLifeMax
  if (draft.statMana !== original.statMana) edits.statMana = draft.statMana
  if (draft.statManaMax !== original.statManaMax) edits.statManaMax = draft.statManaMax
  if (draft.anglerQuests !== original.anglerQuests) edits.anglerQuests = draft.anglerQuests
  if (draft.golferScore !== original.golferScore) edits.golferScore = draft.golferScore

  const boosts: Partial<Record<PlrBoostField, boolean>> = {}
  for (const key of Object.keys(track.boosts) as PlrBoostField[]) {
    const next = draft.boosts[key]
    if (next != null && next !== (original[key] as boolean)) boosts[key] = next
  }
  if (Object.keys(boosts).length > 0) edits.boosts = boosts

  if (
    track.superCartBits != null &&
    (draft.superCart.unlocked !== original.unlockedSuperCart ||
      draft.superCart.enabled !== original.enabledSuperCart)
  ) {
    edits.superCart = { ...draft.superCart }
  }

  const inventory: Record<number, PlrItemEdit> = {}
  original.inventory.forEach((item, i) => {
    const next = draft.inventory[i]
    if (!next) return
    const cur = { id: item.id, stack: item.stack, prefix: item.prefix }
    if (next.id !== cur.id || next.stack !== cur.stack || next.prefix !== cur.prefix) {
      inventory[i] = { id: next.id, stack: next.stack, prefix: next.prefix }
    }
  })
  if (Object.keys(inventory).length > 0) edits.inventory = inventory

  // 装备区：只放真正变化的槽（没有 stack，比较 id + prefix）
  const equipment: Partial<Record<PlrEquipContainer, Record<number, PlrItemEdit>>> = {}
  for (const [container, slots] of Object.entries(draft.equipment) as [
    PlrEquipContainer,
    Record<number, PlrItemEdit>,
  ][]) {
    const originalItems = containerItems(original, container)
    const changed: Record<number, PlrItemEdit> = {}
    for (const [key, next] of Object.entries(slots)) {
      const slot = Number(key)
      const before = originalItems[slot]
      if (!before) continue
      if (before.id !== next.id || before.prefix !== next.prefix) {
        changed[slot] = { id: next.id, stack: 0, prefix: next.prefix }
      }
    }
    if (Object.keys(changed).length > 0) equipment[container] = changed
  }
  if (Object.keys(equipment).length > 0) edits.equipment = equipment

  // 随身仓储：比较 id + stack + prefix
  const storage: Partial<Record<PlrStorageContainer, Record<number, PlrItemEdit>>> = {}
  for (const [container, slots] of Object.entries(draft.storage) as [
    PlrStorageContainer,
    Record<number, PlrItemEdit>,
  ][]) {
    const originalItems = original[container]
    const changed: Record<number, PlrItemEdit> = {}
    for (const [key, next] of Object.entries(slots)) {
      const slot = Number(key)
      const before = originalItems[slot]
      if (!before) continue
      if (before.id !== next.id || before.stack !== next.stack || before.prefix !== next.prefix) {
        changed[slot] = { id: next.id, stack: next.stack, prefix: next.prefix }
      }
    }
    if (Object.keys(changed).length > 0) storage[container] = changed
  }
  if (Object.keys(storage).length > 0) edits.storage = storage

  // 三套配装
  const loadouts: NonNullable<PlrEdits['loadouts']> = {}
  for (const [key, groups] of Object.entries(draft.loadouts)) {
    const originalLoadout = original.loadouts[Number(key)]
    if (!originalLoadout) continue
    const changedGroups: { armor?: Record<number, PlrItemEdit>; dye?: Record<number, PlrItemEdit> } = {}
    for (const group of ['armor', 'dye'] as const) {
      const originalItems = originalLoadout[group]
      const changed: Record<number, PlrItemEdit> = {}
      for (const [slotKey, next] of Object.entries(groups[group])) {
        const slot = Number(slotKey)
        const before = originalItems[slot]
        if (!before) continue
        if (before.id !== next.id || before.stack !== next.stack || before.prefix !== next.prefix) {
          changed[slot] = { id: next.id, stack: next.stack, prefix: next.prefix }
        }
      }
      if (Object.keys(changed).length > 0) changedGroups[group] = changed
    }
    if (Object.keys(changedGroups).length > 0) loadouts[Number(key)] = changedGroups
  }
  if (Object.keys(loadouts).length > 0) edits.loadouts = loadouts

  return edits
}

/** 草稿是否与原始数据不同（UI 的「有未保存改动」判断）。 */
export function isDraftDirty(original: PlrPlayer, track: PlrTrack, draft: PlrEditDraft): boolean {
  return Object.keys(buildPlrEdits(original, track, draft)).length > 0
}
