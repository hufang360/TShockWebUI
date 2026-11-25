/**
 * 世界存档（`.wld`）的**版本表 + 布局分段**（版本转换用）。
 *
 * 与角色存档不同，世界的「布局」不只由头部字段决定：
 * 箱子段在 294、NPC 段在 268 / 315、图格实体段在 307 / 308 都改过格式，所以这些门槛也算分段边界。
 *
 * 门槛与最大 ID 来源：
 * - 门槛：反编译源码 `Terraria.IO/WorldFile.cs` 与 `Terraria.GameContent.Tile_Entities/*`（1.4.4.9 / 1.4.5.8 / 1.4.6.1 对照）；
 * - 最大 ID：TEdit `src/TEdit.Terraria/Data/versions.json` 的 `saveVersions`；`maxEntity` 由各版本
 *   `TileEntitiesManager.RegisterAll()` 的顺序得出（1.4.4.9 只到 7，1.4.5.x / 1.4.6.x 到 10）。
 *
 * 转换策略：
 * - **升级**：1.4.0.1（225）起都支持（旧世界的实体类型一定是目标版本的子集）；
 * - **降级**：只到 **1.4.4（269）**。再往下缺少可靠的实体类型表 / 更多段格式差异（未验证），
 *   明确拒绝而不是赌。
 */
import { playerGameVersion } from './playerVersions'

/** 能作为转换目标的最低 release（1.4.0.1）。 */
export const WORLD_CONVERT_MIN_RELEASE = 225
/** 能作为**降级**目标的最低 release（1.4.4）；升级不受这个限制。 */
export const WORLD_DOWNGRADE_MIN_RELEASE = 269
export const WORLD_CONVERT_MAX_RELEASE = 329

/** 一个可选的 World 版本：release + 该版本认识的最大内容 ID（降级时的兼容性判据）。 */
export interface WorldVersionInfo {
  release: number
  /** 显示名（复用 `playerVersions.ts` 的映射，两个存档共用同一套版本号）。 */
  gameVersion: string
  maxTile: number
  maxWall: number
  maxItem: number
  maxNpc: number
  /** 图格实体类型上限（`TileEntitiesManager.RegisterAll()` 的顺序，0 起）。 */
  maxEntity: number
}

/**
 * 可选的转换目标（1.4.0.1 – 1.4.6.1）。
 *
 * 同一个 release 对应多个游戏版本时只列一次（如 315 = 1.4.5.0/1/2，329 = 1.4.6.0/1）。
 */
export const WORLD_VERSIONS: readonly WorldVersionInfo[] = [
  { release: 225, gameVersion: '1.4.0.1', maxTile: 622, maxWall: 315, maxItem: 5042, maxNpc: 662, maxEntity: 7 },
  { release: 226, gameVersion: '1.4.0.2', maxTile: 622, maxWall: 315, maxItem: 5042, maxNpc: 662, maxEntity: 7 },
  { release: 227, gameVersion: '1.4.0.3', maxTile: 622, maxWall: 315, maxItem: 5042, maxNpc: 662, maxEntity: 7 },
  { release: 228, gameVersion: '1.4.0.4', maxTile: 622, maxWall: 315, maxItem: 5042, maxNpc: 662, maxEntity: 7 },
  { release: 230, gameVersion: '1.4.0.5', maxTile: 622, maxWall: 315, maxItem: 5044, maxNpc: 662, maxEntity: 7 },
  { release: 232, gameVersion: '1.4.1', maxTile: 623, maxWall: 315, maxItem: 5087, maxNpc: 664, maxEntity: 7 },
  { release: 233, gameVersion: '1.4.1.1', maxTile: 623, maxWall: 315, maxItem: 5087, maxNpc: 664, maxEntity: 7 },
  { release: 234, gameVersion: '1.4.1.2', maxTile: 623, maxWall: 315, maxItem: 5087, maxNpc: 664, maxEntity: 7 },
  { release: 235, gameVersion: '1.4.2', maxTile: 623, maxWall: 315, maxItem: 5087, maxNpc: 664, maxEntity: 7 },
  { release: 236, gameVersion: '1.4.2.1', maxTile: 623, maxWall: 315, maxItem: 5087, maxNpc: 664, maxEntity: 7 },
  { release: 237, gameVersion: '1.4.2.2', maxTile: 623, maxWall: 315, maxItem: 5087, maxNpc: 666, maxEntity: 7 },
  { release: 238, gameVersion: '1.4.2.3', maxTile: 623, maxWall: 315, maxItem: 5087, maxNpc: 667, maxEntity: 7 },
  { release: 242, gameVersion: '1.4.3', maxTile: 624, maxWall: 315, maxItem: 5124, maxNpc: 669, maxEntity: 7 },
  { release: 243, gameVersion: '1.4.3.1', maxTile: 624, maxWall: 315, maxItem: 5124, maxNpc: 669, maxEntity: 7 },
  { release: 244, gameVersion: '1.4.3.2', maxTile: 624, maxWall: 315, maxItem: 5124, maxNpc: 669, maxEntity: 7 },
  { release: 245, gameVersion: '1.4.3.3', maxTile: 624, maxWall: 315, maxItem: 5124, maxNpc: 669, maxEntity: 7 },
  { release: 246, gameVersion: '1.4.3.4', maxTile: 624, maxWall: 315, maxItem: 5124, maxNpc: 669, maxEntity: 7 },
  { release: 247, gameVersion: '1.4.3.5', maxTile: 624, maxWall: 315, maxItem: 5124, maxNpc: 669, maxEntity: 7 },
  { release: 248, gameVersion: '1.4.3.6', maxTile: 624, maxWall: 315, maxItem: 5124, maxNpc: 669, maxEntity: 7 },
  { release: 269, gameVersion: '1.4.4', maxTile: 692, maxWall: 346, maxItem: 5452, maxNpc: 687, maxEntity: 7 },
  { release: 270, gameVersion: '1.4.4.1', maxTile: 692, maxWall: 346, maxItem: 5452, maxNpc: 687, maxEntity: 7 },
  { release: 271, gameVersion: '1.4.4.2', maxTile: 692, maxWall: 346, maxItem: 5452, maxNpc: 687, maxEntity: 7 },
  { release: 272, gameVersion: '1.4.4.3', maxTile: 692, maxWall: 346, maxItem: 5452, maxNpc: 687, maxEntity: 7 },
  { release: 273, gameVersion: '1.4.4.4', maxTile: 692, maxWall: 346, maxItem: 5452, maxNpc: 687, maxEntity: 7 },
  { release: 274, gameVersion: '1.4.4.5', maxTile: 692, maxWall: 346, maxItem: 5455, maxNpc: 687, maxEntity: 7 },
  { release: 275, gameVersion: '1.4.4.6', maxTile: 692, maxWall: 346, maxItem: 5455, maxNpc: 687, maxEntity: 7 },
  { release: 276, gameVersion: '1.4.4.7', maxTile: 692, maxWall: 346, maxItem: 5455, maxNpc: 687, maxEntity: 7 },
  { release: 277, gameVersion: '1.4.4.8', maxTile: 692, maxWall: 346, maxItem: 5455, maxNpc: 687, maxEntity: 7 },
  { release: 278, gameVersion: '1.4.4.8.1', maxTile: 692, maxWall: 346, maxItem: 5455, maxNpc: 687, maxEntity: 7 },
  { release: 279, gameVersion: '1.4.4.9', maxTile: 692, maxWall: 346, maxItem: 5455, maxNpc: 687, maxEntity: 7 },
  { release: 315, gameVersion: '1.4.5.0+', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696, maxEntity: 10 },
  { release: 316, gameVersion: '1.4.5.3', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696, maxEntity: 10 },
  { release: 317, gameVersion: '1.4.5.4', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696, maxEntity: 10 },
  { release: 318, gameVersion: '1.4.5.5', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696, maxEntity: 10 },
  { release: 319, gameVersion: '1.4.5.6', maxTile: 752, maxWall: 366, maxItem: 6146, maxNpc: 696, maxEntity: 10 },
  { release: 325, gameVersion: '1.4.5.7', maxTile: 753, maxWall: 366, maxItem: 6195, maxNpc: 696, maxEntity: 10 },
  { release: 326, gameVersion: '1.4.5.8', maxTile: 753, maxWall: 366, maxItem: 6195, maxNpc: 696, maxEntity: 10 },
  { release: 329, gameVersion: '1.4.6.0+', maxTile: 753, maxWall: 366, maxItem: 6195, maxNpc: 696, maxEntity: 10 },
]

/** release → 版本信息（不在可选表里返回 null）。 */
export function worldVersionInfo(release: number): WorldVersionInfo | null {
  return WORLD_VERSIONS.find((v) => v.release === release) ?? null
}

/**
 * 世界格式**发生变化**的 release（头部字段或段格式）。
 *
 * `WORLD_RELEASE_GATES` 用于「布局分段」，必须按数值升序；头部插入顺序在 `worldConvert.ts` 里另列
 * （两者顺序不同：例如 302 在文件里排在 284 前面）。
 */
export const WORLD_RELEASE_GATES: readonly number[] = [
  227, // worthy 种子
  238, // 十周年
  239, // 饥荒
  240, // 独眼巨鹿
  241, // 蜜蜂
  249, // 颠倒
  250, // 蓝史莱姆
  251, // 8 个 NPC 解锁
  257, // 末日派对
  259, // 战斗手册 2
  260, // 商贩背包
  261, // 7 种史莱姆
  264, // 日晷 / 月晷
  266, // 无陷阱
  267, // 天顶
  268, // NPC 段：微光化城镇 NPC 列表
  284, // lastPlayed
  287, // 永久万圣节 / 圣诞节
  288, // 吸血鬼种子
  289, // 可领取横幅表
  291, // 流星雨 / 金币雨
  294, // 箱子段：共享容量 → 每箱容量
  296, // 感染种子
  297, // 团队出生点
  299, // WorldManifestData（299–312 另有废弃 u32）
  302, // 空岛种子
  304, // 双地牢种子
  307, // 图格实体：假人 pose
  308, // 图格实体：假人 bits3
  313, // 废弃 u32 删除
  315, // NPC 段：homelessDespawn
  323, // 更多闪电 / 无闪电
  328, // 无蜘蛛种子
]

/** 某个 release 所在的「同布局段」：`[lo, hi]`（含两端，按转换支持范围截断）。 */
export function worldReleaseSegment(release: number): { lo: number; hi: number } {
  const lo = WORLD_RELEASE_GATES.filter((g) => g <= release).pop() ?? WORLD_CONVERT_MIN_RELEASE
  const hi = (WORLD_RELEASE_GATES.find((g) => g > release) ?? Number.MAX_SAFE_INTEGER) - 1
  return { lo, hi }
}

/** 两个 release 的字段 / 段布局是否相同（同段 ⟹ 只改 4 字节版本号就安全）。 */
export function isSameWorldLayout(a: number, b: number): boolean {
  const s = worldReleaseSegment(a)
  return b >= s.lo && b <= s.hi
}

/** 「选择存档版本」下拉：同布局段内的所有已知版本 + 当前版本本身（同 `playerVersions` 的约定）。 */
export function worldVersionOptions(release: number): WorldVersionInfo[] {
  const options = WORLD_VERSIONS.filter((v) => isSameWorldLayout(release, v.release))
  if (options.some((v) => v.release === release)) return options
  return [
    ...options,
    {
      release,
      gameVersion: playerGameVersion(release) ?? String(release),
      maxTile: Number.POSITIVE_INFINITY,
      maxWall: Number.POSITIVE_INFINITY,
      maxItem: Number.POSITIVE_INFINITY,
      maxNpc: Number.POSITIVE_INFINITY,
      maxEntity: Number.POSITIVE_INFINITY,
    },
  ].sort((a, b) => a.release - b.release)
}

/** 跨布局段的候选目标（不含当前版本；UI 再按目标布局段分组）。 */
export function worldConvertTargets(from: number): WorldVersionInfo[] {
  return WORLD_VERSIONS.filter((v) => v.release !== from)
}
