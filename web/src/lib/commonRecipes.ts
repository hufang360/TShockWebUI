/**
 * 「常用」合成表：物品图鉴里固定列出的一批常用物品（展示「怎么合成它」与「它用于合成什么」）。
 *
 * 清单由用户指定（顺序即展示顺序）：
 * - 信息配饰：全球定位系统 / 六分仪 / 哥布林数据仪 / R.E.K.3000 / 贝壳电话
 * - 移动与饰品：泰拉闪耀靴 / 闪电靴 / 十字章护身符 / 强力手套 / 气球束 / 闪亮红气球
 * - 武器：天顶剑
 *
 * 想调整只改这个数组 —— 页面（`pages/ItemsPage.tsx`）与组件（`components/items/CommonRecipes.tsx`）
 * 都从这里取，别在别处再写一份 ID。
 */
export const COMMON_RECIPE_ITEM_IDS: readonly number[] = [
  395, // GPS（全球定位系统）
  3096, // Sextant（六分仪）
  3121, // GoblinTech（哥布林数据仪）
  3122, // REK（R.E.K.3000）
  5437, // ShellphoneDummy（贝壳电话）
  898, // LightningBoots（闪电靴）
  1612, // AnkhCharm（十字章护身符）
  897, // PowerGlove（强力手套）
  1164, // BundleofBalloons（气球束）
  159, // ShinyRedBalloon（闪亮红气球）
  5000, // TerrasparkBoots（泰拉闪耀靴）
  4956, // Zenith（天顶剑）
]

/**
 * 「用于合成」里剔掉的结果物品：这些本身就是常用物品的**上一层**（合成链的下一步），
 * 列在常用里纯属冗余（用户指定）：
 * 3123 个人数字助手、1862 霜花靴、3992 狂战士手套、936 机械手套、5331 马掌气球束。
 * 想恢复哪一条，从下面的数组里删掉对应 ID 即可。
 */
export const COMMON_RECIPE_EXCLUDED_RESULT_IDS: readonly number[] = [
  3123, // 个人数字助手（由 395 / 3121 / 3122 合成）
  1862, // 霜花靴（由 898 合成）
  3992, // 狂战士手套（由 897 合成）
  936, // 机械手套（由 897 合成）
  5331, // 马掌气球束（由 1164 合成）
]

/**
 * 每件常用物品最多列几条「怎么造它」：**只留第一条**。
 * 例如 395 全球定位系统同时有「金表版 / 铂金表版」两种配方，两条并列纯属冗余。
 */
export const COMMON_RECIPE_MAKE_LIMIT = 1
