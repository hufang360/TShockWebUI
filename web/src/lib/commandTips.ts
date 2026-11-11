/**
 * 「指令小抄」页的**分组定义**（手工维护；分组标题 / 说明在 `lib/i18n.tsx`）。
 *
 * 两种分组：
 * - **有可点条目的**（世界事件、时间、召唤 Boss…）：语法行用 `usageKey`（只在详情抽屉里显示），具体指令在页面里生成
 *   （见 `CommandTipsPage` 的 `curatedRows`）；单击行打开详情，在详情里把完整指令填进「指令」浮窗。
 * - **参考型分组**（物品、增益、传送、服务器…）：`commands` 列 TShock 内置指令名，
 *   语法取自 `data/commands.json` 的 `paramSets`（由 TShock 6.2.1 源码提取，**不猜**），
 *   页面渲染成参考行（详情里只能复制），`allowServer=false` 的会标「仅游戏内」。
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
  /**
   * 单条指令自己的语法行（键 = 指令名，值 = i18n key），优先于分区语法行。
   * `/maxspawns` 与 `/spawnrate` 同属一个分区，但各自只该显示自己那条。
   */
  usageKeys?: Record<string, string>
  /**
   * 这些指令的详情只讲它自己：不套分区的语法行与使用提示
   * （`/kick` `/mute` 不该显示 `/ban` 的语法；`/tempgroup` 不该显示 `/group` 的提示）。`true` = 整组。
   */
  selfOnly?: readonly string[] | true
  /** 分区说明行。 */
  hintKey?: string
  /** 参考型分组收录的内置指令名（语法来自 `dataset.commands[].paramSets`）。 */
  commands?: readonly string[]
  /**
   * 额外折叠：这几条指令在表格里折成一行（首条指令作为折叠行，如 `/death` 收起 `/pvpdeath` 等）。
   * 同一条指令的多个子命令（`/region define`、`/region protect` …）**不用写**，会自动按指令名折。
   */
  folds?: readonly (readonly string[])[]
  /**
   * 整组折进同一个折叠行（值 = 折叠行显示的指令前缀），优先级低于条目自己的 `fold`。
   * `/worldevent` 与 `/worldevent invasion` 两个分区都折进 `/worldevent`，表格里只剩一行。
   */
  foldAs?: string
}

/**
 * 详情里的「相关指令」（手工维护）：键 / 值都是指令规范名，值里的每条都会在该指令的详情里出现，
 * 点一下把弹框切到那一条。只连「同一个人会顺手用」的指令，不做全量两两互链。
 */
export const RELATED_COMMANDS: Record<string, readonly string[]> = {
  maxspawns: ['spawnrate'],
  spawnrate: ['maxspawns'],
  kick: ['mute', 'ban'],
  mute: ['kick', 'ban'],
  ban: ['kick', 'mute'],
  register: ['login', 'password', 'logout'],
  login: ['register', 'password', 'logout'],
  password: ['register', 'login', 'logout'],
  logout: ['register', 'login', 'password'],
  user: ['accountinfo', 'userinfo'],
  accountinfo: ['userinfo', 'user'],
  userinfo: ['accountinfo', 'user'],
  group: ['tempgroup'],
  tempgroup: ['group'],
  itemban: ['projban', 'tileban'],
  projban: ['itemban', 'tileban'],
  tileban: ['itemban', 'projban'],
  warp: ['home', 'spawn', 'tp'],
  home: ['warp', 'spawn'],
  spawn: ['warp', 'home'],
  tp: ['warp', 'tphere'],
  butcher: ['renamenpc'],
  renamenpc: ['butcher'],
  forcehalloween: ['forcexmas', 'worldevent'],
  forcexmas: ['forcehalloween', 'worldevent'],
  worldevent: ['forcehalloween', 'forcexmas'],
  hardmode: ['evil', 'worldinfo'],
  evil: ['hardmode', 'worldinfo'],
  worldinfo: ['hardmode', 'evil'],
}

/** 侧栏顺序：世界 → NPC → 物品 → 增益 → 生命 → 传送 → 建筑 → 用户 → 权限配置 → 服务器 → 聊天。 */
export const TIPS_GROUPS: readonly TipsGroup[] = [
  // 事件与入侵都收在 `/worldevent` 一行里（入侵的条目在 page 里并进本分区，表格只折一行）
  { id: 'event', titleKey: 'commands.group.event', usageKey: 'commands.group.event.usage', foldAs: '/worldevent' },
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
  },
  {
    id: 'spawnrate',
    titleKey: 'commands.group.spawnrate',
    usageKeys: {
      maxspawns: 'commands.group.spawnrate.maxspawns.usage',
      spawnrate: 'commands.group.spawnrate.spawnrate.usage',
    },
  },
  { id: 'godmode', titleKey: 'commands.group.godmode', usageKey: 'commands.group.godmode.usage' },
  { id: 'npcadmin', titleKey: 'commands.group.npcadmin', commands: ['butcher', 'renamenpc'] },

  // `/give` + `/item`、`/buff` + `/gbuff` 折成一行（同一件事的两个方向）
  { id: 'item', titleKey: 'commands.group.item', commands: ['give', 'item'], folds: [['give', 'item']] },
  { id: 'buff', titleKey: 'commands.group.buff', commands: ['buff', 'gbuff'], folds: [['buff', 'gbuff']] },
  { id: 'vital', titleKey: 'commands.group.vital', commands: ['heal', 'kill', 'slap', 'rest', 'respawn'] },

  {
    id: 'tp',
    titleKey: 'commands.group.tp',
    commands: ['tp', 'tphere', 'tppos', 'pos', 'tpallow', 'warp', 'home', 'spawn', 'setspawn', 'settle', 'protectspawn'],
    // 传送玩家的五条折进 `/tp`（其余 `/warp` `/home` 各自成行）
    folds: [['tp', 'tphere', 'tppos', 'pos', 'tpallow']],
  },
  {
    id: 'build',
    titleKey: 'commands.group.build',
    commands: ['region', 'antibuild', 'setdungeon', 'grow', 'clear'],
  },

  {
    id: 'account',
    titleKey: 'commands.group.account',
    // 自助指令各说各的，套一段「注册 / 登录 / 改密 / 查账号」的合集只会误导。
    selfOnly: true,
    commands: ['register', 'login', 'password', 'logout', 'accountinfo', 'userinfo'],
  },
  {
    id: 'ban',
    titleKey: 'commands.group.ban',
    usageKey: 'commands.group.ban.usage',
    hintKey: 'commands.group.ban.hint',
    // 物品 / 弹幕 / 物块封禁也属于「封禁」，但它们各说各的（不套 `/ban` 的语法与提示）
    selfOnly: ['mute', 'kick', 'itemban', 'projban', 'tileban'],
    commands: ['mute', 'kick', 'itemban', 'projban', 'tileban'],
  },
  { id: 'ugroup', titleKey: 'commands.group.ugroup', hintKey: 'commands.group.ugroup.hint', selfOnly: ['tempgroup'], commands: ['group', 'tempgroup'] },
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
    // 四个死亡次数开关折成一行，不占四行
    folds: [['death', 'pvpdeath', 'alldeath', 'allpvpdeath']],
  },
]
