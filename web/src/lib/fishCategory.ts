import { ITEM_COLLECTIONS } from './collections'
import type { FishGood } from './tshock'

/**
 * 鱼店货架的**分类**（工具条「收藏」右边那颗下拉）。
 *
 * 判据全部来自 `/api/fish/list` 已有的字段（`id` / `cmds`），不需要后端与插件配合：
 * - `id > 0` = 原版物品 → 按物品 id 归（地牢那批掉落物、钓鱼那批渔具）；
 * - `id < 0` = 插件内置商品 / 服务 → 按 `ShopItemID.cs` 的 id 段归（buff / 召唤 / 清除 npc …）；
 * - `cmds` → 按**指令根**归（建造、npc、团队这些服主自己写进 config 的商品没有固定 id）。
 *
 * **多标签**：一件商品可以同时属于多个分类（`-146` 在召唤 ∪ 世界事件，`-169` 在 buff ∪ 钓鱼，
 * `-160` 的建造商品在指令 ∪ 建造）。分类是「筛选器」，不是互斥分区。
 *
 * 规则细节与出处见 `docs/插件-鱼店.md` §4.2。
 */
export type FishCategoryId =
  | 'dungeon'
  | 'buff'
  | 'cmd'
  | 'build'
  | 'summon'
  | 'team'
  | 'npc'
  | 'fun'
  | 'reforge'
  | 'fishing'
  | 'worldEvent'

interface MatchRule {
  /** 精确 id（原版物品 id 也算在这里：`id > 0` 就是物品 id）。 */
  ids?: readonly number[]
  /** 闭区间 [a, b]，写反了也能用。 */
  ranges?: readonly (readonly [number, number])[]
  /** `cmds` 的**指令根**（去掉前导 `/`、取第一个词、小写）。只认根，不认参数。 */
  cmdRoots?: readonly string[]
}

/** 地牢掉落物（`data/items.json` 按中文名反查；`fishCategory.realdata.test.ts` 逐条校验）。 */
const DUNGEON_IDS = [
  155, // 村正
  156, // 钴护盾
  163, // 蓝月
  113, // 魔法飞弹
  3317, // 英勇球
  164, // 手枪
  329, // 暗影钥匙
  5465, // 牧羊符文（游戏内中文名叫「重锤符文」，插件名字表叫牧羊符文）
  6156, // 银护腕
  327, // 金钥匙
  2192, // 骨头焊机
  1156, // 食人鱼枪
  1571, // 腐化者之戟
  1569, // 吸血鬼刀
  1260, // 彩虹枪
  1572, // 寒霜九头蛇法杖
  4607, // 沙漠虎杖
] as const

/**
 * buff 类：插件预设（`-145` 好运来、`-159` 增益、`-166~-170` 打神鞭…兴奋剂）
 * 加本服 `settings.json` 里带 `buffs` 的 `-603~-609`。
 * REST 不回 `buffs`，所以「带 buff 的 `-160` 组合商品」认不出来（见文档的已知限制）。
 */
const BUFF_IDS = [-145, -159, -166, -167, -168, -169, -170, -603, -604, -605, -606, -607, -608, -609] as const

/** 「物品 ID」页的 `渔业...` 集合：直接复用，别另抄一份 id。 */
const FISHING_COLLECTION_ID = 'category:渔业...'
const FISHING_COLLECTION_IDS =
  ITEM_COLLECTIONS.find((collection) => collection.id === FISHING_COLLECTION_ID)?.ids ?? []

/** 展示顺序 = 工具条下拉里的顺序（需求：钓鱼 / buff / npc 最前，地牢紧挨在世界事件前面）。 */
export const FISH_CATEGORIES: readonly { id: FishCategoryId; iconId: number; rule: MatchRule }[] = [
  // 2294 金钓竿
  { id: 'fishing', iconId: 2294, rule: { ids: [-142, -169, ...FISHING_COLLECTION_IDS] } },
  // 2354 钓鱼药水
  { id: 'buff', iconId: 2354, rule: { ids: BUFF_IDS, ranges: [[-5999, -5000]] } },
  // 267 向导巫毒娃娃（`/npc` 那些「卖 NPC」的商品）
  { id: 'npc', iconId: 267, rule: { ids: [-161, -901], ranges: [[-4999, -4000]], cmdRoots: ['npc', 'tpnpc'] } },
  // 149 书（指令类商品 = 一张指令清单）
  { id: 'cmd', iconId: 149, rule: { ids: [-160] } },
  // 3061 建筑师发明背包；不含 /wm（`/wm` 是 /igen 的另一个入口），`/ct` 是 `/cleartomb` 的简写
  { id: 'build', iconId: 3061, rule: { cmdRoots: ['igen', 'clip', 'cleartomb', 'ct'] } },
  // 560 史莱姆王冠
  // -146 跳过入侵、-150 跳过血月；-601 挑战白光（`cmds` 只是 `/time day` + `/sb eol`，没有召唤 NPC 的 id 段）；
  // -171~-176 召唤入侵、-149 召唤血月；-182 血月 / -183 日食 / -178 史莱姆雨
  // （入侵与「事件」类算召唤，天气与时刻不算）
  {
    id: 'summon',
    iconId: 560,
    rule: { ids: [-146, -149, -150, -601, -178, -182, -183], ranges: [[-1999, -1000], [-176, -171]] },
  },
  // 3636 粉团队块；-602 全军出击 / -603 弹无虚发 是 config 里的预设，没有常量；
  // `/tphere` 覆盖同类自定义商品；-141 烟花起飞
  { id: 'team', iconId: 3636, rule: { ids: [-162, -163, -602, -141], cmdRoots: ['tphere'] } },
  // 215 整蛊坐垫
  { id: 'fun', iconId: 215, rule: { ids: [-189, -190, -902, -906, -907] } },
  // 398 工匠作坊
  { id: 'reforge', iconId: 398, rule: { ids: [-900, -191, -904, -905] } },
  // 148 水蜡烛
  { id: 'dungeon', iconId: 148, rule: { ids: DUNGEON_IDS } },
  // 4766 世界球
  // 月相 -131~-139 / 雨 -143~-144 / 时间与血月 -146~-150 / 正午午夜 -164~-165 / 事件与开关 -171~-188
  // 这几段刚好跳过 -142（钓鱼）与 -145（buff）
  {
    id: 'worldEvent',
    iconId: 4766,
    rule: { ranges: [[-139, -131], [-144, -143], [-150, -146], [-165, -164], [-188, -171]] },
  },
]

/** `cmds` 一条指令的根：去掉前导 `/`，取第一个词，小写（`/clip paste x` → `clip`）。 */
export function commandRoot(cmd: string): string {
  const body = cmd.trim().replace(/^\/+/, '')
  return (body.split(/\s+/)[0] ?? '').toLowerCase()
}

function matches(good: FishGood, rule: MatchRule): boolean {
  const id = typeof good.id === 'number' ? good.id : 0
  if (id !== 0) {
    if (rule.ids?.includes(id)) return true
    for (const [a, b] of rule.ranges ?? []) {
      if (id >= Math.min(a, b) && id <= Math.max(a, b)) return true
    }
  }
  if (rule.cmdRoots?.length) {
    for (const cmd of good.cmds ?? []) {
      if (typeof cmd === 'string' && rule.cmdRoots.includes(commandRoot(cmd))) return true
    }
  }
  return false
}

/** 商品命中的全部分类（按 `FISH_CATEGORIES` 顺序；没有命中就是空数组）。 */
export function matchFishCategories(good: FishGood | null | undefined): FishCategoryId[] {
  if (!good) return []
  return FISH_CATEGORIES.filter(({ rule }) => matches(good, rule)).map(({ id }) => id)
}

/** 本机存着的分类可能是旧版本 / 被改坏的值：认不出来就当没选。 */
export function resolveFishCategory(value: unknown): FishCategoryId | null {
  return FISH_CATEGORIES.some(({ id }) => id === value) ? (value as FishCategoryId) : null
}
