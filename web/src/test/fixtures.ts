import type { CommandDef, Dataset, Item } from '@/types'

export const testItems: Item[] = [
  {
    id: 29,
    key: 'LifeCrystal',
    name: '生命水晶',
    icon: 29,
    frames: 1,
    sprite: [16, 16],
    tags: ['材料'],
  },
  {
    id: 75,
    key: 'FallenStar',
    name: '坠落之星',
    icon: 75,
    frames: 8,
    sprite: [22, 208],
    tags: [],
  },
  {
    id: 4956,
    key: 'Zenith',
    name: '天顶剑',
    icon: 4956,
    frames: 1,
    sprite: [56, 56],
    tags: ['武器'],
  },
]

export const testCommands: CommandDef[] = [
  {
    name: 'help',
    aliases: ['?'],
    permission: null,
    help: 'Shows command help.',
    allowServer: true,
    doLog: false,
  },
  {
    name: 'time',
    aliases: [],
    permission: 'tshock.world.time',
    help: 'Changes world time.',
    helpEn: 'Changes world time.',
    helpZh: '设置世界时间。',
    allowServer: true,
    doLog: true,
    paramSets: [
      {
        syntax: 'time <day|night|noon|midnight|hh:mm>',
        args: [{ name: 'time', required: true, kind: 'enum', values: ['day', 'night', 'noon', 'midnight'] }],
      },
    ],
  },
  {
    name: 'give',
    aliases: ['g'],
    permission: 'tshock.item.give',
    help: 'Gives another player an item.',
    allowServer: true,
    doLog: true,
    paramSets: [
      {
        syntax: 'give <item type/id> <player> [item amount] [prefix id/name]',
        args: [
          { name: 'item type/id', required: true, kind: 'item' },
          { name: 'player', required: true, kind: 'player' },
          { name: 'item amount', required: false, kind: 'number' },
          { name: 'prefix id/name', required: false, kind: 'prefix' },
        ],
      },
    ],
  },
  {
    name: 'group',
    aliases: [],
    permission: 'tshock.group.manage',
    help: 'Manages groups.',
    allowServer: true,
    doLog: true,
    paramSets: [
      {
        syntax: 'group addperm <group name> <permissions...>',
        args: [
          { literal: 'addperm' },
          { name: 'group name', required: true, kind: 'text' },
          { name: 'permissions', required: true, kind: 'text', variadic: true },
        ],
      },
      {
        syntax: 'group add <group name> [permissions]',
        args: [
          { literal: 'add' },
          { name: 'group name', required: true, kind: 'text' },
          { name: 'permissions', required: false, kind: 'text' },
        ],
      },
    ],
  },
  {
    name: 'item',
    aliases: ['i'],
    permission: 'tshock.item.spawn',
    help: 'Gives an item.',
    allowServer: false,
    doLog: true,
  },
]

export const testItemGroups: Dataset['itemGroups'] = {
  meta: {
    gameVersion: '1.4.5.8',
    itemCount: testItems.length,
    tabCount: 11,
    source: 'test',
    generatedBy: 'test',
    note: '',
  },
  tabs: [
    { id: 'weapons', label: 'CreativePowers.TabWeapons' },
    { id: 'armor', label: 'CreativePowers.TabArmor' },
    { id: 'vanity', label: 'CreativePowers.TabVanity' },
    { id: 'blocks', label: 'CreativePowers.TabBlocks' },
    { id: 'furniture', label: 'CreativePowers.TabFurniture' },
    { id: 'accessories', label: 'CreativePowers.TabAccessories' },
    { id: 'accessoriesMisc', label: 'CreativePowers.TabAccessoriesMisc' },
    { id: 'consumables', label: 'CreativePowers.TabConsumables' },
    { id: 'tools', label: 'CreativePowers.TabTools' },
    { id: 'materials', label: 'CreativePowers.TabMaterials' },
    { id: 'misc', label: 'CreativePowers.TabMisc' },
  ],
  items: {
    '29': { g: 'ConsumableThatDoesNotDamage', gv: 94, o: 0, t: [7, 9] },
    '75': { g: 'Material', gv: 10000, o: 0, t: [9] },
    '4956': { g: 'MeleeWeapon', gv: 530, o: 0, t: [0] },
  },
}

export function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  const items = overrides.items ?? testItems
  const commands = overrides.commands ?? testCommands
  const commandsByToken = new Map<string, CommandDef>()
  for (const cmd of commands) {
    commandsByToken.set(cmd.name.toLowerCase(), cmd)
    for (const alias of cmd.aliases) commandsByToken.set(alias.toLowerCase(), cmd)
  }
  return {
    meta: {
      gameVersion: '1.4.5.8',
      tshockVersion: '6.2.1',
      itemCount: items.length,
      prefixCount: 1,
      commandCount: commands.length,
      spriteCount: items.length,
      textureCopyCount: 0,
      generatedBy: 'test',
      sources: {},
    },
    items,
    prefixes: [{ id: 81, key: 'Legendary', name: '传奇' }],
    npcs: [
      { id: 1, key: 'BlueSlime', name: '蓝史莱姆' },
      { id: 4, key: 'EyeOfCthulhu', name: '克苏鲁之眼' },
    ],
    buffs: [
      { id: 1, key: 'ObsidianSkin', name: '黑曜石皮' },
      { id: 2, key: 'Regeneration', name: '再生' },
    ],
    commands,
    atlas: {
      meta: {
        gameVersion: '1.4.5.8',
        width: 1024,
        height: 4584,
        limitWidth: 1024,
        padding: 0,
        textures: items.length,
        items: items.length,
        sheet: 'items-atlas.png',
        generatedBy: 'test',
        note: '',
      },
      regions: Object.fromEntries(items.map((it) => [String(it.icon), [0, 0, 16, 16]])),
    },
    itemsById: new Map(items.map((it) => [it.id, it])),
    prefixesById: new Map([[81, { id: 81, key: 'Legendary', name: '传奇' }]]),
    npcsById: new Map([
      [1, { id: 1, key: 'BlueSlime', name: '蓝史莱姆' }],
      [4, { id: 4, key: 'EyeOfCthulhu', name: '克苏鲁之眼' }],
    ]),
    buffsById: new Map([
      [1, { id: 1, key: 'ObsidianSkin', name: '黑曜石皮' }],
      [2, { id: 2, key: 'Regeneration', name: '再生' }],
    ]),
    loc: {
      ItemName: { LifeCrystal: '生命水晶', FallenStar: '坠落之星', Zenith: '天顶剑', Wood: '木材' },
      Prefix: { Legendary: '传奇' },
      NPCName: { BlueSlime: '蓝史莱姆', EyeOfCthulhu: '克苏鲁之眼' },
      BuffName: { ObsidianSkin: '黑曜石皮', Regeneration: '再生' },
    },
    recipes: {
      meta: { gameVersion: '1.4.5.8', count: 0, groupCount: 0, source: 'test', generatedBy: 'test' },
      groups: {},
      recipes: [],
      byResult: {},
      byIngredient: {},
    },
    itemStats: {
      meta: {
        gameVersion: '1.4.5.8',
        itemCount: items.length,
        itemsWithTip: 0,
        source: 'test',
        generatedBy: 'test',
        note: '',
      },
      items: {},
    },
    itemGroups: overrides.itemGroups ?? testItemGroups,
    shimmer: overrides.shimmer ?? {
      meta: {
        gameVersion: '1.4.5.8',
        itemCount: items.length,
        count: 0,
        source: 'test',
        generatedBy: 'test',
        note: '',
      },
      items: {},
    },
    shimmerToById: overrides.shimmerToById ?? new Map(),
    shimmerFromById: overrides.shimmerFromById ?? new Map(),
    prefixMods: overrides.prefixMods ?? {
      meta: { count: 0, source: 'test', generatedBy: 'test', note: '' },
      mods: {},
    },
    prefixModsById: overrides.prefixModsById ?? new Map(),
    prefixSets: overrides.prefixSets ?? {
      meta: {
        gameVersion: '1.4.5.8',
        setCount: 0,
        itemCount: 0,
        source: 'test',
        generatedBy: 'test',
        note: '',
      },
      sets: [],
      items: {},
    },
    rollablePrefixesById: overrides.rollablePrefixesById ?? new Map(),
    commandsByToken,
    ...overrides,
  }
}
