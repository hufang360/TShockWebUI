/** 修饰语分组（wiki 的「通用 / 公共 / 近战 / 远程 / 魔法 / 召唤 / 配饰」小节）。 */
export const MODIFIER_GROUPS = [
  'accessory', 'weapon', 'common', 'melee', 'ranged', 'magic', 'summon',
] as const

export type ModifierGroupId = (typeof MODIFIER_GROUPS)[number]

/** 表头列（顺序即表格列顺序）；值见 `ModifierRow.stats`。 */
export const MODIFIER_STATS = [
  'dmg', 'speed', 'crit', 'mana', 'size', 'velocity', 'ap', 'tag', 'kb',
] as const

export type ModifierStatId = (typeof MODIFIER_STATS)[number]

/** 饰品词缀的精确效果（`data/prefix-mods.json` 的 `benefit`）；武器列放不下，单独一列。 */
export type ModifierBenefitId = 'defense' | 'mana' | 'crit' | 'damage' | 'moveSpeed' | 'meleeSpeed'

export interface ModifierRow {
  /** 词缀 id（前缀 id）。 */
  id: number
  /** 内部名；显示名走 dataset 的本地化（`loc.Prefix`）。 */
  key: string
  /** wiki 归属的小节；不在任何小节里的（Legendary2）只有「全部」能看到。 */
  groups: ModifierGroupId[]
  /** 各列显示值，空串 = 不适用（表里显示为 –）。 */
  stats: Partial<Record<ModifierStatId, string>>
  benefit?: { id: ModifierBenefitId; value: number }
  tier: string
  value: string
}

/** 数据来源：Terraria Wiki Modifiers（zh 修订 258113 / en 修订 1035983，抓取 2026-11-13）。 */
export const MODIFIER_ROWS: ModifierRow[] = [
  { id: 1, key: 'Large', groups: ['melee'], stats: { size: '+12%' }, tier: '+1', value: '+25.44%' },
  { id: 2, key: 'Massive', groups: ['melee'], stats: { size: '+18%' }, tier: '+1', value: '+39.24%' },
  { id: 3, key: 'Dangerous', groups: ['melee'], stats: { dmg: '+5%', crit: '+2%', size: '+5%' }, tier: '+1', value: '+31.47%' },
  { id: 4, key: 'Savage', groups: ['melee'], stats: { dmg: '+10%', size: '+10%', kb: '+10%' }, tier: '+2', value: '+77.16%' },
  { id: 5, key: 'Sharp', groups: ['melee'], stats: { dmg: '+15%' }, tier: '+1', value: '+32.25%' },
  { id: 6, key: 'Pointy', groups: ['melee'], stats: { dmg: '+10%' }, tier: '+1', value: '+21%' },
  { id: 7, key: 'Tiny', groups: ['melee'], stats: { size: '−18%' }, tier: '−1', value: '−32.76%' },
  { id: 8, key: 'Terrible', groups: ['melee'], stats: { dmg: '−15%', size: '−13%', kb: '−15%' }, tier: '−2', value: '−60.49%' },
  { id: 9, key: 'Small', groups: ['melee'], stats: { size: '−10%' }, tier: '−1', value: '−19%' },
  { id: 10, key: 'Dull', groups: ['melee'], stats: { dmg: '−15%' }, tier: '−1', value: '−27.75%' },
  { id: 11, key: 'Unhappy', groups: ['melee'], stats: { speed: '−10%', size: '−10%', kb: '−10%' }, tier: '−2', value: '−46.86%' },
  { id: 12, key: 'Bulky', groups: ['melee'], stats: { dmg: '+5%', speed: '−15%', size: '+10%', kb: '+10%' }, tier: '+1', value: '+16.62%' },
  { id: 13, key: 'Shameful', groups: ['melee'], stats: { dmg: '−10%', size: '+10%', kb: '−20%' }, tier: '−2', value: '−37.27%' },
  { id: 14, key: 'Heavy', groups: ['melee'], stats: { speed: '−10%', kb: '+15%' }, tier: '', value: '+7.12%' },
  { id: 15, key: 'Light', groups: ['melee'], stats: { speed: '+15%', kb: '−10%' }, tier: '', value: '+7.12%' },
  { id: 16, key: 'Sighted', groups: ['ranged'], stats: { dmg: '+10%', crit: '+3%' }, tier: '+1', value: '+35.96%' },
  { id: 17, key: 'Rapid', groups: ['ranged'], stats: { speed: '+15%', velocity: '+10%' }, tier: '+2', value: '+60.02%' },
  { id: 18, key: 'Hasty', groups: ['ranged'], stats: { speed: '+10%', velocity: '+15%' }, tier: '+2', value: '+60.02%' },
  { id: 19, key: 'Intimidating', groups: ['ranged'], stats: { velocity: '+5%', kb: '+15%' }, tier: '+2', value: '+45.81%' },
  { id: 20, key: 'Deadly', groups: ['ranged'], stats: { dmg: '+10%', speed: '+5%', crit: '+2%', velocity: '+5%', kb: '+5%' }, tier: '+2', value: '+75.38%' },
  { id: 21, key: 'Staunch', groups: ['ranged'], stats: { dmg: '+10%', kb: '+15%' }, tier: '+2', value: '+60.02%' },
  { id: 22, key: 'Awful', groups: ['ranged'], stats: { dmg: '−15%', velocity: '−10%', kb: '−10%' }, tier: '−2', value: '−52.6%' },
  { id: 23, key: 'Lethargic', groups: ['ranged'], stats: { speed: '−15%', velocity: '−10%' }, tier: '−2', value: '−41.48%' },
  { id: 24, key: 'Awkward', groups: ['ranged'], stats: { speed: '−10%', kb: '−20%' }, tier: '−2', value: '−48.16%' },
  { id: 25, key: 'Powerful', groups: ['ranged'], stats: { dmg: '+15%', speed: '−10%', crit: '+1%' }, tier: '+1', value: '+11.45%' },
  { id: 26, key: 'Mystic', groups: ['magic'], stats: { dmg: '+10%', mana: '−15%' }, tier: '+2', value: '+60.02%' },
  { id: 27, key: 'Adept', groups: ['magic'], stats: { mana: '−15%' }, tier: '+1', value: '+32.25%' },
  { id: 28, key: 'Masterful', groups: ['magic'], stats: { dmg: '+15%', mana: '−15%', kb: '+5%' }, tier: '+2', value: '+92.83%' },
  { id: 29, key: 'Inept', groups: ['magic'], stats: { mana: '+10%' }, tier: '−1', value: '−19%' },
  { id: 30, key: 'Ignorant', groups: ['magic'], stats: { dmg: '−10%', mana: '+20%' }, tier: '−2', value: '−48.16%' },
  { id: 31, key: 'Deranged', groups: ['magic'], stats: { dmg: '−10%', kb: '−10%' }, tier: '−1', value: '−34.39%' },
  { id: 32, key: 'Intense', groups: ['magic'], stats: { dmg: '+10%', mana: '+15%' }, tier: '−1', value: '−12.58%' },
  { id: 33, key: 'Taboo', groups: ['magic'], stats: { speed: '+10%', mana: '+10%', kb: '+10%' }, tier: '+1', value: '+18.59%' },
  { id: 34, key: 'Celestial', groups: ['magic'], stats: { dmg: '+10%', speed: '−10%', mana: '−10%', kb: '+10%' }, tier: '+1', value: '+43.5%' },
  { id: 35, key: 'Furious', groups: ['magic'], stats: { dmg: '+15%', mana: '+20%', kb: '+15%' }, tier: '+1', value: '+11.94%' },
  { id: 36, key: 'Keen', groups: ['weapon'], stats: { crit: '+3%' }, tier: '+1', value: '+12.36%' },
  { id: 37, key: 'Superior', groups: ['weapon'], stats: { dmg: '+10%', crit: '+3%', kb: '+10%' }, tier: '+2', value: '+64.51%' },
  { id: 38, key: 'Forceful', groups: ['weapon'], stats: { kb: '+15%' }, tier: '+1', value: '+32.25%' },
  { id: 39, key: 'Broken', groups: ['weapon'], stats: { dmg: '−30%', kb: '−20%' }, tier: '−2', value: '−68.64%' },
  { id: 40, key: 'Damaged', groups: ['weapon'], stats: { dmg: '−15%' }, tier: '−1', value: '−27.75%' },
  { id: 41, key: 'Shoddy', groups: ['weapon'], stats: { dmg: '−10%', kb: '−15%' }, tier: '−2', value: '−41.48%' },
  { id: 42, key: 'Quick', groups: ['common'], stats: { speed: '+10%' }, tier: '+1', value: '+21%' },
  { id: 43, key: 'Deadly2', groups: ['common'], stats: { dmg: '+10%', speed: '+10%' }, tier: '+2', value: '+46.41%' },
  { id: 44, key: 'Agile', groups: ['common'], stats: { speed: '+10%', crit: '+3%' }, tier: '+1', value: '+35.96%' },
  { id: 45, key: 'Nimble', groups: ['common'], stats: { speed: '+5%' }, tier: '+1', value: '+10.25%' },
  { id: 46, key: 'Murderous', groups: ['common'], stats: { dmg: '+7%', speed: '+6%', crit: '+3%' }, tier: '+2', value: '+44.54%' },
  { id: 47, key: 'Slow', groups: ['common'], stats: { speed: '−15%' }, tier: '−1', value: '−27.75%' },
  { id: 48, key: 'Sluggish', groups: ['common'], stats: { speed: '−20%' }, tier: '−2', value: '−36%' },
  { id: 49, key: 'Lazy', groups: ['common'], stats: { speed: '−8%' }, tier: '−1', value: '−15.36%' },
  { id: 50, key: 'Annoying', groups: ['common'], stats: { dmg: '−20%', speed: '−15%' }, tier: '−2', value: '−53.76%' },
  { id: 51, key: 'Nasty', groups: ['common'], stats: { dmg: '+5%', speed: '+10%', crit: '+2%', kb: '−10%' }, tier: '+1', value: '+16.87%' },
  { id: 52, key: 'Manic', groups: ['magic'], stats: { dmg: '−10%', speed: '+10%', mana: '−10%' }, tier: '+1', value: '+18.59%' },
  { id: 53, key: 'Hurtful', groups: ['weapon'], stats: { dmg: '+10%' }, tier: '+1', value: '+21%' },
  { id: 54, key: 'Strong', groups: ['weapon'], stats: { kb: '+15%' }, tier: '+1', value: '+32.25%' },
  { id: 55, key: 'Unpleasant', groups: ['weapon'], stats: { dmg: '+5%', kb: '+15%' }, tier: '+2', value: '+45.81%' },
  { id: 56, key: 'Weak', groups: ['weapon'], stats: { kb: '−20%' }, tier: '−2', value: '−36%' },
  { id: 57, key: 'Ruthless', groups: ['weapon'], stats: { dmg: '+18%', kb: '−10%' }, tier: '+1', value: '+12.78%' },
  { id: 58, key: 'Frenzying', groups: ['ranged'], stats: { dmg: '−15%', speed: '+15%' }, tier: '', value: '−4.45%' },
  { id: 59, key: 'Godly', groups: ['weapon'], stats: { dmg: '+15%', crit: '+5%', kb: '+15%' }, tier: '+2', value: '+111.63%' },
  { id: 60, key: 'Demonic', groups: ['weapon'], stats: { dmg: '+15%', crit: '+5%' }, tier: '+2', value: '+60.02%' },
  { id: 61, key: 'Zealous', groups: ['weapon'], stats: { crit: '+5%' }, tier: '+1', value: '+21%' },
  { id: 62, key: 'Hard', groups: ['accessory'], stats: {}, benefit: { id: 'defense', value: 1 }, tier: '+1', value: '+10.25%' },
  { id: 63, key: 'Guarding', groups: ['accessory'], stats: {}, benefit: { id: 'defense', value: 2 }, tier: '+1', value: '+21%' },
  { id: 64, key: 'Armored', groups: ['accessory'], stats: {}, benefit: { id: 'defense', value: 3 }, tier: '+1', value: '+32.25%' },
  { id: 65, key: 'Warding', groups: ['accessory'], stats: {}, benefit: { id: 'defense', value: 4 }, tier: '+2', value: '+44%' },
  { id: 66, key: 'Arcane', groups: ['accessory'], stats: {}, benefit: { id: 'mana', value: 20 }, tier: '+1', value: '+32.25%' },
  { id: 67, key: 'Precise', groups: ['accessory'], stats: {}, benefit: { id: 'crit', value: 2 }, tier: '+1', value: '+21%' },
  { id: 68, key: 'Lucky', groups: ['accessory'], stats: {}, benefit: { id: 'crit', value: 4 }, tier: '+2', value: '+44%' },
  { id: 69, key: 'Jagged', groups: ['accessory'], stats: {}, benefit: { id: 'damage', value: 1 }, tier: '+1', value: '+10.25%' },
  { id: 70, key: 'Spiked', groups: ['accessory'], stats: {}, benefit: { id: 'damage', value: 2 }, tier: '+1', value: '+21%' },
  { id: 71, key: 'Angry', groups: ['accessory'], stats: {}, benefit: { id: 'damage', value: 3 }, tier: '+1', value: '+32.25%' },
  { id: 72, key: 'Menacing', groups: ['accessory'], stats: {}, benefit: { id: 'damage', value: 4 }, tier: '+2', value: '+44%' },
  { id: 73, key: 'Brisk', groups: ['accessory'], stats: {}, benefit: { id: 'moveSpeed', value: 1 }, tier: '+1', value: '+10.25%' },
  { id: 74, key: 'Fleeting', groups: ['accessory'], stats: {}, benefit: { id: 'moveSpeed', value: 2 }, tier: '+1', value: '+21%' },
  { id: 75, key: 'Hasty2', groups: ['accessory'], stats: {}, benefit: { id: 'moveSpeed', value: 3 }, tier: '+1', value: '+32.25%' },
  { id: 76, key: 'Quick2', groups: ['accessory'], stats: {}, benefit: { id: 'moveSpeed', value: 4 }, tier: '+2', value: '+44%' },
  { id: 77, key: 'Wild', groups: ['accessory'], stats: {}, benefit: { id: 'meleeSpeed', value: 1 }, tier: '+1', value: '+10.25%' },
  { id: 78, key: 'Rash', groups: ['accessory'], stats: {}, benefit: { id: 'meleeSpeed', value: 2 }, tier: '+1', value: '+21%' },
  { id: 79, key: 'Intrepid', groups: ['accessory'], stats: {}, benefit: { id: 'meleeSpeed', value: 3 }, tier: '+1', value: '+32.25%' },
  { id: 80, key: 'Violent', groups: ['accessory'], stats: {}, benefit: { id: 'meleeSpeed', value: 4 }, tier: '+2', value: '+44%' },
  { id: 81, key: 'Legendary', groups: ['melee'], stats: { dmg: '+15%', speed: '+10%', crit: '+5%', size: '+10%', kb: '+15%' }, tier: '+2', value: '+209.85%' },
  { id: 82, key: 'Unreal', groups: ['ranged'], stats: { dmg: '+15%', speed: '+10%', crit: '+5%', velocity: '+10%', kb: '+15%' }, tier: '+2', value: '+209.85%' },
  { id: 83, key: 'Mythical', groups: ['magic'], stats: { dmg: '+15%', speed: '+10%', crit: '+5%', mana: '−10%', kb: '+15%' }, tier: '+2', value: '+209.85%' },
  { id: 84, key: 'Legendary2', groups: [], stats: { dmg: '+17%', crit: '+8%', kb: '+17%' }, tier: '+2', value: '+152.15%' },
  { id: 85, key: 'Fabled', groups: ['summon'], stats: { dmg: '+15%', ap: '+10', tag: '+3', kb: '+15%' }, tier: '+2', value: '+174.81%' },
  { id: 86, key: 'Loyal', groups: ['summon'], stats: { dmg: '+10%', ap: '+5', tag: '+3', kb: '+5%' }, tier: '+2', value: '+83.16%' },
  { id: 87, key: 'Worthy', groups: ['summon'], stats: { dmg: '+15%', ap: '+8' }, tier: '+2', value: '+65.89%' },
  { id: 88, key: 'Focused', groups: ['summon'], stats: { dmg: '+10%', tag: '+3' }, tier: '+1', value: '+43.76%' },
  { id: 89, key: 'Patient', groups: ['summon'], stats: { dmg: '−5%', tag: '+3' }, tier: '', value: '+7.23%' },
  { id: 90, key: 'Rabid', groups: ['summon'], stats: { dmg: '+10%', kb: '−10%' }, tier: '', value: '−1.99%' },
  { id: 92, key: 'Petty', groups: ['summon'], stats: { dmg: '−30%' }, tier: '−2', value: '−51%' },
  { id: 93, key: 'Feeble', groups: ['summon'], stats: { kb: '−25%' }, tier: '−2', value: '−43.75%' },
  { id: 94, key: 'Skittish', groups: ['summon'], stats: { dmg: '−15%', kb: '−10%' }, tier: '−2', value: '−41.48%' },
  { id: 95, key: 'Eager', groups: ['summon'], stats: { ap: '+25' }, tier: '+2', value: '+89.06%' },
  { id: 96, key: 'Ballistic', groups: ['summon'], stats: { tag: '+5' }, tier: '+1', value: '+32.25%' },
  { id: 97, key: 'Scraggling', groups: ['summon'], stats: { kb: '+25%' }, tier: '+2', value: '+56.25%' },
]
