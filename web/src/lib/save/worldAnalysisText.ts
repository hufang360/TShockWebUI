/**
 * 「导出分析」：把世界分析结果拼成一份纯文本报告。
 *
 * 格式对齐参考件（TEdit 风格的 `* Analysis.txt`），方便和别的工具互相对照：
 *
 * ```
 * ===SECTION: World===
 * Title: wukong
 * ...
 * ===SECTION: Tiles===
 * Air: 8937097 (44.33%)
 * 石块: 4119670 (20.43%)
 * ===SECTION: Chests===
 * Chest Count: 513
 * [6919, 1453] - Contents: [0]: 1 - 高端魔法飞弹,[1]: 1 - 雷管,...
 * ```
 *
 * 纯函数：名字解析由调用方传入（UI 用 dataset 的本地化名，测试可以给假数据）。
 */
import type { WorldInfo } from './worldFile'
import type { WorldSections } from './worldStats'
import type { WorldTileStats } from './worldThumb'
import { formatWorldTime } from '@/lib/worldPage'

export interface AnalysisNames {
  tile(id: number): string
  wall(id: number): string
  item(id: number): string
  prefix(id: number): string
  npc(netId: number): string
}

export interface AnalysisTextInput {
  info: WorldInfo
  stats: WorldTileStats
  sections: WorldSections
  names: AnalysisNames
  /** 时间（`Date`）在头部作为「导出时间」记录。 */
  exportedAt: string
}

const pct = (count: number, total: number): string =>
  total > 0 ? `${((count / total) * 100).toFixed(2)}%` : '0%'

/** 一行 `名字: 数量 (占比)`。 */
function countLine(name: string, count: number, total: number): string {
  return `${name}: ${count} (${pct(count, total)})`
}

/** 组装整份报告（每行以 `\n` 结尾，`\r\n` 由下载时统一转换）。 */
export function buildAnalysisText(input: AnalysisTextInput): string {
  const { info, stats, sections, names, exportedAt } = input
  const lines: string[] = []
  const push = (...xs: string[]) => lines.push(...xs)

  push('===SECTION: World===')
  push(`Title: ${info.name}`)
  push(`WorldId: ${info.worldId}`)
  push(`Compatible Version: ${info.release}`)
  push(`Revision: ${info.revision}`)
  push(`Size: ${info.width} x ${info.height} (${stats.total} tiles)`)
  push(`GameMode: ${info.gameMode}`)
  push(`Evil: ${info.evil}`)
  push(`Hardmode: ${info.hardmode}`)
  push(`Spawn: ${info.spawn.x}, ${info.spawn.y}`)
  push(`Dungeon: ${info.dungeon.x}, ${info.dungeon.y}`)
  push(`Seed: ${info.seed}`)
  // 与界面同一套换算（创建时间 = 本地墙上时间原样；最后游玩 = UTC → 本地）
  push(`Created: ${formatWorldTime(info.createdAt) || '-'}`)
  push(`LastPlayed: ${formatWorldTime(info.lastPlayed) || '-'}`)
  push(`ExportedAt: ${exportedAt}`)
  push(`BossesDefeated: ${info.bossesDowned.join(', ') || '-'}`)
  push('')

  push('===SECTION: Tiles===')
  push(countLine('Air', stats.air, stats.total))
  for (const [id, count] of [...stats.tiles.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    push(countLine(names.tile(id), count, stats.total))
  }
  push('')

  push('===SECTION: Walls===')
  for (const [id, count] of [...stats.walls.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    push(countLine(names.wall(id), count, stats.total))
  }
  if (stats.walls.size === 0) push('(none)')
  push('')

  push('===SECTION: Zones===')
  const zoneNames: Record<string, string> = {
    surface: 'Surface',
    underground: 'Underground',
    cavern: 'Cavern',
    underworld: 'Underworld',
  }
  const zb = stats.zoneBounds
  stats.zones.forEach((zone, i) => {
    const from = zb[i] ?? 0
    const to = (i === stats.zones.length - 1 ? info.height : (zb[i + 1] ?? info.height)) - 1
    const top = [...zone.tiles.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3)
      .map(([id, count]) => `${names.tile(id)} ${count}`)
      .join(', ')
    push(
      `${zoneNames[zone.key] ?? zone.key} (y ${from}-${to}): tiles ${zone.total}, air ${zone.air} (${pct(zone.air, zone.total)}), water ${zone.liquid.water}, lava ${zone.liquid.lava}${top ? `, top: ${top}` : ''}`,
    )
  })
  push('')

  push('===SECTION: Liquids===')
  push(`Water: ${stats.liquid.water}`)
  push(`Lava: ${stats.liquid.lava}`)
  push(`Honey: ${stats.liquid.honey}`)
  push(`Shimmer: ${stats.liquid.shimmer}`)
  push('')

  push('===SECTION: Chests===')
  push(`Chest Count: ${sections.chests ?? '-'}`)
  push(`Item Kinds: ${sections.chestItemKinds ?? '-'}`)
  if (sections.chestItems) {
    for (const [id, count] of [...sections.chestItems.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      push(`  ${names.item(id)}: ${count}`)
    }
  }
  push('')
  for (const chest of sections.chestList ?? []) {
    const items = chest.items
      .map((it) => {
        const prefix = it.prefix > 0 ? `${names.prefix(it.prefix)} ` : ''
        return `[${it.slot}]: ${it.stack} - ${prefix}${names.item(it.id)}`
      })
      .join(',')
    const name = chest.name ? ` {${chest.name}}` : ''
    push(`[${chest.x}, ${chest.y}]${name} - Contents: ${items || '(empty)'}`)
  }
  push('')

  push('===SECTION: Signs===')
  push(`Sign Count: ${sections.signs ?? '-'}`)
  for (const sign of sections.signList ?? []) {
    push(`[${sign.x}, ${sign.y}] ${sign.text.replace(/\r?\n/g, ' / ')}`)
  }
  push('')

  push('===SECTION: NPCs===')
  push(`NPC Count: ${sections.npcs ?? '-'}`)
  for (const npc of sections.npcList ?? []) {
    const home = npc.homeless ? 'homeless' : `${npc.homeX}, ${npc.homeY}`
    push(
      `ID: ${names.npc(npc.netId)}, Name: ${npc.name}, Position: [${npc.x.toFixed(2)}, ${npc.y.toFixed(2)}], Home: [${home}]`,
    )
  }
  push('')

  push('===SECTION: Tile Entities===')
  push(`Tile Entities Count: ${sections.tileEntities ?? '-'}`)
  push('')

  return lines.join('\n')
}

/** 导出文件名：`<世界名>-analysis.txt`（去掉文件系统不允许的字符）。 */
export function analysisFilename(worldName: string): string {
  const safe = (worldName || 'world')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return `${safe || 'world'}-analysis.txt`
}
