/**
 * 分组标题的**语义色**（唯一来源）。
 *
 * 物品详情的「合成 / 作为材料 / 微光嬗变 / 词缀」与各处「相关指令」共用同一套颜色，
 * 免得改一处后两边看起来不一样。
 */
export const RECIPE_SECTION_TONE = {
  /** 合成（这件物品是怎么来的）：木色，取自 9 号木材图标（`--wood`）。 */
  make: 'text-wood',
  /** 作为材料（它是材料）：与「合成」同色。 */
  use: 'text-wood',
  /** 微光嬗变（含微光分解）。 */
  shimmer: 'text-purple',
  /** 词缀（粉紫 = 游戏里「神级」物品名的颜色，`--pink`）。 */
  prefix: 'text-pink',
  /** 「相关指令」（绿色，复用语义令牌 `--success`）——与木色的合成分组区分开。 */
  command: 'text-success',
} as const
