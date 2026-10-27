import { isSameReleaseLayout } from './plr'

/**
 * 角色存档版本号（`.plr` 的 `release`）→ 游戏版本号。
 *
 * 数据来源：TEdit 仓库 `src/TEdit.Terraria/Data/versions.json` 的 `gameVersionToSaveVersion`
 * 反向表（文件头标注与 Terraria 1.4.5.8 对齐）。同一个存档版本对应多个游戏版本时（如
 * 1.4.5.0 / 1.4.5.1 / 1.4.5.2 都是 315），显示成 `1.4.5.0+`（存档里只有版本号，无法再细分）。
 *
 * 只读映射，不需要重新生成；游戏出新版时按 `docs/开发速查.md` 重新生成这一张表。
 */
const SAVE_VERSION_TO_GAME_VERSION: Record<number, string> = {
  2: '1.0.1',
  3: '1.0.2',
  4: '1.0.3',
  9: '1.0.4',
  12: '1.0.5',
  20: '1.0.6',
  22: '1.0.6.1',
  36: '1.1',
  37: '1.1.1',
  38: '1.0',
  39: '1.1.2',
  67: '1.2',
  68: '1.2.0.1',
  69: '1.2.0.2',
  70: '1.2.0.3',
  71: '1.2.0.3.1',
  72: '1.2.1',
  73: '1.2.1.1+', // 1.2.1.1 / 1.2.1.2
  77: '1.2.2',
  93: '1.2.3',
  94: '1.2.3.1',
  101: '1.2.4',
  102: '1.2.4.1',
  146: '1.3.0.1',
  147: '1.3.0.2',
  149: '1.3.0.3',
  151: '1.3.0.4',
  153: '1.3.0.5',
  154: '1.3.0.6',
  155: '1.3.0.7',
  156: '1.3.0.8',
  168: '1.3.1',
  169: '1.3.1.1',
  172: '1.3.2',
  173: '1.3.2.1',
  175: '1.3.3',
  176: '1.3.3.1+', // 1.3.3.1 / 1.3.3.2
  177: '1.3.3.3',
  184: '1.3.4',
  185: '1.3.4.1',
  186: '1.3.4.2',
  187: '1.3.4.3',
  188: '1.3.4.4',
  191: '1.3.5',
  192: '1.3.5.1',
  193: '1.3.5.2',
  194: '1.3.5.3',
  225: '1.4.0.1',
  226: '1.4.0.2',
  227: '1.4.0.3',
  228: '1.4.0.4',
  230: '1.4.0.5',
  232: '1.4.1',
  233: '1.4.1.1',
  234: '1.4.1.2',
  235: '1.4.2',
  236: '1.4.2.1',
  237: '1.4.2.2',
  238: '1.4.2.3',
  242: '1.4.3',
  243: '1.4.3.1',
  244: '1.4.3.2',
  245: '1.4.3.3',
  246: '1.4.3.4',
  247: '1.4.3.5',
  248: '1.4.3.6',
  269: '1.4.4',
  270: '1.4.4.1',
  271: '1.4.4.2',
  272: '1.4.4.3',
  273: '1.4.4.4',
  274: '1.4.4.5',
  275: '1.4.4.6',
  276: '1.4.4.7',
  277: '1.4.4.8',
  278: '1.4.4.8.1',
  279: '1.4.4.9',
  315: '1.4.5.0+', // 1.4.5.0 / 1.4.5.1 / 1.4.5.2
  316: '1.4.5.3',
  317: '1.4.5.4',
  318: '1.4.5.5',
  319: '1.4.5.6',
  325: '1.4.5.7',
  326: '1.4.5.8',
}

/** 全部已知版本（按 release 升序），给「选择存档版本」下拉用。 */
export const PLAYER_VERSIONS: { release: number; gameVersion: string }[] = Object.entries(
  SAVE_VERSION_TO_GAME_VERSION,
)
  .map(([release, gameVersion]) => ({ release: Number(release), gameVersion }))
  .sort((a, b) => a.release - b.release)

/** 存档版本号 → 游戏版本号（未知版本返回 `null`）。 */
export function playerGameVersion(release: number): string | null {
  return SAVE_VERSION_TO_GAME_VERSION[release] ?? null
}

/**
 * 「存档版本」下拉的选项：**同一布局段**内所有已知版本 + **当前版本本身**。
 *
 * 为什么必须带上当前版本：存档里存在版本表没有的 release（实测 `Omega_Golf_Adventure.wld` 是 221，
 * 属于 1.4.0 预览期的序号，TEdit 的版本表也没有它）。若选项里缺当前值，`<select>` 会显示**别的版本**，
 * 让人误以为文件是那个版本；带上去就至少能如实显示「221」。
 */
export function versionOptionsFor(release: number): { release: number; gameVersion: string }[] {
  const options = PLAYER_VERSIONS.filter((v) => isSameReleaseLayout(release, v.release))
  if (options.some((v) => v.release === release)) return options
  return [...options, { release, gameVersion: playerGameVersion(release) ?? String(release) }].sort(
    (a, b) => a.release - b.release,
  )
}
