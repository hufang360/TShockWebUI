import type { LocalizationBundle } from '@/types'

/**
 * 物品提示的**运行期重算**（材质包生效时用）。
 *
 * 规则逐条复刻 `tools/gen-item-stats.mjs` 的 `composeTip()`（它复刻
 * `Terraria.Main.MouseText_DrawItemTooltip_GetLinesInfo()`）——
 * 数据里的 `item-tips.<culture>.json` 是构建期算好的同一结果；
 * 没有材质包时不走这里（用现成结果），有材质包时按合并后的本地化表重算。
 *
 * `itemTips.realdata.test.ts` 用全部 6195 件物品 × 中英两种语言做逐行比对，
 * 防止这里的规则与生成脚本漂移。
 */

const MAX_EXPAND = 4

/** `分类.key` → 值；没有分类前缀或不存在时返回 undefined。 */
function lookup(loc: LocalizationBundle, key: string): string | undefined {
  const dot = key.indexOf('.')
  if (dot < 0) return undefined
  return loc[key.slice(0, dot)]?.[key.slice(dot + 1)]
}

/**
 * 展开游戏本地化占位符（与生成脚本同一套规则）：
 * - `{$分类.key}`：最多 4 层，找不到按空串处理；
 * - `{InputTrigger_X}`：替换成固定展示名（`loc.InputTrigger`）。
 *
 * 值里的 `[c/...]` / `[i:...]` 标签原样保留，由渲染层解析。
 */
export function expandLocText(text: string, loc: LocalizationBundle): string {
  let cur = text
  for (let i = 0; i < MAX_EXPAND && /\{\$[^}]+\}/.test(cur); i += 1) {
    cur = cur.replace(/\{\$([^}]+)\}/g, (_, key: string) => lookup(loc, key) ?? '')
  }
  return cur.replace(/\{(InputTrigger_\w+)\}/g, (_, key: string) => loc.InputTrigger?.[key] ?? '')
}

function keyText(loc: LocalizationBundle, key: string): string | undefined {
  const raw = lookup(loc, key)
  return raw == null ? undefined : expandLocText(raw, loc)
}

export interface ItemTipInput {
  id: number
  /** 物品内部名（`ItemTooltip.<key>` 用）。 */
  key: string
  /** `data/item-stats.json` 的 `stats`（缺失字段按游戏默认值处理）。 */
  stats?: Record<string, number | boolean>
}

/**
 * 单件物品的提示行（不含物品名）。
 * 返回顺序与游戏 tooltip 一致，与 `item-tips.<culture>.json` 相同。
 * `itemNameById` 用于 `tileWand` 行拼接目标物品名（合并后的显示名）。
 */
export function composeItemTip(
  input: ItemTipInput,
  loc: LocalizationBundle,
  itemNameById: (id: number) => string | undefined,
): string[] {
  const s = input.stats ?? {}
  const num = (key: string, fallback = 0): number =>
    typeof s[key] === 'number' ? (s[key] as number) : fallback
  const has = (key: string): boolean => s[key] === true

  const out: string[] = []
  /** 整行来自一个本地化 key；key 缺失时整行省略。 */
  const pushText = (key: string, ...args: (string | number)[]) => {
    const text = keyText(loc, key)
    if (text == null) return
    out.push(args.length > 0 ? text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : text)
  }
  /** 数字 + 后缀 key：key 缺失时保留数字（游戏同样保留）。 */
  const pushSuffix = (pre: string | number, key: string) => {
    const text = keyText(loc, key)
    out.push(`${pre}${text ?? ''}`)
  }

  const itemName = (id: number): string => itemNameById(id) ?? ''

  if (has('social') && !has('vanity') && !has('hasVanityEffects')) pushText('LegacyTooltip.61')

  // 金币（71–74）只在背包里有 CoinGun(905) 时才显示伤害/暴击/速度/击退行；
  // 图鉴没有玩家上下文，按「没有 Coin Gun」的默认行为隐藏（Main.cs:20873）。
  const coinNeedsCoinGun = input.id >= 71 && input.id <= 74
  const useStyle = num('useStyle')
  if (num('damage') > 0 && (!has('notAmmo') || useStyle !== 0) && !coinNeedsCoinGun) {
    const dmg = Math.trunc(num('damage') * num('tooltipDamageMultiplier', 1))
    const suffixKey = has('melee') ? 'LegacyTooltip.2' : has('ranged') ? 'LegacyTooltip.3'
      : has('magic') ? 'LegacyTooltip.4' : has('summon') ? 'LegacyTooltip.53' : 'LegacyTooltip.55'
    pushSuffix(dmg, suffixKey)
    if (has('melee') || has('ranged') || has('magic')) pushSuffix(4 + num('crit'), 'LegacyTooltip.5')
    const a = num('useAnimation')
    const speedKey = a <= 8 ? SPEED_TIP[0] : a <= 20 ? SPEED_TIP[1] : a <= 25 ? SPEED_TIP[2]
      : a <= 30 ? SPEED_TIP[3] : a <= 35 ? SPEED_TIP[4] : a <= 45 ? SPEED_TIP[5]
        : a <= 55 ? SPEED_TIP[6] : SPEED_TIP[7]
    if (useStyle !== 0 && (!has('summon') || has('whip'))) pushText(speedKey)
    const kb = num('knockBack')
    const kbKey = kb === 0 ? KB_TIP[0] : kb <= 1.5 ? KB_TIP[1] : kb <= 3 ? KB_TIP[2]
      : kb <= 4 ? KB_TIP[3] : kb <= 6 ? KB_TIP[4] : kb <= 7 ? KB_TIP[5]
        : kb <= 9 ? KB_TIP[6] : kb <= 11 ? KB_TIP[7] : KB_TIP[8]
    pushText(kbKey)
  }

  if (num('fishingPole') > 0) {
    pushText('GameUI.PrecentFishingPower', num('fishingPole'))
    pushText('GameUI.BaitRequired')
  }
  if (num('bait') > 0) pushText('GameUI.BaitPower', num('bait'))

  const isPet = has('pet')
  const equippable = num('headSlot') > 0 || num('bodySlot') > 0 || num('legSlot') > 0 || has('accessory') ||
    has('hook') || num('mountType', -1) !== -1 || isPet
  if (equippable) pushText('LegacyTooltip.23')

  if (num('tileWand') > 0) {
    const prefix = keyText(loc, 'LegacyTooltip.52') ?? ''
    out.push(`${prefix}${itemName(num('tileWand'))}`)
  }
  if (has('questItem')) pushText('LegacyInterface.65')
  if (has('vanity')) pushText('LegacyTooltip.24')
  if (num('defense') > 0) pushSuffix(num('defense'), 'LegacyTooltip.25')
  if (num('pick') > 0) pushSuffix(num('pick'), 'LegacyTooltip.26')
  if (num('axe') > 0) pushSuffix(num('axe') * 5, 'LegacyTooltip.27')
  if (num('hammer') > 0) pushSuffix(num('hammer'), 'LegacyTooltip.28')
  if (num('tileBoost') !== 0) {
    const v = num('tileBoost')
    pushSuffix(`${v > 0 ? '+' : ''}${v}`, 'LegacyTooltip.54')
  }
  if (num('healLife') > 0) {
    if (input.id === 3001) pushText('CommonItemTooltip.RestoresLifeRange', num('healLife'), 120)
    else pushText('CommonItemTooltip.RestoresLife', num('healLife'))
  }
  if (num('healMana') > 0) pushText('CommonItemTooltip.RestoresMana', num('healMana'))
  if (num('buffType') > 0 && !has('summon') && !isPet) pushText('CommonItemTooltip.Buffs')
  else if (num('healLife') > 0) pushText('CommonItemTooltip.Healing')
  else if (num('healMana') > 0) pushText('CommonItemTooltip.ManaHealing')
  else if (num('mountType', -1) > 0 && !has('mountCart')) pushText('CommonItemTooltip.Mount')
  if (num('mana') > 0) pushText('CommonItemTooltip.UsesMana', num('mana'))

  const createTile = num('createTile', -1)
  const placeable = num('createWall') > 0 || createTile > -1 || input.id === 849
  if (placeable) {
    if (has('placeTileOnAltUse') || has('consumable')) pushText('LegacyTooltip.33')
  } else if (num('ammo') > 0 && !has('notAmmo')) {
    pushText('LegacyTooltip.34')
  } else if (has('consumable') && !has('chlorophyteExtractinatorConsumable')) {
    pushText('LegacyTooltip.35')
  }
  if (has('material')) pushText('LegacyTooltip.36')
  if (has('wireable')) pushText('CommonItemTooltip.Wireable')
  if (has('container')) pushText('CommonItemTooltip.Container')
  if (has('wireTrigger')) pushText('CommonItemTooltip.WireTrigger')

  // 物品独有文案 ItemTooltip.<内部名>（可用 \n 分行）
  const custom = keyText(loc, `ItemTooltip.${input.key}`)
  if (custom != null) for (const line of custom.split('\n')) out.push(line)

  if (num('buffTime') > 0) {
    const seconds = Math.round(num('buffTime') / 60)
    if (num('buffTime') / 60 < 60) pushText('CommonItemTooltip.SecondDuration', seconds)
    else pushText('CommonItemTooltip.MinuteDuration', Math.round(seconds / 60))
  }
  if (has('expert')) pushText('GameUI.Expert')
  if (num('rare') === -13) pushText('GameUI.Master')

  return out
}

const SPEED_TIP = ['LegacyTooltip.6', 'LegacyTooltip.7', 'LegacyTooltip.8', 'LegacyTooltip.9',
  'LegacyTooltip.10', 'LegacyTooltip.11', 'LegacyTooltip.12', 'LegacyTooltip.13']
const KB_TIP = ['LegacyTooltip.14', 'LegacyTooltip.15', 'LegacyTooltip.16', 'LegacyTooltip.17',
  'LegacyTooltip.18', 'LegacyTooltip.19', 'LegacyTooltip.20', 'LegacyTooltip.21', 'LegacyTooltip.22']
