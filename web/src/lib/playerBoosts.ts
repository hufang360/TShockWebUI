import type { PlayerLook } from '@/lib/tshock'

/** 一次性解锁 / 升级类标记（恶魔之心 / 火把神 / 矿车升级）。 */
export const PERMANENT_UNLOCKS: { field: keyof PlayerLook; itemId: number }[] = [
  { field: 'extraSlot', itemId: 3335 },
  { field: 'unlockedBiomeTorches', itemId: 5043 },
  { field: 'unlockedSuperCart', itemId: 5289 },
]

/** 永久增强消耗品（工匠面包 / 埃癸斯水晶等 7 个）。 */
export const PERMANENT_BOOSTERS: { field: keyof PlayerLook; itemId: number }[] = [
  { field: 'ateArtisanBread', itemId: 5326 },
  { field: 'usedAegisCrystal', itemId: 5337 },
  { field: 'usedAegisFruit', itemId: 5338 },
  { field: 'usedArcaneCrystal', itemId: 5339 },
  { field: 'usedGalaxyPearl', itemId: 5340 },
  { field: 'usedGummyWorm', itemId: 5341 },
  { field: 'usedAmbrosia', itemId: 5342 },
]

/** 页面与导出图片共用的「永久增强」顺序。 */
export const PERMANENT_BOOSTS = [...PERMANENT_UNLOCKS, ...PERMANENT_BOOSTERS]
