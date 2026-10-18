import type { PrefixMods } from '@/types'

/**
 * 物品「最佳词缀」推导 —— 直接采用游戏自身的评分，而不是我们自己拍脑袋。
 *
 * 事实来源：`Terraria/Item.cs`
 *   - `TryGetPrefixStatMultipliersForItem()` 末尾的 `value` 公式（`tools/gen-prefix-mods.mjs`
 *     已把它算成 `prefix-mods.json` 里每个词缀的 `val`）；
 *   - `Item.BestPrefixValue()` = 该物品所有**可滚且有效**词缀里最大的 `val`；
 *   - `Item.Prefix()` 里 `rolledPrefixIsTopTier = (val == BestPrefixValue())`。
 * 所以「最佳词缀」= 评分等于最大值的词缀，**可以并列多个**（比如饰品顶级词缀
 * 护佑 / 幸运 / 险恶 / 迅捷 / 暴力 的 `val` 都是 1.2）。
 *
 * `val` 与物品无关；但「这个物品能不能滚这个词缀」与物品有关，见 `isPrefixValid`。
 */

export interface PrefixRank {
  id: number
  /** 游戏自身的词缀评分（越大越好）。 */
  val: number
}

/** 饰品词缀的展示文本（如「+4%伤害」「+20 魔力」）。魔力行游戏里带一个空格，其余没有。 */
export function formatBenefit(
  benefit: NonNullable<PrefixMods['benefit']>,
  t: (key: string) => string,
): string {
  const label = t(`prefix.stat.${benefit.key}`)
  return benefit.key === 'mana' ? `+${benefit.value} ${label}` : `+${benefit.value}${label}`
}

/** 词缀「变化行」：tone=up 用游戏绿（120,190,120），down 用现成红（190,120,120）。 */
export interface PrefixDelta {
  text: string
  tone: 'up' | 'down'
}

/**
 * 词缀相对未附词缀物品的**变化行**，还原游戏 `Main.MouseText_DrawItemTooltip_GetLinesInfo`
 * 里 `if (item.prefix > 0)` 的比较块：如「+15%伤害」「-10%速度」「+4%暴击率」。
 * 饰品词缀（62–80）不走这些，直接给一行绿色效果（如「险恶」→「+4%伤害」）。
 * 只有真正改变了的属性才出一行（与游戏一致）。
 */
export function prefixDeltaLines(
  stats: Record<string, number | boolean> | undefined,
  mods: PrefixMods | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): PrefixDelta[] {
  if (!mods) return []
  const s = stats ?? {}
  const out: PrefixDelta[] = []
  /** goodWhenPositive=false 用于「蓝耗」这种降反而好的。 */
  const add = (value: number, key: string, goodWhenPositive = true) => {
    if (!Number.isFinite(value) || value === 0) return
    const good = goodWhenPositive ? value > 0 : value < 0
    out.push({
      text: `${value > 0 ? '+' : ''}${value}${t(`prefix.delta.${key}`)}`,
      tone: good ? 'up' : 'down',
    })
  }

  const dmg = mods.dmg ?? 1
  const baseDamage = num(s.damage)
  if (dmg !== 1 && baseDamage > 0) {
    const nv = roundHalfEven(baseDamage * dmg)
    add(Math.round(((nv - baseDamage) / baseDamage) * 100), 'damage')
  }
  const spd = mods.spd ?? 1
  const baseAnim = num(s.useAnimation)
  if (spd !== 1 && baseAnim > 0) {
    const nv = roundHalfEven(baseAnim * spd)
    // 攻速：变化率取反（更快 = +）；与游戏一致
    add(-Math.round(((nv - baseAnim) / baseAnim) * 100), 'speed')
  }
  if (mods.crt) add(mods.crt, 'crit')
  const mcst = mods.mcst ?? 1
  const baseMana = num(s.mana)
  if (mcst !== 1 && baseMana > 0) {
    const nv = roundHalfEven(baseMana * mcst)
    add(Math.round(((nv - baseMana) / baseMana) * 100), 'mana', false)
  }
  if (mods.size != null && mods.size !== 1) add(Math.round((mods.size - 1) * 100), 'size')
  const baseShootSpeed = num(s.shootSpeed)
  if (mods.shtspd != null && mods.shtspd !== 1 && baseShootSpeed > 0) {
    add(Math.round((mods.shtspd - 1) * 100), 'shootSpeed')
  }
  if (mods.kb != null && mods.kb !== 1 && num(s.knockBack) > 0) {
    add(Math.round((mods.kb - 1) * 100), 'knockback')
  }
  if (mods.arpen) {
    out.push({
      text: t('prefix.delta.armorPen', { v: `${mods.arpen > 0 ? '+' : ''}${mods.arpen}` }),
      tone: mods.arpen > 0 ? 'up' : 'down',
    })
  }
  if (mods.tagdmg) {
    out.push({
      text: t('prefix.delta.tagDamage', { v: `${mods.tagdmg > 0 ? '+' : ''}${mods.tagdmg}` }),
      tone: mods.tagdmg > 0 ? 'up' : 'down',
    })
  }
  if (mods.benefit) out.push({ text: formatBenefit(mods.benefit, t), tone: 'up' })
  return out
}

const num = (v: number | boolean | undefined): number => (typeof v === 'number' ? v : 0)

/**
 * C# `Math.Round(double)` 的「四舍六入五成双」（银行家舍入）。
 * JS `Math.round` 是「四舍五入」，在正好 .5 时与游戏不同（如 `12 * 0.9` 这种
 * 恰为 `4.5` 的乘积会让词缀被误判“无效”，见下方的 8 件魔法武器）。
 */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * 复刻 `TryGetPrefixStatMultipliersForItem()` 末尾的 4 个「该词缀对这个物品无效果 → 无效」判定：
 * 伤害/攻速/蓝耗四舍五入后没变化、或击退本为 0 却给了击退倍率。
 */
export function isPrefixValid(
  stats: Record<string, number | boolean> | undefined,
  mods: PrefixMods | undefined,
): boolean {
  if (!mods) return true
  // 没有物品属性数据时无法判定（测试替身 / 缺数据），不因「看不出变化」而丢弃。
  if (!stats) return true
  const damage = num(stats?.damage)
  const useAnimation = num(stats?.useAnimation)
  const mana = num(stats?.mana)
  const knockBack = num(stats?.knockBack)
  if (mods.dmg != null && mods.dmg !== 1 && roundHalfEven(damage * mods.dmg) === damage) return false
  if (mods.spd != null && mods.spd !== 1 && roundHalfEven(useAnimation * mods.spd) === useAnimation) {
    return false
  }
  if (mods.mcst != null && mods.mcst !== 1 && roundHalfEven(mana * mods.mcst) === mana) return false
  if (mods.kb != null && mods.kb !== 1 && knockBack === 0) return false
  return true
}

/** 把「该物品可滚的词缀」按游戏评分从高到低排序；无效词缀丢弃。 */
export function rankPrefixes(
  prefixIds: readonly number[],
  prefixModsById: ReadonlyMap<number, PrefixMods>,
  stats: Record<string, number | boolean> | undefined,
): PrefixRank[] {
  const out: PrefixRank[] = []
  for (const id of prefixIds) {
    const mods = prefixModsById.get(id)
    if (!isPrefixValid(stats, mods)) continue
    // 旧缓存 / 测试替身缺少 val 时当 0（仍出现在下拉里，只是不参与「最佳」）。
    const val = typeof mods?.val === 'number' ? mods.val : 0
    out.push({ id, val })
  }
  out.sort((a, b) => b.val - a.val || a.id - b.id)
  return out
}

/** 评分最高的词缀 id 列表（并列即「多个最佳」）；无法重铸 / 无评分时返回空。 */
export function bestPrefixIds(
  prefixIds: readonly number[],
  prefixModsById: ReadonlyMap<number, PrefixMods>,
  stats: Record<string, number | boolean> | undefined,
): number[] {
  const ranked = rankPrefixes(prefixIds, prefixModsById, stats).filter((p) => p.val > 0)
  if (ranked.length === 0) return []
  const max = ranked[0]!.val
  return ranked.filter((p) => p.val === max).map((p) => p.id)
}
