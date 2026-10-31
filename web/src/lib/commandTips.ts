/**
 * 「指令小抄」页的**分组定义**（手工维护；分组标题 / 说明在 `lib/i18n.tsx`）。
 *
 * 两种分组：
 * - **有可点条目的**（世界事件、时间、召唤 Boss…）：语法行用 `usageKey`，具体指令在页面里生成
 *   （见 `CommandTipsPage` 的 `curatedRows`），点了把完整指令填进「指令」浮窗。
 * - **参考型分组**（物品、增益、传送、服务器…）：`commands` 列 TShock 内置指令名，
 *   语法取自 `data/commands.json` 的 `paramSets`（由 TShock 6.2.1 源码提取，**不猜**），
 *   页面渲染成不可点的参考行（带复制按钮），`allowServer=false` 的会标「仅游戏内」。
 *
 * 没列进来的插件指令（本服还有 `/bwl` `/chest` `/judge` `/worldmodify` `/playermanager`
 * `/fishshop` `/webui` `/npcmanage` `/bossmanage` `/igen` `/moonphase` …）不在本页收录：
 * `data/commands.json` 只收 TShock 内置指令，插件指令的语法要读各自插件源码才能核实。
 */

export interface TipsGroup {
  /** 分组 id（也是 i18n key 的后缀：`commands.group.<id>`）。 */
  id: string
  /** 侧栏标题。 */
  titleKey: string
  /** 分区的语法行（有可点条目时用）。 */
  usageKey?: string
  /** 分区说明行。 */
  hintKey?: string
  /** 参考型分组收录的内置指令名（语法来自 `dataset.commands[].paramSets`）。 */
  commands?: readonly string[]
  /** 这个分组里额外给一个「在数据 ID → NPC 里查更多」的入口。 */
  npcLink?: boolean
}

/** 侧栏顺序：世界 → NPC → 物品 → 增益 → 生命 → 传送 → 建筑 → 用户 → 权限配置 → 服务器 → 聊天。 */
export const TIPS_GROUPS: readonly TipsGroup[] = [
  { id: 'event', titleKey: 'commands.group.event', usageKey: 'commands.group.event.usage' },
  { id: 'invasion', titleKey: 'commands.group.invasion', usageKey: 'commands.group.invasion.usage' },
  { id: 'holiday', titleKey: 'commands.group.holiday', usageKey: 'commands.group.holiday.usage' },
  { id: 'worldmode', titleKey: 'commands.group.worldmode', usageKey: 'commands.group.worldmode.usage' },
  { id: 'time', titleKey: 'commands.group.time', usageKey: 'commands.group.time.usage' },
  { id: 'wind', titleKey: 'commands.group.wind', usageKey: 'commands.group.wind.usage' },

  { id: 'boss', titleKey: 'commands.group.boss', usageKey: 'commands.group.boss.usage' },
  { id: 'mob', titleKey: 'commands.group.mob', usageKey: 'commands.group.mob.usage' },
  {
    id: 'npctp',
    titleKey: 'commands.group.npctp',
    usageKey: 'commands.group.npctp.usage',
    hintKey: 'commands.group.npctp.hint',
    npcLink: true,
  },
  { id: 'spawnrate', titleKey: 'commands.group.spawnrate', usageKey: 'commands.group.spawnrate.usage' },
  { id: 'godmode', titleKey: 'commands.group.godmode', usageKey: 'commands.group.godmode.usage', hintKey: 'commands.group.godmode.hint' },
  { id: 'npcadmin', titleKey: 'commands.group.npcadmin', hintKey: 'commands.group.npcadmin.hint', commands: ['butcher', 'renamenpc'] },

  { id: 'item', titleKey: 'commands.group.item', commands: ['give', 'item'] },
  { id: 'buff', titleKey: 'commands.group.buff', commands: ['buff', 'gbuff'] },
  { id: 'vital', titleKey: 'commands.group.vital', commands: ['heal', 'kill', 'slap', 'rest', 'respawn'] },

  {
    id: 'tp',
    titleKey: 'commands.group.tp',
    commands: ['tp', 'tphere', 'tppos', 'pos', 'tpallow', 'warp', 'home', 'spawn', 'setspawn', 'settle', 'protectspawn'],
  },
  {
    id: 'build',
    titleKey: 'commands.group.build',
    commands: ['region', 'antibuild', 'itemban', 'projban', 'tileban', 'setdungeon', 'grow', 'clear'],
  },

  { id: 'account', titleKey: 'commands.group.account', hintKey: 'commands.group.account.hint', commands: ['register', 'login', 'password', 'logout'] },
  {
    id: 'useradmin',
    titleKey: 'commands.group.useradmin',
    usageKey: 'commands.group.useradmin.usage',
    hintKey: 'commands.group.useradmin.hint',
    commands: ['accountinfo', 'userinfo'],
  },
  { id: 'ban', titleKey: 'commands.group.ban', usageKey: 'commands.group.ban.usage', hintKey: 'commands.group.ban.hint' },
  { id: 'mutekick', titleKey: 'commands.group.mutekick', hintKey: 'commands.group.mutekick.hint', commands: ['mute', 'kick'] },
  { id: 'ugroup', titleKey: 'commands.group.ugroup', hintKey: 'commands.group.ugroup.hint', commands: ['group', 'tempgroup'] },
  {
    id: 'permsetup',
    titleKey: 'commands.group.permsetup',
    usageKey: 'commands.group.permsetup.usage',
    hintKey: 'commands.group.permsetup.hint',
  },

  {
    id: 'server',
    titleKey: 'commands.group.server',
    commands: [
      'broadcast',
      'motd',
      'rules',
      'playing',
      'save',
      'reload',
      'version',
      'serverpassword',
      'off',
      'off-nosave',
      'checkupdates',
      'displaylogs',
      'aliases',
      'help',
      'serverinfo',
      'dump-reference-data',
      'sync',
      'su',
      'sudo',
      'whitelist',
    ],
  },
  {
    id: 'chat',
    titleKey: 'commands.group.chat',
    commands: [
      'me',
      'party',
      'reply',
      'whisper',
      'death',
      'pvpdeath',
      'alldeath',
      'allpvpdeath',
      'bossdamage',
      'rocket',
      'firework',
      'annoy',
      'wallow',
      'clearangler',
    ],
  },
]
