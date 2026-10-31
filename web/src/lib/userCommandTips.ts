import type { CommandTip } from '@/lib/worldCommandTips'

/**
 * 「用户管理」/「权限配置」分组用的指令清单（**手工维护**）。
 *
 * 来源：TShock 6.2.1 源码 `TShockAPI/Commands.cs`（行号见每条注释），
 * 并用本服 `POST /v3/server/rawcmd` 实测过（`/user help`、`/ban help`、`/ban list` 都返回预期的帮助 / 列表）。
 *
 * 只有**参数固定、点了就能跑**的写法才做成可点的行；带占位符的（如 `/ban add <目标>`）
 * 只写进分区语法行 / 说明行，避免往浮窗里填一段跑不通的占位文本。
 *
 * `allowServer=false` 的四条（`/login` `/logout` `/password` `/register`）网页端执行会被 TShock 拒绝，
 * 所以页面上只作为「游戏内怎么用」的说明。
 */

/** `/user help`：ManageUsers() 的 help 分支（Commands.cs:1114）。 */
export const USER_ACCOUNT_COMMANDS: CommandTip[] = [
  {
    command: '/user help',
    label: { zh: '列出 /user 的全部子命令', en: 'List /user subcommands' },
  },
]

/** `/ban` 的只读子命令：Ban() 的 help / list 分支（Commands.cs:1388）。 */
export const BAN_COMMANDS: CommandTip[] = [
  { command: '/ban list', label: { zh: '查看当前封禁列表', en: 'List active bans' } },
  { command: '/ban help', label: { zh: '查看封禁用法', en: 'Ban help' } },
]

/**
 * 「权限配置」：把 WebUI 与常用插件的能力开给 `default` 组（**本服实测**，命令原文见仓库 `notes.md`）。
 *
 * 语法核对（TShock 6.2.1 源码）：
 * - `TShockAPI/Commands.cs` 的 `Group()`（3471）——`add` / `addperm`，权限可一次给多个；
 * - `TShockAPI/Group.cs`：`AddPermission()`（277）认 `!权限` 表示**取反**，
 *   `HasPermission()`（212）认 `*` / `tshock.*` 这类**通配**，所以 `* !tshock.ignore.ssc` = 全部权限但要保留 SSC 检查。
 *
 * 插件权限名（`hf.recipe` / `hf.search` / `worldinfo` / `bossinfo` / `lookbag`）来自本服插件配置与实测，
 * 不在 `data/permissions.json`（那份只收 TShock 内置节点）。
 */
export const PERM_SETUP_COMMANDS: CommandTip[] = [
  {
    command: '/group addperm default tshock.rest.useapi tshock.rest.command',
    label: { zh: '允许网页登录、执行指令', en: 'Allow web login and commands' },
    note: { zh: 'WebUI 前置；default 默认没有', en: 'Required by the web UI; off by default' },
  },
  {
    command: '/group add GM * !tshock.ignore.ssc',
    label: { zh: '新建 GM 组（全权限）', en: 'Create a GM group (all permissions)' },
    note: { zh: '* = 全部，! = 去掉（保留 SSC）', en: '* = all, ! = remove (SSC kept)' },
  },
  {
    command: '/group addperm default tshock.tp.home',
    label: { zh: '允许 /home', en: 'Allow /home' },
  },
  {
    command: '/group addperm default hf.recipe hf.search',
    label: { zh: '查一查插件：/r 合成表、/s 物品 ID', en: 'Recipes plugin: /r recipes, /s item ids' },
  },
  {
    command: '/group addperm default worldinfo bossinfo',
    label: { zh: '世界管理插件：/wi 世界信息、/bi Boss 进度', en: 'World plugin: /wi world info, /bi boss progress' },
  },
  {
    command: '/group addperm default lookbag',
    label: { zh: '玩家管理插件：/lb 查背包', en: 'Player manager plugin: /lb look bag' },
  },
]
