/**
 * 世界存档（`.wld`）的**版本表 + 布局分段**（版本转换用）。
 *
 * 与角色存档不同，世界的「布局」不只由头部字段决定：
 * 箱子段在 294、NPC 段在 315 都改过格式，所以这些门槛也必须算进分段里。
 *
 * 门槛与最大 ID 来源：
 * - 门槛：反编译源码 `Terraria.IO/WorldFile.cs`（1.4.4.9 与 1.4.6.1 对照）；
 * - 最大 ID：TEdit `src/TEdit.Terraria/Data/versions.json` 的 `saveVersions`（1.4.4.9 / 1.4.5.x / 1.4.6.x）。
 *
 * 只支持 **1.4.4.9（279）… 1.4.6.1（329）** 之间的转换：更老的版本要改的字段更多，
 * 而且没有实际需求，明确不提供（文件仍可查看，只是不能改版本）。
 */
import { playerGameVersion } from './playerVersions'

/** 能作为转换目标的最低 / 最高 release。 */
export const WORLD_CONVERT_MIN_RELEASE = 279
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
}

/**
 * 可选的转换目标（1.4.4.9 与 1.4.5.x / 1.4.6.x）。
 *
 * `1.4.5.0 / .1 / .2` 都是 release 315，`1.4.6.0 / .1` 都是 329，所以一个 release 只列一次。
 */
export const WORLD_VERSIONS: readonly WorldVersionInfo[] = [
  { release: 279, gameVersion: playerGameVersion(279) ?? '1.4.4.9', maxTile: 692, maxWall: 346, maxItem: 5455, maxNpc: 687 },
  { release: 315, gameVersion: playerGameVersion(315) ?? '1.4.5.0+', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696 },
  { release: 316, gameVersion: playerGameVersion(316) ?? '1.4.5.3', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696 },
  { release: 317, gameVersion: playerGameVersion(317) ?? '1.4.5.4', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696 },
  { release: 318, gameVersion: playerGameVersion(318) ?? '1.4.5.5', maxTile: 752, maxWall: 366, maxItem: 6144, maxNpc: 696 },
  { release: 319, gameVersion: playerGameVersion(319) ?? '1.4.5.6', maxTile: 752, maxWall: 366, maxItem: 6146, maxNpc: 696 },
  { release: 325, gameVersion: playerGameVersion(325) ?? '1.4.5.7', maxTile: 753, maxWall: 366, maxItem: 6195, maxNpc: 696 },
  { release: 326, gameVersion: playerGameVersion(326) ?? '1.4.5.8', maxTile: 753, maxWall: 366, maxItem: 6195, maxNpc: 696 },
  { release: 329, gameVersion: playerGameVersion(329) ?? '1.4.6.0+', maxTile: 753, maxWall: 366, maxItem: 6195, maxNpc: 696 },
]

/** release → 版本信息（不在可选表里返回 null）。 */
export function worldVersionInfo(release: number): WorldVersionInfo | null {
  return WORLD_VERSIONS.find((v) => v.release === release) ?? null
}

/**
 * 世界格式**发生变化**的 release（头部字段或段格式）。
 *
 * 只列 1.4.4.9 之后的：279 之前的版本不参与转换。
 */
export const WORLD_RELEASE_GATES: readonly number[] = [
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
    },
  ].sort((a, b) => a.release - b.release)
}

/** 跨布局段的候选目标（不含当前版本；UI 再按目标布局段分组）。 */
export function worldConvertTargets(from: number): WorldVersionInfo[] {
  return WORLD_VERSIONS.filter((v) => v.release !== from)
}
