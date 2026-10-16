import type { PlayerLook } from '@/lib/tshock'
import type { PlayerAtlas } from '@/types'

/** 已应用于输出的 RGBA 颜色（0–255）。 */
export type Rgba = readonly [number, number, number, number]

/** 一次合成绘制：图集区域键 + 源帧高度 + 相乘着色。 */
export interface PlayerDrawOp {
  /** `data/player-atlas.json` 的 regions 键，如 `b:0:3:torso` / `h:1`。 */
  region: string
  /** 源帧高度（站立帧为 56；头发前/后片按游戏逻辑裁到 26 / 54）。 */
  srcHeight: number
  color: Rgba
}

/**
 * 游戏默认颜色（`Terraria/Player.cs` 的字段初值）。
 * `PlayerLook` 里颜色为 `null` 时使用这些值。
 */
export const PLAYER_DEFAULT_COLORS = {
  hairColor: [215, 90, 55, 255],
  skinColor: [255, 125, 90, 255],
  eyeColor: [105, 90, 75, 255],
  shirtColor: [175, 165, 140, 255],
  underShirtColor: [160, 180, 215, 255],
  pantsColor: [255, 230, 175, 255],
  shoeColor: [160, 105, 60, 255],
} as const satisfies Record<string, Rgba>

const WHITE: Rgba = [255, 255, 255, 255]

/** `PlayerVariantID.Sets.Male`：0,1,2,3,8,10 为男性形态。 */
const MALE_VARIANTS = new Set([0, 1, 2, 3, 8, 10])

/** 皮肤 / 衣服为长袍的形态（`PlayerDrawLayers.DrawPlayer_15_SkinLongCoat`）。 */
const LONG_COAT_VARIANTS = new Set([3, 7, 8])

/** 只有这三种形态的「外套」是皮肤贴图的一部分（part 14）。 */
export function isLongCoatVariant(skinVariant: number): boolean {
  return LONG_COAT_VARIANTS.has(skinVariant)
}

export function isMaleVariant(skinVariant: number): boolean {
  return MALE_VARIANTS.has(skinVariant)
}

/** `PlayerLook` 颜色是 int32 小端 RGBA（R=b0 G=b1 B=b2 A=b3），可能为 null。 */
export function decodeColor(value: number | null | undefined, fallback: Rgba): Rgba {
  if (value == null) return fallback
  const v = value >>> 0
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
}

/**
 * 该发型是否带「后发」——后发在角色最底层先画（`DrawPlayer_01_BackHair`），
 * 并把前发源帧高度裁到 26（`PlayerDrawSet.BoringSetup`）。
 * 逻辑照抄 `Player.GetHairSettings` 的 `backHairDraw`。
 */
export function hasBackHair(hair: number): boolean {
  const n = hair
  const base =
    n > 50 &&
    (n < 56 || n > 63) &&
    (n < 74 || n > 77) &&
    (n < 88 || n > 89) &&
    n !== 94 &&
    n !== 100 &&
    n !== 104 &&
    n !== 112 &&
    n < 116
  return base || n === 133 || n === 134 || n === 146 || n === 162 || n === 6
}

export function clampVariant(skinVariant: number): number {
  if (!Number.isFinite(skinVariant)) return 0
  return Math.min(11, Math.max(0, Math.trunc(skinVariant)))
}

export function clampHair(hair: number): number {
  if (!Number.isFinite(hair)) return 0
  return Math.min(227, Math.max(0, Math.trunc(hair)))
}

/**
 * 生成站立、无持物、无盔甲/饰品的角色合成绘制序列（自底向上）。
 *
 * 层级与每一层的贴图完全对照 `PlayerDrawLayers.DrawPlayer_UseNormalLayers`：
 * 后发 → 皮肤（躯干/腿/后臂）→ 裤子/鞋 → 长袍 → 上衣 → 头/眼 → 前发 → 前臂。
 * 站立帧下所有部件都落在同一个 40×56 原点（合成帧把偏移烘进贴图），
 * 因此前端只需按顺序贴同一位置即可（见 `docs/计划-玩家全身图.md`）。
 */
export function buildPlayerDrawOps(look: PlayerLook): PlayerDrawOp[] {
  const v = clampVariant(look.skinVariant)
  const hair = clampHair(look.hair)
  const back = hasBackHair(hair)

  const skin = decodeColor(look.skinColor, PLAYER_DEFAULT_COLORS.skinColor)
  const eyes = decodeColor(look.eyeColor, PLAYER_DEFAULT_COLORS.eyeColor)
  const hairColor = decodeColor(look.hairColor, PLAYER_DEFAULT_COLORS.hairColor)
  const shirt = decodeColor(look.shirtColor, PLAYER_DEFAULT_COLORS.shirtColor)
  const under = decodeColor(look.underShirtColor, PLAYER_DEFAULT_COLORS.underShirtColor)
  const pants = decodeColor(look.pantsColor, PLAYER_DEFAULT_COLORS.pantsColor)
  const shoes = decodeColor(look.shoeColor, PLAYER_DEFAULT_COLORS.shoeColor)

  const b = (part: number, role: string) => `b:${v}:${part}:${role}`
  const ops: PlayerDrawOp[] = []

  // 01_BackHair（仅带后发的发型）
  if (back) ops.push({ region: `h:${hair}`, srcHeight: 54, color: hairColor })

  // 12_Skin（合成）：躯干皮肤 → 腿皮肤 → 后臂（皮肤/手/内衣/上衣）
  ops.push({ region: b(3, 'torso'), srcHeight: 56, color: skin })
  ops.push({ region: b(10, 'leg'), srcHeight: 56, color: skin })
  ops.push({ region: b(7, 'backArm'), srcHeight: 56, color: skin })
  ops.push({ region: b(5, 'backArm'), srcHeight: 56, color: skin })
  ops.push({ region: b(8, 'backArm'), srcHeight: 56, color: under })
  ops.push({ region: b(13, 'backArm'), srcHeight: 56, color: shirt })

  // 13_Leggings（裤子 + 鞋子皮肤贴图）
  ops.push({ region: b(11, 'leg'), srcHeight: 56, color: pants })
  ops.push({ region: b(12, 'leg'), srcHeight: 56, color: shoes })

  // 15_SkinLongCoat（仅 skinVariant 3/7/8）
  if (isLongCoatVariant(v)) ops.push({ region: b(14, 'longCoat'), srcHeight: 56, color: shirt })

  // 17_Torso（合成）：后肩 → 躯干，各画一遍内衣 + 上衣
  ops.push({ region: b(4, 'backShoulder'), srcHeight: 56, color: under })
  ops.push({ region: b(6, 'backShoulder'), srcHeight: 56, color: shirt })
  ops.push({ region: b(4, 'torso'), srcHeight: 56, color: under })
  ops.push({ region: b(6, 'torso'), srcHeight: 56, color: shirt })

  // 21_Head：脸（头 / 眼白 / 眼睛）+ 前发
  ops.push({ region: b(0, 'head'), srcHeight: 56, color: skin })
  ops.push({ region: b(1, 'eyeWhites'), srcHeight: 56, color: WHITE })
  ops.push({ region: b(2, 'eyes'), srcHeight: 56, color: eyes })
  ops.push({ region: `h:${hair}`, srcHeight: back ? 26 : 54, color: hairColor })

  // 28_ArmOverItem（合成）：前臂组 → 前肩组（顺序与游戏一致）
  for (const role of ['frontArm', 'frontShoulder'] as const) {
    ops.push({ region: b(7, role), srcHeight: 56, color: skin })
    ops.push({ region: b(8, role), srcHeight: 56, color: under })
    ops.push({ region: b(13, role), srcHeight: 56, color: shirt })
    ops.push({ region: b(6, role), srcHeight: 56, color: shirt })
  }

  return ops
}

/** 过滤掉图集里不存在的区域（防御性；缺失的层直接跳过，绝不抛错）。 */
export function resolveOps(ops: PlayerDrawOp[], atlas: PlayerAtlas): PlayerDrawOp[] {
  return ops.filter((op) => atlas.regions[op.region] != null)
}
