import type {
  CommandDef,
  Dataset,
  Item,
  PaintEntry,
  Projectile,
  TileNameOverridesData,
  TileNamesData,
  TileWallData,
} from '@/types'
import { resolveTileName } from '@/lib/tiles'
import { extraParamSetsFor } from '@/lib/commandMeta'

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
  // 油漆 / 涂料的「对应物品」（数据 ID 页的油漆 tab 用）。
  { id: 1073, key: 'RedPaint', name: '红漆', icon: 1073, frames: 1, sprite: [20, 20], tags: [] },
  { id: 1099, key: 'GrayPaint', name: '灰漆', icon: 1099, frames: 1, sprite: [20, 20], tags: [] },
  { id: 4668, key: 'GlowPaint', name: '夜明涂料', icon: 4668, frames: 1, sprite: [24, 24], tags: [] },
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

/** 和运行期一致：把 commandMeta 里的额外多级参数形态合并进指令。 */
function withCommandMeta(commands: CommandDef[]): CommandDef[] {
  return commands.map((cmd) => {
    const extra = extraParamSetsFor(cmd.name)
    if (extra.length === 0) return cmd
    const bySyntax = new Map((cmd.paramSets ?? []).map((s) => [s.syntax, s]))
    for (const s of extra) bySyntax.set(s.syntax, s)
    return { ...cmd, paramSets: [...bySyntax.values()] }
  })
}

/** 怪物图鉴夹具：两个筛选器（Boss / 地表）+ 两只 NPC 的图鉴数据。 */
const testBestiary = {
  meta: {
    gameVersion: '1.4.5.8',
    filterCount: 2,
    npcCount: 2,
    source: 'test',
    generatedBy: 'test',
    note: '',
  },
  filters: [
    { key: 'BestiaryInfo.IsBoss', icon: { texture: 'tags' as const } },
    { key: 'Bestiary_Biomes.Surface', icon: { texture: 'tags' as const } },
  ],
  npcs: {
    '1': { sortId: 2, rarity: 1, damage: 7, defense: 2, coins: 25, life: 25, filters: [1] },
    '4': { sortId: 1, rarity: 2, damage: 15, defense: 12, coins: 30000, life: 2800, filters: [0] },
  },
}

const testBestiaryIcons = {
  meta: {
    gameVersion: '1.4.5.8',
    tags: { file: 'bestiary-tags.webp', hash: 'test', cols: 16, rows: 5, cell: 30 },
    rank: { file: 'bestiary-rank.webp', hash: 'test', cols: 1, rows: 1, cell: 30 },
  },
  filters: [
    { key: 'BestiaryInfo.IsBoss', texture: 'tags' as const, frame: 63 },
    { key: 'Bestiary_Biomes.Surface', texture: 'tags' as const, frame: 0 },
  ],
}

/** Buff fixture：1 号单件来源（药水），2 号多件来源（验证「都显示」）。 */
const testBuffs = [
  { id: 1, key: 'ObsidianSkin', name: '黑曜石皮', tip: '对熔岩免疫', items: [288] },
  { id: 2, key: 'Regeneration', name: '再生', tip: '提供生命再生', items: [29, 75] },
]

/** 油漆 / 涂料 fixture：油漆 1 与涂料 1 数字重复（验证分组不会串）；名称取对应物品。 */
const testPaints: PaintEntry[] = [
  { id: 1, group: 'paint', key: 'RedPaint', item: 1073, name: '红漆' },
  { id: 2, group: 'paint', key: 'GrayPaint', item: 1099, name: '灰漆' },
  { id: 1, group: 'coating', key: 'Glow', item: 4668, name: '夜明涂料' },
]

/** 射弹 fixture：1 号有本地化名，2 号没有（回退内部名）。 */
const testProjectiles: Projectile[] = [
  { id: 1, key: 'WoodenArrowFriendly', name: '木箭' },
  { id: 2, key: 'FireArrow', name: 'FireArrow' },
]

export function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  const items = overrides.items ?? testItems
  const commands = withCommandMeta(overrides.commands ?? testCommands)
  /** 图格表 fixture（与 tiles / tilesById 共用一份）。 */
  const testTiles: TileWallData = {
    meta: {
      gameVersion: '1.4.5.8',
      count: 3,
      withItem: 1,
      source: 'test',
      generatedBy: 'test',
      note: '',
    },
    entries: [
      { id: 0, key: 'Dirt', item: null },
      { id: 5, key: 'Trees', item: null, frameImportant: true },
      { id: 1, key: 'Stone', item: 29, size: [3, 2] },
      { id: 12, key: 'Heart', item: null },
    ],
  }
  const testTileNames: TileNamesData = {
    meta: {
      gameVersion: '1.4.5.8',
      source: 'test',
      generatedBy: 'test',
      itemCount: 1,
      objectCount: 0,
      note: '',
    },
    // 图格 12（生命水晶）在游戏里是「图例名 = 物品 29」
    items: { '12': 29 },
    objects: {},
  }
  const testTileNameOverrides: TileNameOverridesData = {
    meta: {
      gameVersion: '1.4.5.8',
      source: 'test',
      generatedBy: 'test',
      tileCount: 1,
      wallCount: 1,
      note: '',
    },
    // 图格 5（Trees）与墙 1 都没有代表物品 → 只能靠补给表（验证命名链最后一步）
    tiles: { '5': '树木' },
    walls: { '1': '石墙' },
  }
  const tiles = overrides.tiles ?? testTiles
  const tileNames = overrides.tileNames ?? testTileNames
  const tileNameOverrides = overrides.tileNameOverrides ?? testTileNameOverrides
  const itemsById = new Map(items.map((it) => [it.id, it]))
  // 与生产一致：按「MapObject → 图例物品 → 代表物品 → 补给表 → 常量名」预计算显示名
  const tileNameById =
    overrides.tileNameById ??
    new Map(
      tiles.entries.map((tile) => [
        tile.id,
        resolveTileName(tile, {
          tileNames,
          tileNameOverrides,
          loc: overrides.loc ?? ({} as Dataset['loc']),
          itemsById,
        }),
      ]),
    )

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
      { id: 1, key: 'BlueSlime', name: '蓝史莱姆', en: 'Blue Slime' },
      {
        id: 4,
        key: 'EyeOfCthulhu',
        name: '克苏鲁之眼',
        en: 'Eye of Cthulhu',
        sb: 'eye of cthulhu',
        sbAliases: ['eoc', 'eye'],
        sbAll: true,
      },
    ],
    buffs: overrides.buffs ?? testBuffs,
    bestiary: overrides.bestiary ?? testBestiary,
    bestiaryIcons: overrides.bestiaryIcons ?? testBestiaryIcons,
    bestiaryByNpcId:
      overrides.bestiaryByNpcId ??
      new Map(Object.entries(testBestiary.npcs).map(([id, entry]) => [Number(id), entry])),
    tiles: overrides.tiles ?? {
      meta: {
        gameVersion: '1.4.5.8',
        count: 2,
        withItem: 1,
        source: 'test',
        generatedBy: 'test',
        note: '',
      },
      entries: [
        { id: 0, key: 'Dirt', item: null },
        { id: 5, key: 'Trees', item: null, frameImportant: true },
        { id: 1, key: 'Stone', item: 29, size: [3, 2] },
      ],
    },
    walls: overrides.walls ?? {
      meta: {
        gameVersion: '1.4.5.8',
        count: 1,
        withItem: 1,
        source: 'test',
        generatedBy: 'test',
        note: '',
      },
      entries: [{ id: 1, key: 'Stone', item: 29 }],
    },
    tileNames,
    tileNameOverrides,
    tileNameById,
    permissions: overrides.permissions ?? {
      meta: {
        tshockVersion: 'test',
        permissionCount: 2,
        groupCount: 2,
        source: 'test',
        generatedBy: 'test',
        note: '',
      },
      permissions: [
        { node: 'tshock.rest.useapi', desc: 'create REST tokens' },
        { node: 'tshock.world.time', desc: 'change time' },
      ],
      groups: ['default', 'guest'],
    },
    tilesById: overrides.tilesById ?? new Map(tiles.entries.map((t) => [t.id, t])),
    wallsById: overrides.wallsById ?? new Map([[1, { id: 1, key: 'Stone', item: 29 }]]),
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
        sheet: 'items-atlas.webp',
        generatedBy: 'test',
        note: '',
      },
      regions: Object.fromEntries(items.map((it) => [String(it.icon), [0, 0, 16, 16]])),
    },
    itemsById,
    prefixesById: new Map([[81, { id: 81, key: 'Legendary', name: '传奇' }]]),
    npcsById: new Map([
      [1, { id: 1, key: 'BlueSlime', name: '蓝史莱姆', en: 'Blue Slime' }],
      [
        4,
        {
          id: 4,
          key: 'EyeOfCthulhu',
          name: '克苏鲁之眼',
          en: 'Eye of Cthulhu',
          sb: 'eye of cthulhu',
          sbAliases: ['eoc', 'eye'],
          sbAll: true,
        },
      ],
    ]),
    buffsById: overrides.buffsById ?? new Map(testBuffs.map((b) => [b.id, b])),
    paints: overrides.paints ?? testPaints,
    projectiles: overrides.projectiles ?? testProjectiles,
    projectilesById:
      overrides.projectilesById ??
      new Map((overrides.projectiles ?? testProjectiles).map((p) => [p.id, p])),
    loc: {
      ItemName: {
        LifeCrystal: '生命水晶',
        FallenStar: '坠落之星',
        Zenith: '天顶剑',
        Wood: '木材',
        RedPaint: '红漆',
        GrayPaint: '灰漆',
        GlowPaint: '夜明涂料',
      },
      ProjectileName: { WoodenArrowFriendly: '木箭' },
      Prefix: { Legendary: '传奇' },
      NPCName: { BlueSlime: '蓝史莱姆', EyeOfCthulhu: '克苏鲁之眼' },
      BuffName: { ObsidianSkin: '黑曜石皮', Regeneration: '再生' },
      BestiaryInfo: {
        IsBoss: 'Boss',
        IsRare: '稀有生物',
        Sort_BestiaryID: '怪物图鉴ID',
        Sort_Alphabetical: '名称',
        Sort_Attack: '攻击',
        Sort_Defense: '防御',
        Sort_Coins: '钱币',
        Sort_HitPoints: '生命',
        Sort_Rarity: '稀有度',
      },
      Bestiary_Biomes: { Surface: '地表' },
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
    itemDrops: overrides.itemDrops ?? {
      meta: {
        gameVersion: '1.4.5.8',
        trials: 0,
        source: 'test',
        generatedBy: 'test',
        note: '',
      },
      items: {},
    },
    itemDropsById: overrides.itemDropsById ?? new Map(),
    commandsByToken,
    ...overrides,
  }
}
