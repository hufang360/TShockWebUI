import type { CommandParam, CommandParamSet, Lang, Npc } from '@/types'

/**
 * 指令元数据（**手工维护**）：补全下拉框里显示的取值备注 + 生成器提取不到的多级子命令。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 怎么加东西？（后续自己维护看这里）
 *
 * 1. 只想给某个**取值 / 子命令**加中文名：
 *    在下面 `LABELS[指令名][取值] = { zh, en }` 加一行即可。
 *    指令名用**规范名**（小写、不含 `/`）：TShock 核心指令就是它的名字；
 *    插件指令用插件注册的规范名（`playermanager` / `worldmodify` / `fishshop`，
 *    不是别名 `pm` / `wm` / `fish`）。补全下拉框会把这个名字显示在取值下面。
 *
 * 2. 想给某个**多级子命令**加补全（如 `/worldevent invasion <入侵类型>`、
 *    `/pm export <玩家名>`）：
 *    在 `EXTRA_PARAM_SETS[规范名]` 里加一条 `cmd('显示用指令名', '子命令', [后续参数])`。
 *    `cmd()` 会自动生成 `syntax` 串与 `literal` 首参；后续参数照 `CommandParam` 写
 *    （`kind` 决定候选来源：`player` / `item` / `npc` / `buff` / `enum` / `number` / `text`…）。
 *    字面量子命令会自动出现在补全下拉框里（见 `lib/completion.ts` 的 `computeLiteralCompletions`）。
 *
 *    - 这些 paramSets 会在运行期由 `lib/dataset.ts` 的 `withCommandMeta()` **按 syntax 覆盖**合并进
 *      `commands.json` 的同名指令；所以同一个 syntax 重复写只保留最后一条（方便覆盖生成结果）。
 *    - 生成器（`tools/gen-data.mjs`）只做机械提取；**这里写的是补充/覆盖**，不会丢。
 *
 * 3. 只想改中文/英文文案：直接改 `LABELS`；没有条目的取值会退回显示「可选值 / 子命令」。
 * ────────────────────────────────────────────────────────────────────────────
 */

interface LabelPair {
  zh: string
  en: string
}

/** 取值 / 子命令的备注名（中文 / 英文）。 */
const LABELS: Record<string, Record<string, LabelPair>> = {
  // ── TShock 核心：枚举取值 ──
  worldevent: {
    meteor: { zh: '流星', en: 'Meteor' },
    fullmoon: { zh: '满月', en: 'Full Moon' },
    'full moon': { zh: '满月', en: 'Full Moon' },
    bloodmoon: { zh: '血月', en: 'Blood Moon' },
    'blood moon': { zh: '血月', en: 'Blood Moon' },
    eclipse: { zh: '日食', en: 'Solar Eclipse' },
    invasion: { zh: '入侵', en: 'Invasion' },
    invade: { zh: '入侵', en: 'Invasion' },
    sandstorm: { zh: '沙尘暴', en: 'Sandstorm' },
    rain: { zh: '下雨', en: 'Rain' },
    lanternsnight: { zh: '灯笼夜', en: 'Lantern Night' },
    lanterns: { zh: '灯笼夜', en: 'Lantern Night' },
    meteorshower: { zh: '流星雨', en: 'Meteor Shower' },
    goblins: { zh: '哥布林入侵', en: 'Goblin Invasion' },
    goblin: { zh: '哥布林入侵', en: 'Goblin Invasion' },
    snowmen: { zh: '雪人军团', en: 'Frost Legion' },
    snowman: { zh: '雪人军团', en: 'Frost Legion' },
    pirates: { zh: '海盗入侵', en: 'Pirate Invasion' },
    pirate: { zh: '海盗入侵', en: 'Pirate Invasion' },
    pumpkinmoon: { zh: '南瓜月', en: 'Pumpkin Moon' },
    pumpkin: { zh: '南瓜月', en: 'Pumpkin Moon' },
    frostmoon: { zh: '霜月', en: 'Frost Moon' },
    frost: { zh: '霜月', en: 'Frost Moon' },
    martians: { zh: '火星暴乱', en: 'Martian Madness' },
    martian: { zh: '火星暴乱', en: 'Martian Madness' },
  },
  worldmode: {
    normal: { zh: '普通', en: 'Normal' },
    expert: { zh: '专家', en: 'Expert' },
    master: { zh: '大师', en: 'Master' },
    journey: { zh: '旅途', en: 'Journey' },
    creative: { zh: '创意', en: 'Creative' },
  },
  time: {
    day: { zh: '白天', en: 'Day' },
    night: { zh: '夜晚', en: 'Night' },
    noon: { zh: '正午', en: 'Noon' },
    midnight: { zh: '午夜', en: 'Midnight' },
  },
  clear: {
    item: { zh: '物品', en: 'Items' },
    npc: { zh: '生物', en: 'NPCs' },
    projectile: { zh: '弹幕', en: 'Projectiles' },
  },
  firework: {
    R: { zh: '红', en: 'Red' },
    G: { zh: '绿', en: 'Green' },
    B: { zh: '蓝', en: 'Blue' },
    Y: { zh: '黄', en: 'Yellow' },
  },
  region: {
    true: { zh: '开（保护）', en: 'On (protected)' },
    false: { zh: '关（不保护）', en: 'Off (unprotected)' },
    '-d': { zh: '显示区域边界', en: 'Show boundaries' },
    u: { zh: '上', en: 'Up' },
    d: { zh: '下', en: 'Down' },
    l: { zh: '左', en: 'Left' },
    r: { zh: '右', en: 'Right' },
    define: { zh: '定义区域', en: 'Define region' },
    protect: { zh: '设置保护开/关', en: 'Set protection' },
    delete: { zh: '删除区域', en: 'Delete region' },
    allow: { zh: '允许玩家进入', en: 'Allow player' },
    remove: { zh: '移除玩家', en: 'Remove player' },
    allowg: { zh: '允许用户组进入', en: 'Allow group' },
    removeg: { zh: '移除用户组', en: 'Remove group' },
    info: { zh: '区域信息', en: 'Region info' },
    z: { zh: '设置区域高度', en: 'Set region Z' },
    resize: { zh: '调整区域大小', en: 'Resize region' },
    rename: { zh: '重命名区域', en: 'Rename region' },
    tp: { zh: '传送到区域', en: 'Teleport to region' },
  },
  warp: {
    true: { zh: '开（隐藏）', en: 'On (hidden)' },
    false: { zh: '关（显示）', en: 'Off (visible)' },
    add: { zh: '添加传送点', en: 'Add warp' },
    del: { zh: '删除传送点', en: 'Delete warp' },
    hide: { zh: '隐藏/显示传送点', en: 'Hide/show warp' },
    send: { zh: '把玩家送到传送点', en: 'Send player to warp' },
  },
  group: {
    add: { zh: '添加用户组', en: 'Add group' },
    addperm: { zh: '给用户组加权限', en: 'Add permission' },
    parent: { zh: '设置父用户组', en: 'Set parent group' },
    suffix: { zh: '设置组名后缀', en: 'Set suffix' },
    prefix: { zh: '设置组名前缀', en: 'Set prefix' },
    color: { zh: '设置组颜色', en: 'Set color' },
    rename: { zh: '重命名用户组', en: 'Rename group' },
    del: { zh: '删除用户组', en: 'Delete group' },
    delperm: { zh: '移除用户组权限', en: 'Remove permission' },
    listperm: { zh: '列出用户组权限', en: 'List permissions' },
  },
  itemban: {
    add: { zh: '添加物品禁令', en: 'Add item ban' },
    allow: { zh: '允许用户组用该物品', en: 'Allow group' },
    del: { zh: '删除物品禁令', en: 'Delete item ban' },
    disallow: { zh: '禁止用户组用该物品', en: 'Disallow group' },
  },
  projban: {
    add: { zh: '添加弹幕禁令', en: 'Add projectile ban' },
    allow: { zh: '允许用户组用该弹幕', en: 'Allow group' },
    del: { zh: '删除弹幕禁令', en: 'Delete projectile ban' },
    disallow: { zh: '禁止用户组用该弹幕', en: 'Disallow group' },
  },
  tileban: {
    add: { zh: '添加图格禁令', en: 'Add tile ban' },
    allow: { zh: '允许用户组用该图格', en: 'Allow group' },
    del: { zh: '删除图格禁令', en: 'Delete tile ban' },
    disallow: { zh: '禁止用户组用该图格', en: 'Disallow group' },
  },

  // ── 插件：PlayerManager（/pm） ──
  playermanager: {
    help: { zh: '帮助', en: 'Help' },
    look: { zh: '查看玩家（背包 / 存档）', en: 'View player' },
    export: { zh: '导出指定玩家 .plr', en: 'Export player' },
    exportall: { zh: '导出全部玩家', en: 'Export all players' },
    save: { zh: '立即保存 SSC', en: 'Save SSC now' },
    backup: { zh: '备份', en: 'Backup' },
    recover: { zh: '恢复', en: 'Recover' },
    list: { zh: '备份列表', en: 'List backups' },
    reload: { zh: '重载配置', en: 'Reload config' },
    hp: { zh: '修改生命值', en: 'Set HP' },
    maxhp: { zh: '修改生命上限', en: 'Set max HP' },
    mana: { zh: '修改魔力值', en: 'Set mana' },
    maxmana: { zh: '修改魔力上限', en: 'Set max mana' },
    enhance: { zh: '永久增强', en: 'Permanent buffs' },
    quest: { zh: '修改渔夫任务完成次数', en: 'Set angler quests' },
  },

  // ── 插件：WorldModify（/wm） ──
  worldmodify: {
    help: { zh: '帮助', en: 'Help' },
    comment: { zh: '世界备注', en: 'World comment' },
    info: { zh: '世界信息', en: 'World info' },
    name: { zh: '修改世界名', en: 'World name' },
    mode: { zh: '修改难度', en: 'World mode' },
    seed: { zh: '查看种子', en: 'Seed' },
    id: { zh: '世界 ID', en: 'World ID' },
    uuid: { zh: '世界 UUID', en: 'World UUID' },
    sd: { zh: '日晷（跳过白天）', en: 'Sundial' },
    sundial: { zh: '日晷（跳过白天）', en: 'Sundial' },
    md: { zh: '月晷（跳过夜晚）', en: 'Moondial' },
    moondial: { zh: '月晷（跳过夜晚）', en: 'Moondial' },
    surface: { zh: '传送到地表', en: 'Go to surface' },
    cave: { zh: '传送到洞穴', en: 'Go to caves' },
    spawn: { zh: '传送到出生点', en: 'Go to spawn' },
    dungeon: { zh: '传送到地牢', en: 'Go to dungeon' },
    wind: { zh: '设置风力', en: 'Wind' },
    secret: { zh: '设置秘密种子', en: 'Secret seed' },
    research: { zh: '解锁研究', en: 'Research' },
    bestiary: { zh: '解锁图鉴', en: 'Bestiary' },
    backup: { zh: '备份世界', en: 'Backup world' },
    save: { zh: '保存世界', en: 'Save world' },
    find: { zh: '查找物块 / 墙', en: 'Find tile/wall' },
    finditem: { zh: '查找物品', en: 'Find item' },
    clear: { zh: '清理物品 / 生物 / 弹幕', en: 'Clear entities' },
    event: { zh: '世界事件 / Boss 进度', en: 'World events' },
    journey: { zh: '旅途模式权限', en: 'Journey powers' },
    gps: { zh: '定位信息', en: 'GPS' },
    maptp: { zh: '地图点击传送', en: 'Map teleport' },
    xml: { zh: 'XML 导入 / 导出', en: 'XML' },
    debug: { zh: '调试', en: 'Debug' },
    version: { zh: '版本', en: 'Version' },
    // /wm 的枚举取值
    normal: { zh: '普通', en: 'Normal' },
    expert: { zh: '专家', en: 'Expert' },
    master: { zh: '大师', en: 'Master' },
    creative: { zh: '创意', en: 'Creative' },
    on: { zh: '开', en: 'On' },
    off: { zh: '关', en: 'Off' },
    item: { zh: '物品', en: 'Items' },
    npc: { zh: '生物', en: 'NPCs' },
    projectile: { zh: '弹幕', en: 'Projectiles' },
  },

  // ── 插件：FishShop（/fish） ──
  fishshop: {
    help: { zh: '帮助', en: 'Help' },
    list: { zh: '浏览货架', en: 'List goods' },
    ask: { zh: '询价', en: 'Ask price' },
    buy: { zh: '购买', en: 'Buy' },
    refund: { zh: '退款', en: 'Refund' },
    info: { zh: '钓鱼信息', en: 'Fish info' },
    jar: { zh: '鱼罐（查看 / 存 / 取）', en: 'Fish jar' },
    rank: { zh: '消费榜', en: 'Spending rank' },
    basket: { zh: '鱼篓榜', en: 'Fish-basket rank' },
    finish: { zh: '完成（钓到鱼）', en: 'Finish' },
    change: { zh: '换一条鱼', en: 'Change fish' },
    changesuper: { zh: '高级换鱼', en: 'Super change' },
    reload: { zh: '重载配置', en: 'Reload config' },
    reset: { zh: '重置', en: 'Reset' },
    docs: { zh: '文档', en: 'Docs' },
    test: { zh: '测试指令', en: 'Test commands' },
    special: { zh: '特殊', en: 'Special' },
    sounder: { zh: '试听音效', en: 'Preview sound' },
    in: { zh: '存入', en: 'Deposit' },
    out: { zh: '取出', en: 'Withdraw' },
  },
}

/** `cmd()`：构造一条「字面量子命令 + 后续参数」的用法串与参数表。 */
function cmd(
  display: string,
  sub: string,
  args: CommandParam[] = [],
  note?: { zh: string; en: string },
): CommandParamSet {
  const tail = args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')
  return {
    syntax: `${display} ${sub}${tail ? ` ${tail}` : ''}`,
    args: [{ literal: sub }, ...args],
    ...(note ? { noteZh: note.zh, noteEn: note.en } : {}),
  }
}

const NPC_ARG: CommandParam = { name: '玩家名', required: true, kind: 'player' }
const NAME_ARG: CommandParam = { name: '玩家名', required: true, kind: 'text' }
const NUM_ARG: CommandParam = { name: '数值', required: true, kind: 'number' }

/**
 * 额外 / 覆盖的参数形态：键 = 指令规范名（小写）。
 * 这些会在运行期合并进 `commands.json` / 运行时指令目录，见 `lib/dataset.ts`。
 */
const EXTRA_PARAM_SETS: Record<string, CommandParamSet[]> = {
  // TShock：/worldevent invasion 的第 3 级（生成器只提到 <event type>）。
  worldevent: [
    cmd(
      'worldevent',
      'invasion',
      [
        {
          name: 'invasion type',
          required: true,
          kind: 'enum',
          values: [
            'goblins',
            'snowmen',
            'pirates',
            'pumpkinmoon',
            'frostmoon',
            'martians',
            'goblin',
            'snowman',
            'pirate',
            'pumpkin',
            'frost',
            'martian',
          ],
        },
        { name: '入侵波数', required: false, kind: 'number' },
      ],
      // 覆盖生成器只提到 <event type> 后无法继续补全的问题
    ),
  ],

  // 插件：PlayerManager
  playermanager: [
    {
      syntax: 'pm <子命令> [参数]',
      args: [
        { name: '子命令', required: true, kind: 'text' },
        { name: '参数', required: false, kind: 'text', variadic: true },
      ],
    },
    cmd('pm', 'help'),
    cmd('pm', 'look', [NPC_ARG]),
    cmd('pm', 'export', [NAME_ARG]),
    cmd('pm', 'exportall'),
    cmd('pm', 'save'),
    cmd('pm', 'backup', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('pm', 'recover', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('pm', 'list', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('pm', 'reload'),
    cmd('pm', 'hp', [NPC_ARG, { name: '生命值', required: true, kind: 'number' }]),
    cmd('pm', 'maxhp', [NPC_ARG, { name: '生命上限', required: true, kind: 'number' }]),
    cmd('pm', 'mana', [NPC_ARG, NUM_ARG]),
    cmd('pm', 'maxmana', [NPC_ARG, NUM_ARG]),
    cmd('pm', 'enhance', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('pm', 'quest', [NPC_ARG, { name: '次数', required: true, kind: 'number' }]),
  ],

  // 插件：WorldModify
  worldmodify: [
    {
      syntax: 'wm <子命令> [参数]',
      args: [
        { name: '子命令', required: true, kind: 'text' },
        { name: '参数', required: false, kind: 'text', variadic: true },
      ],
    },
    cmd('wm', 'help'),
    cmd('wm', 'info'),
    cmd('wm', 'name', [{ name: '世界名', required: false, kind: 'text' }], {
      zh: '不加参数 = 查看世界名',
      en: 'no arg = view world name',
    }),
    cmd(
      'wm',
      'mode',
      [
        { name: '难度', required: false, kind: 'enum', values: ['normal', 'expert', 'master', 'journey', 'creative'] },
      ],
      { zh: '不加参数 = 查看难度', en: 'no arg = view mode' },
    ),
    cmd('wm', 'seed', [{ name: '种子', required: false, kind: 'text' }], {
      zh: '不加参数 = 查看种子',
      en: 'no arg = view seed',
    }),
    cmd('wm', 'id', [{ name: 'id', required: false, kind: 'text' }], {
      zh: '不加参数 = 查看世界 ID',
      en: 'no arg = view world ID',
    }),
    cmd('wm', 'uuid', [{ name: 'uuid / new', required: false, kind: 'text' }], {
      zh: '不加参数 = 查看 UUID',
      en: 'no arg = view UUID',
    }),
    cmd('wm', 'comment', [{ name: '片段', required: false, kind: 'text' }], {
      zh: '不加参数 = 查看预置备注片段',
      en: 'no arg = view comment snippets',
    }),
    cmd('wm', 'sundial', [{ name: 'on|off|天数', required: false, kind: 'text' }], {
      zh: '不加参数 = 查看日皼（跳过白天）状态',
      en: 'no arg = view sundial',
    }),
    cmd('wm', 'moondial', [{ name: 'on|off|天数', required: false, kind: 'text' }], {
      zh: '不加参数 = 查看月皼（跳过夜晚）状态',
      en: 'no arg = view moondial',
    }),
    cmd('wm', 'surface', [{ name: '深度', required: false, kind: 'number' }], {
      zh: '不加参数 = 查看地表深度',
      en: 'no arg = view surface depth',
    }),
    cmd('wm', 'cave', [{ name: '深度', required: false, kind: 'number' }], {
      zh: '不加参数 = 查看洞穴深度',
      en: 'no arg = view cave depth',
    }),
    cmd('wm', 'spawn', [], { zh: '查看出生点 / 传送到出生点', en: 'view / go to spawn' }),
    cmd('wm', 'dungeon', [], { zh: '查看地牢点 / 传送到地牢', en: 'view / go to dungeon' }),
    cmd('wm', 'wind', [{ name: '风力', required: false, kind: 'number' }], {
      zh: '不加参数 = 查看风速',
      en: 'no arg = view wind',
    }),
    cmd('wm', 'research', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('wm', 'bestiary', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('wm', 'backup', [{ name: '备注', required: false, kind: 'text' }], {
      zh: '不加参数 = 直接备份地图',
      en: 'no arg = back up world',
    }),
    cmd('wm', 'save'),
    cmd('wm', 'find', [{ name: '物块/墙', required: true, kind: 'text' }]),
    cmd('wm', 'finditem', [{ name: '物品', required: true, kind: 'item' }]),
    cmd('wm', 'clear', [
      { name: 'item|npc|projectile', required: true, kind: 'enum', values: ['item', 'npc', 'projectile'] },
    ]),
    cmd('wm', 'event', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('wm', 'journey', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('wm', 'gps', [
      { name: 'x', required: true, kind: 'number' },
      { name: 'y', required: true, kind: 'number' },
    ]),
    cmd('wm', 'maptp', [{ name: 'on|off', required: false, kind: 'enum', values: ['on', 'off'] }], {
      zh: '不加参数 = 查看开关',
      en: 'no arg = view toggle',
    }),
    cmd('wm', 'xml', [{ name: '子命令', required: false, kind: 'text' }]),
    cmd('wm', 'debug'),
    cmd('wm', 'version'),
  ],

  // 插件：FishShop
  fishshop: [
    {
      syntax: 'fish <子命令> [参数]',
      args: [
        { name: '子命令', required: true, kind: 'text' },
        { name: '参数', required: false, kind: 'text', variadic: true },
      ],
    },
    cmd('fish', 'help'),
    cmd('fish', 'list', [{ name: '页码/搜索', required: false, kind: 'text' }]),
    cmd('fish', 'ask', [{ name: '商品', required: false, kind: 'text' }]),
    cmd('fish', 'buy', [{ name: '商品', required: true, kind: 'text' }, { name: '数量', required: false, kind: 'number' }]),
    cmd('fish', 'refund', [{ name: '商品', required: false, kind: 'text' }]),
    cmd('fish', 'info'),
    cmd(
      'fish',
      'jar',
      [{ name: 'in|out|help', required: false, kind: 'enum', values: ['in', 'out', 'help'] }],
      { zh: '不加参数 = 查看鱼罐', en: 'no arg = view jar' },
    ),
    cmd('fish', 'rank'),
    cmd('fish', 'basket'),
    cmd('fish', 'finish'),
    cmd('fish', 'change'),
    cmd('fish', 'changesuper'),
    cmd('fish', 'reload'),
    cmd('fish', 'reset'),
    cmd('fish', 'docs'),
    cmd('fish', 'test'),
    cmd('fish', 'special'),
    cmd('fish', 'sounder', [{ name: '音效名', required: true, kind: 'text' }]),
  ],
}

/** `spawnboss` 的别名 → NPC 显示名（跟随界面语言）；分组 Boss 用固定名。 */
function spawnBossLabels(npcs: Npc[], lang: Lang): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of npcs) {
    if (!n.sb) continue
    for (const alias of [n.sb, ...(n.sbAliases ?? [])]) {
      if (!(alias in map)) map[alias] = n.name
    }
  }
  // 一个 /sb 参数对应多个 NPC / 全部 Boss 时，用 TShock 的显示名。
  map.all = lang === 'en' ? 'all bosses' : '全部 Boss'
  map['*'] = map.all
  map.twins = lang === 'en' ? 'the Twins' : '双子魔眼'
  return map
}

const normalize = (command: string) => command.trim().replace(/^\/+/, '').toLowerCase()

/** 返回某条指令的全部取值 / 子命令 → 备注名（当前语言）。没有配置时返回 `{}`。 */
export function enumLabelsFor(command: string, lang: Lang, npcs: Npc[]): Record<string, string> {
  const name = normalize(command)
  if (name === 'spawnboss') return spawnBossLabels(npcs, lang)
  const pairs = LABELS[name]
  if (!pairs) return {}
  const out: Record<string, string> = {}
  for (const [value, pair] of Object.entries(pairs)) {
    out[value] = lang === 'en' ? pair.en : pair.zh
  }
  return out
}

/** 返回某条指令要追加 / 覆盖的参数形态（`commands.json` 里没有的）。 */
export function extraParamSetsFor(command: string): CommandParamSet[] {
  return EXTRA_PARAM_SETS[normalize(command)] ?? []
}
