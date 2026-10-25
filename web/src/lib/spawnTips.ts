import { quoteArg } from '@/lib/commandFormat'
import type { Npc } from '@/types'

/**
 * 「召唤 NPC」页的数据与指令拼装。
 *
 * 来源（已核实，不猜）：
 * - Boss 清单 / 顺序 / 括号备注：TShock `TShockAPI/Commands.cs` 的 `ShowSpawnTips()`；
 * - `/spawnboss` 的合法参数：同文件 `SpawnBoss()` 的 `switch`（已由生成器写进 `data/npcs.json` 的 `sb`）；
 * - `/spawnmob`：同文件 `SpawnMob()` → `Utils.GetNPCByIdOrName()`（数字 ID 或名称，中英文名都匹配）；
 * - `/tpnpc`：同文件 `TPNpc()` → **只接受名称**（服务器语言名或英文名，前缀匹配），**不接受 ID**。
 *
 * 三条指令都是 `allowServer=false`：默认只能在游戏内执行。所以这里只负责**生成指令**，
 * 由页面把它追加到右下角「指令」浮窗（服主开启「允许执行游戏内指令」后才能直接在网页里跑）。
 */

export interface SpawnBossTip {
  /** `/spawnboss` 的规范参数（`data/npcs.json` 里的 `sb`，即 SpawnBoss() 最长的 case 标签）。 */
  sb: string
  /** `ShowSpawnTips()` 括号内的补充说明。 */
  note?: { zh: string; en: string }
  /** 名称覆盖：`sb` 指向的 NPC 名不是玩家熟悉的那个时用（如 twins 指向 Spazmatism）。 */
  name?: { zh: string; en: string }
}

/** 与 TShock `Commands.ShowSpawnTips()` 一致的顺序与备注。 */
export const SPAWN_BOSS_TIPS: SpawnBossTip[] = [
  { sb: 'king slime' },
  { sb: 'eye of cthulhu', note: { zh: '时间会调到晚上', en: 'Sets time to night' } },
  {
    sb: 'brain of cthulhu',
    note: { zh: '不在猩红之地会脱战', en: 'Despawns outside the Crimson' },
  },
  {
    sb: 'eater of worlds',
    note: { zh: '不在腐化之地会脱战', en: 'Despawns outside the Corruption' },
  },

  { sb: 'queen bee' },
  { sb: 'skeletron', note: { zh: '时间会调到晚上', en: 'Sets time to night' } },
  { sb: 'deerclops' },
  { sb: 'wall of flesh', note: { zh: '得在地狱', en: 'Must be in the Underworld' } },

  { sb: 'queen slime' },
  { sb: 'skeletron prime' },
  { sb: 'twins', name: { zh: '双子魔眼', en: 'The Twins' }, note: { zh: '时间会调到晚上', en: 'Sets time to night' } },
  { sb: 'destroyer', note: { zh: '时间会调到晚上', en: 'Sets time to night' } },

  { sb: 'plantera' },
  { sb: 'golem' },
  {
    sb: 'empress of light',
    note: { zh: '不会将时间调到晚上', en: 'Does not set time to night' },
  },
  { sb: 'duke fishron' },

  {
    sb: 'mourning wood',
    note: { zh: '不会调到晚上，白天会脱战', en: 'No time change; despawns in daytime' },
  },
  {
    sb: 'pumpking',
    note: { zh: '不会调到晚上，白天会脱战', en: 'No time change; despawns in daytime' },
  },
  {
    sb: 'everscream',
    note: { zh: '不会调到晚上，白天会脱战', en: 'No time change; despawns in daytime' },
  },
  {
    sb: 'ice queen',
    note: { zh: '不会调到晚上，白天会脱战', en: 'No time change; despawns in daytime' },
  },

  {
    sb: 'santa-nk1',
    note: { zh: '不会调到晚上，白天会脱战', en: 'No time change; despawns in daytime' },
  },
  { sb: 'flying dutchman' },
  { sb: 'martian saucer' },
  {
    sb: 'betsy',
    note: { zh: '可召唤多只，玩家死亡不脱战', en: 'Multiple at once; survives player death' },
  },

  { sb: 'solar pillar' },
  { sb: 'vortex pillar' },
  { sb: 'nebula pillar' },
  { sb: 'stardust pillar' },

  { sb: 'lunatic cultist' },
  { sb: 'moon lord', name: { zh: '月亮领主', en: 'Moon Lord' } },
]

/**
 * 「召唤 NPC」卡的示例（按 `NPCID` 常量名解析）。`/spawnmob` 接受数字 ID，
 * 所以生成的指令用 ID（不受界面 / 服务器语言影响）。
 */
export const SPAWN_MOB_EXAMPLES = ['Guide', 'TravellingMerchant'] as const

/**
 * 「传送 NPC」卡的示例。`/tpnpc` **只接受名称**（TShock 的 `TPNpc()` 不解析 ID），
 * 所以生成的指令用英文名；页面上同时显示 NPC ID 方便对照。
 */
export const TP_NPC_EXAMPLES = ['Angler', 'GoblinTinkerer'] as const

/** `/spawnboss <boss>`（不含数量参数，默认 1）。 */
export function spawnBossCommand(sb: string): string {
  return `/spawnboss ${quoteArg(sb)}`
}

/** `/spawnmob <名称或 ID>`（不含数量参数，默认 1）。 */
export function spawnMobCommand(token: string | number): string {
  return `/spawnmob ${quoteArg(String(token))}`
}

/**
 * `/tpnpc <名称>`：**用英文名**——TShock 同时匹配服务器语言名与英文名，
 * 英文名在中文 / 英文服务器上都能命中；ID 不被接受。
 */
export function tpNpcCommand(npc: Pick<Npc, 'key' | 'en'>): string {
  return `/tpnpc ${quoteArg(npc.en || npc.key)}`
}
