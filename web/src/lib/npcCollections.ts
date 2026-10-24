import type { Lang } from '@/types'

/**
 * NPC 图鉴的分类（tab）——**手工维护**。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 怎么加 / 改一个 tab？
 *   在下面 `NPC_COLLECTIONS` 里加一条 `{ id, name, nameEn, ids }`；
 *   `ids` 就是该 tab 里要显示的 **NPC ID 列表**。`name` 是 tab 文案。
 * ────────────────────────────────────────────────────────────────────────────
 */
export interface NpcCollection {
  /** 唯一 id（记忆选中状态用）。 */
  id: string
  /** 中文名（tab 文案）。 */
  name: string
  /** 英文名（英文界面用）。 */
  nameEn: string
  /** 该分类包含的 NPC id。 */
  ids: number[]
}

export const NPC_COLLECTIONS: NpcCollection[] = [
  {
    id: 'npc',
    name: 'NPC',
    nameEn: 'NPCs',
    // 城镇 NPC（`Terraria.GameContent/TownNPCProfiles.cs` 的 profile 键 + 受缚/被网/沉睡/昏迷形态）
    ids: [
      17, 18, 19, 20, 22, 37, 38, 54, 105, 106, 107, 108, 123, 124, 142, 160, 178, 207, 208, 209,
      227, 228, 229, 353, 354, 368, 369, 376, 441, 453, 550, 579, 588, 633, 637, 638, 656, 663,
      670, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687,
    ],
  },
  {
    id: 'critter',
    name: '小动物',
    nameEn: 'Critters',
    // NPCID.Sets.CountsAsCritter
    ids: [
      46, 303, 337, 540, 443, 74, 297, 298, 442, 611, 689, 377, 446, 612, 613, 356, 444, 595,
      596, 597, 598, 599, 600, 601, 604, 605, 357, 448, 374, 484, 355, 358, 606, 359, 360, 485,
      486, 487, 148, 149, 55, 230, 592, 593, 299, 538, 539, 300, 447, 361, 445, 362, 363, 364,
      365, 367, 366, 583, 584, 585, 602, 603, 607, 608, 609, 610, 616, 617, 625, 626, 627, 615,
      639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 650, 651, 652, 653, 654, 655, 661,
      669, 671, 672, 673, 674, 675, 677, 687, 688,
    ],
  },
]

/**
 * 额外归入「Boss」筛选的 NPC：多段 Boss 的身体 / 手 / 尾巴等无法用 `/sb` 单独召唤的 id，
 * 或没有登记 `sb` 的 Boss 变体。与 `npcs.json` 里的 `sb` 取并集。
 */
export const EXTRA_BOSS_IDS = new Set<number>([
  14, 15, 36, 114, 115, 116, 135, 136, 128, 129, 130, 131, 246, 247, 248, 249, 263, 264, 265, 396,
  397, 400, 564, 576,
])

/** 是否属于「Boss」分类（可召唤的 `sb` 或上面登记的分段 / 变体）。 */
export function isBossNpc(npc: { id: number; sb?: string }): boolean {
  return Boolean(npc.sb) || EXTRA_BOSS_IDS.has(npc.id)
}

export const NPC_COLLECTION_BY_ID = new Map(NPC_COLLECTIONS.map((c) => [c.id, c]))

/** 取分类显示名（按界面语言）。 */
export function npcCollectionName(c: NpcCollection, lang: Lang): string {
  return lang === 'en' ? c.nameEn : c.name
}
