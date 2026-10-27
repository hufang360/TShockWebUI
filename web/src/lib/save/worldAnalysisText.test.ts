import { describe, expect, it } from 'vitest'
import { analysisFilename, buildAnalysisText, type AnalysisNames } from './worldAnalysisText'
import type { WorldInfo } from './worldFile'
import type { WorldSections } from './worldStats'
import type { WorldTileStats } from './worldThumb'

const info = {
  release: 326,
  revision: 72,
  favorite: false,
  name: 'wukong',
  seed: '1234',
  worldGenVersion: 0,
  guid: '',
  worldId: 1205002299,
  width: 8400,
  height: 2400,
  gameMode: 2,
  specialSeeds: [],
  evil: 'crimson',
  hardmode: true,
  bossesDowned: ['eyeOfCthulhu', 'moonLord'],
  spawn: { x: 4195, y: 450 },
  dungeon: { x: 6633, y: 494 },
  groundLevel: 609,
  rockLevel: 969,
  createdAt: null,
  lastPlayed: null,
  time: 27264,
  dayTime: false,
  moonPhase: 1,
  bloodMoon: false,
  eclipse: false,
} as WorldInfo

const stats: WorldTileStats = {
  tiles: new Map([
    [1, 4119670],
    [0, 1794863],
  ]),
  walls: new Map([[1, 1000]]),
  air: 8937097,
  liquid: { water: 10, lava: 2, honey: 0, shimmer: 1 },
  total: 8400 * 2400,
  zoneBounds: [0, 609, 969, 2200],
  zones: [
    { key: 'surface', total: 100, air: 60, tiles: new Map([[1, 40]]), liquid: { water: 0, lava: 0, honey: 0, shimmer: 0 } },
    { key: 'underground', total: 100, air: 30, tiles: new Map([[1, 70]]), liquid: { water: 0, lava: 0, honey: 0, shimmer: 0 } },
    { key: 'cavern', total: 100, air: 10, tiles: new Map([[1, 90]]), liquid: { water: 0, lava: 0, honey: 0, shimmer: 0 } },
    { key: 'underworld', total: 100, air: 0, tiles: new Map([[1, 100]]), liquid: { water: 0, lava: 0, honey: 0, shimmer: 0 } },
  ],
}

const sections: WorldSections = {
  chests: 1,
  chestList: [
    {
      x: 6919,
      y: 1453,
      name: '宝箱',
      capacity: 40,
      items: [
        { slot: 0, id: 4956, stack: 1, prefix: 82 },
        { slot: 1, id: 75, stack: 27, prefix: 0 },
      ],
    },
  ],
  chestItems: new Map([
    [4956, 1],
    [75, 27],
  ]),
  chestItemKinds: 2,
  signs: 1,
  signList: [{ x: 5071, y: 1668, text: '第一行\n第二行' }],
  npcs: 1,
  npcList: [
    { netId: 22, name: 'Cole', x: 66657, y: 6856, homeX: 4167, homeY: 431, homeless: false },
  ],
  tileEntities: 4,
}

const names: AnalysisNames = {
  tile: (id) => (id === 1 ? '石块' : '土块'),
  wall: () => '石墙',
  item: (id) => (id === 4956 ? '天顶剑' : '坠落之星'),
  prefix: (id) => (id === 82 ? '传奇' : `#${id}`),
  npc: () => '向导',
}

describe('地图分析导出文本', () => {
  const text = buildAnalysisText({ info, stats, sections, names, exportedAt: '2026-10-26T12:00:00Z' })

  it('分节且包含关键数值（与参考件同名分节）', () => {
    for (const section of ['World', 'Tiles', 'Walls', 'Liquids', 'Chests', 'Signs', 'NPCs', 'Tile Entities']) {
      expect(text).toContain(`===SECTION: ${section}===`)
    }
    expect(text).toContain('Title: wukong')
    expect(text).toContain('Size: 8400 x 2400 (20160000 tiles)')
    expect(text).toContain('Air: 8937097 (44.33%)')
    expect(text).toContain('石块: 4119670 (20.43%)')
    expect(text).toContain('Water: 10')
    expect(text).toContain('Shimmer: 1')
  })

  it('箱子逐格内容包含格位 / 数量 / 词缀 / 名字', () => {
    expect(text).toContain('Chest Count: 1')
    expect(text).toContain('[6919, 1453] {宝箱} - Contents: [0]: 1 - 传奇 天顶剑,[1]: 27 - 坠落之星')
  })

  it('分层统计：每层的 y 范围、空气占比与主要方块', () => {
    expect(text).toContain('===SECTION: Zones===')
    expect(text).toContain('Surface (y 0-608): tiles 100, air 60 (60.00%)')
    expect(text).toContain('Underworld (y 2200-2399): tiles 100, air 0 (0.00%)')
    expect(text).toContain('top: 石块 40')
  })

  it('招牌多行压成一行、NPC 带位置与家', () => {
    expect(text).toContain('[5071, 1668] 第一行 / 第二行')
    expect(text).toContain('ID: 向导, Name: Cole, Position: [66657.00, 6856.00], Home: [4167, 431]')
    expect(text).toContain('Tile Entities Count: 4')
  })

  it('缺段时用 - 占位而不是崩', () => {
    const partial = buildAnalysisText({
      info,
      stats,
      sections: {
        chests: null,
        chestList: null,
        chestItems: null,
        chestItemKinds: null,
        signs: null,
        signList: null,
        npcs: null,
        npcList: null,
        tileEntities: null,
      },
      names,
      exportedAt: 'x',
    })
    expect(partial).toContain('Chest Count: -')
    expect(partial).toContain('Sign Count: -')
    expect(partial).toContain('NPC Count: -')
    expect(partial).toContain('Tile Entities Count: -')
  })

  it('文件名去掉非法字符', () => {
    expect(analysisFilename('wukong')).toBe('wukong-analysis.txt')
    expect(analysisFilename('我的 世界/1')).toBe('我的_世界_1-analysis.txt')
    expect(analysisFilename('')).toBe('world-analysis.txt')
  })
})

describe('导出报告里的时间行', () => {
  it('创建时间原样（本地墙上时间）、最后游玩换算本地，与界面一致', () => {
    const text = buildAnalysisText({
      info: { ...info, createdAt: '2026-09-17T09:59:24.953', lastPlayed: '2026-09-17T12:25:42.928Z' },
      stats,
      sections,
      names,
      exportedAt: '2026-10-27T00:00:00.000Z',
    })
    expect(text).toContain('Created: 2026-09-17 09:59')
    const at = new Date('2026-09-17T12:25:42.928Z')
    const p2 = (n: number) => String(n).padStart(2, '0')
    expect(text).toContain(
      `LastPlayed: ${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}`,
    )
  })
})
