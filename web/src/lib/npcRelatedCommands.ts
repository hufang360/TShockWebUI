import { spawnBossCommand, tpNpcCommand } from '@/lib/spawnTips'
import type { Npc } from '@/types'

/**
 * NPC 详情「相关指令」的指令清单：**按展示顺序**生成，全部只用 ID 或英文名，
 * 不依赖服务器语言（与「指令小抄」页同一口径）。
 *
 * 来源（不猜）：
 * - `/spawnboss`（`/sb`）：`data/npcs.json` 的 `sb` / `sbAliases`（`tools/gen-data.mjs` 从
 *   TShock `SpawnBoss()` 的 `switch` 解析）；
 * - `/spawnmob`：TShock `SpawnMob()`，接受数字 ID；
 * - `/tpnpc`：TShock `TPNpc()` **只接受名称**（服务器语言名或英文名，前缀匹配），不认 ID；
 *   只给城镇 NPC（非城镇 NPC 没有固定名字，`/tpnpc <英文名>` 基本找不到目标）；
 * - `/renameNPC`：TShock `RenameNPC()`，语法 `renameNPC <guide, nurse, etc.> <newname>`
 *   （见 `data/commands.json`）。但**只对城镇 NPC（`townNPC == true`）生效**，
 *   所以只有 `NPC_TOWN_IDS` 里的 NPC 才给这一行；参数用 ID（名字有重名，见 `renameNpcCommand`），
 *   新名字留 `<newname>` 让玩家自己改；
 * - `/npc <ID|名称>`：服务器上的 NPC 解救状态开关（见 `NPC_STATE_TOGGLE_IDS`）；
 * - `/setdungeon` / `/wm dungeon`：地牢坐标点（设置 / 查看，见 `NPC_DUNGEON_IDS`）；
 * - Boss 的 `/sb all`：TShock `SpawnBoss()` 的 `all` / `*`（数据里 `sbAll` 标记了哪些 Boss 被算进「全部」）；
 * - Boss 的召唤物：`/give <召唤物ID> <玩家>`，对应关系见 `NPC_SUMMON_ITEM`。
 *
 * 这些都是 `allowServer=false` 的指令（`/renameNPC` 除外）：网页端只负责**生成 / 复制**，
 * 能不能执行始终由 TShock / 插件判定。
 */

/** 「相关指令」里的一条：指令原文 + 悬停这一行时显示的说明。 */
export interface RelatedCommand {
  command: string
  /** 说明的 i18n 键（+ 变量）；没有就不显示悬停提示。 */
  note?: { key: string; vars?: Record<string, string | number> }
}

/** 新增条目用到的说明文案键（`web/src/lib/i18n.tsx` 里同名的 `commandLine.note.*`）。 */
export const RELATED_NOTE = {
  spawnAll: 'commandLine.note.spawnAll',
  summonItem: 'commandLine.note.summonItem',
  setDungeon: 'commandLine.note.setDungeon',
  viewDungeon: 'commandLine.note.viewDungeon',
} as const

/**
 * 地牢相关 NPC → 给 `/setdungeon`（把地牢点设到你的位置）+ `/wm dungeon`（查看地牢点）。
 *
 * 来源：玩家指定（2025-11-02）。`/wm dungeon` 不在 `data/commands.json` 里（那份由 TShock 源码生成，
 * `/worldmode` 的枚举只有 normal / expert / master / journey / creative），说明是插件提供的子命令。
 */
export const NPC_DUNGEON_IDS: ReadonlySet<number> = new Set([
  37, // Old Man
  54, // Clothier
  68, // Dungeon Guardian
  379, // Cultist Archer
  437, // Mysterious Tablet
  438, // Lunatic Devotee
  439, // Lunatic Cultist
])

/**
 * 额外给 `/tpnpc` 的非城镇 NPC（玩家指定）：有固定名字、值得直接传过去。
 * 城镇 NPC 本来就都给（见 `NPC_TOWN_IDS`）。
 */
export const NPC_TP_EXTRA_IDS: ReadonlySet<number> = new Set([
  379, // Cultist Archer
  438, // Lunatic Devotee
])

/**
 * Boss → 它的**召唤物**（物品 ID）。行内容为 `/give <召唤物> <玩家名>`，悬停提示给物品名。
 *
 * 清单由玩家提供（2025-11-02）：560,43,70,1331,1133,5120,4988,556,544,557,5334,1293,2673,3601,267,
 * 4271,361,1315,2767,602,1844,1958。其中 5334（机械缝合体召唤物）与事件召唤物
 * （4271 血月 / 361 哥布林 / 1315 海盗 / 2767 日食 / 602 霜月前哨 / 1844 南瓜月 / 1958 霜月）
 * **没有单一对应 NPC**，所以不挂在某个 NPC 的详情里（清单见 `docs/页面-数据ID.md` §6.1）。
 */
export const NPC_SUMMON_ITEM: ReadonlyMap<number, number> = new Map([
  [50, 560], // King Slime ← Slime Crown
  [4, 43], // Eye of Cthulhu ← Suspicious Looking Eye
  [13, 70], // Eater of Worlds ← Worm Food
  [266, 1331], // Brain of Cthulhu ← Bloody Spine
  [222, 1133], // Queen Bee ← Abeemination
  [668, 5120], // Deerclops ← Deer Thing
  [657, 4988], // Queen Slime ← Gelatin Crystal
  [134, 556], // Destroyer ← Mechanical Worm
  [125, 544], // The Twins ← Mechanical Eye
  [126, 544], // The Twins（另一段身体）
  [127, 557], // Skeletron Prime ← Mechanical Skull
  [245, 1293], // Golem ← Lihzahrd Power Cell
  [370, 2673], // Duke Fishron ← Truffle Worm
  [398, 3601], // Moon Lord ← Celestial Sigil
  [113, 267], // Wall of Flesh ← Guide Voodoo Doll
])

/**
 * 能用 `/npc <ID|名称>` 切换「已解救 / 已购买」状态的 NPC ID。
 *
 * 来源：服务器 `/npc` 指令的 `switch`（玩家提供的实现，2025-… 实测），按解救事件分组：
 * 渔夫 / 哥布林工匠 / 机械师 / 发型师 / 酒馆老板 / 高尔夫球手 / 巫师 / 税收官 /
 * 猫 / 狗 / 兔兔 / 1.4.4.5 的 8 只史莱姆。每个分组都同时登记了「未解救形态」的 ID
 * （如沉睡渔夫 376、受缚哥布林 105），所以它们自己的详情页也能给出这条指令。
 */
export const NPC_STATE_TOGGLE_IDS: ReadonlySet<number> = new Set([
  // 渔夫（沉睡渔夫）
  369, 376,
  // 哥布林工匠（受缚哥布林）
  107, 105,
  // 机械师（受缚机械师）
  123, 124,
  // 发型师（被网住的发型师）
  353, 354,
  // 酒馆老板（昏迷男子）
  550, 579,
  // 高尔夫球手
  588, 589,
  // 巫师（受缚巫师）
  106, 108,
  // 税收官（痛苦亡魂）
  441, 534,
  // 猫 / 狗 / 兔兔（宠物许可证）
  637, 638, 656,
  // 1.4.4.5 史莱姆：呆瓜 / 冷酷 / 年长 / 笨拙 / 唱将 / 粗暴 / 神秘 / 侍卫
  670, 678, 679, 680, 681, 682, 683, 684,
])

/** Boss 的单字简写（优先 `sbAliases` 里不等于全名的项，其次取全名第一个词）。 */
export function bossShortAlias(npc: Npc): string | null {
  if (!npc.sb) return null
  const alias = npc.sbAliases?.find((a) => a && a !== npc.sb)
  const short = alias ?? npc.sb.split(/\s+/)[0]
  return short && short !== npc.sb ? short : null
}

/**
 * `/renameNPC <ID> <newname>`：**用 ID 而不是名字** —— TShock 的 `RenameNPC()` 走
 * `Utils.GetNPCByIdOrName()`，名字是「首个完全匹配」：`Bunny`（城镇兔兔 656）会先命中
 * 小动物兔子 46、`Golfer` 也同时对应 588/589，按名字会改错 / 报 “Could not rename”。
 * 新名字没有默认值，留 `<newname>` 占位 —— 玩家复制后自己替换。
 */
export function renameNpcCommand(id: number, newName = '<newname>'): string {
  return `/renameNPC ${id} ${newName}`
}

/**
 * `/renameNPC` 能改名的 NPC（**必须是城镇 NPC**）。
 *
 * 来源：TShock `Commands.cs` 的 `RenameNPC()` —— 只改 `Main.npc[i].townNPC == true` 的 NPC；
 * `townNPC` 由 Terraria `NPC.SetDefaults()` 逐类型赋值（`else if (type == N) { townNPC = true; … }`），
 * 这里列出全部这类 N。受缚 / 沉睡 / 被网 / 昏迷形态**不算**（它们不是城镇 NPC，改不了名）。
 * 与用户给的清单一致（`17,18,19,20,22,38,54,…`），另含 `37`（Old Man，Terraria 也给它 `townNPC = true`）。
 */
export const NPC_TOWN_IDS: ReadonlySet<number> = new Set([
  // 基础城镇 NPC（含 Old Man 37）
  17, 18, 19, 20, 22, 37, 38, 54,
  // 解救后的形态（105 受缚哥布林 / 106 受缚巫师 / 123 受缚机械师 / 354 被网发型师…都不算）
  107, 108, 124, 142, 160, 178, 207, 208, 209, 227, 228, 229, 353, 368, 369, 441, 550, 588, 633,
  663,
  // 宠物与城镇史莱姆（也是 townNPC）
  637, 638, 656, 670, 678, 679, 680, 681, 682, 683, 684,
])

/** `/npc <ID>`：切换该 NPC 的「已解救 / 已购买」状态（用 ID，不受语言影响）。 */
export function toggleNpcCommand(id: number): string {
  return `/npc ${id}`
}

/**
 * NPC 详情「相关指令」：召唤（Boss / 召唤物 / 普通）→ 传送 + 改名 → 地牢点 → 解救状态。
 *
 * @param itemName 召唤物名字（悬停提示里用）；拿不到就只显示「召唤物品」。
 * @param username 当前登录玩家名：召唤物那条要拼 `/give <物品> <玩家>`，未登录就没有这一行。
 */
export function npcRelatedCommands(
  npc: Npc,
  { itemName, username }: { itemName?: (itemId: number) => string | undefined; username?: string | null } = {},
): RelatedCommand[] {
  const commands: RelatedCommand[] = []
  if (npc.sb) {
    commands.push({ command: spawnBossCommand(npc.sb) })
    const short = bossShortAlias(npc)
    if (short) commands.push({ command: `/sb ${short}` })
    // 只有「算进 /sb all」的 Boss 才给这一行（数据里的 `sbAll`，来自 SpawnBoss() 的 all 分支）。
    if (npc.sbAll) {
      commands.push({ command: '/sb all', note: { key: RELATED_NOTE.spawnAll } })
    }
  }
  const summonItem = NPC_SUMMON_ITEM.get(npc.id)
  if (summonItem != null && username) {
    const name = itemName?.(summonItem)
    commands.push({
      command: `/give ${summonItem} ${username}`,
      note: name
        ? { key: RELATED_NOTE.summonItem, vars: { name } }
        : { key: RELATED_NOTE.summonItem, vars: { name: `#${summonItem}` } },
    })
  }
  // `/sm` 是 `/spawnmob` 的别名，写短的（与 Boss 的 `/sb` 同一口径）。
  commands.push({ command: `/sm ${npc.id}` })
  // 传送只给城镇 NPC 与指定的几个非城镇 NPC（`/tpnpc` 只认名字，怪物没有稳定的名字）。
  if (NPC_TOWN_IDS.has(npc.id) || NPC_TP_EXTRA_IDS.has(npc.id)) {
    commands.push({ command: tpNpcCommand(npc) })
  }
  if (NPC_TOWN_IDS.has(npc.id)) commands.push({ command: renameNpcCommand(npc.id) })
  if (NPC_DUNGEON_IDS.has(npc.id)) {
    commands.push({ command: '/setdungeon', note: { key: RELATED_NOTE.setDungeon } })
    commands.push({ command: '/wm dungeon', note: { key: RELATED_NOTE.viewDungeon } })
  }
  if (NPC_STATE_TOGGLE_IDS.has(npc.id)) commands.push({ command: toggleNpcCommand(npc.id) })
  return commands
}
