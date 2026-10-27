import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDataset } from '@/test/fixtures'
import { resolveTileName, searchTargets, searchTiles, wallDisplayName } from './tiles'
import type { Dataset, LocalizationBundle, TileNamesData } from '@/types'

const dataDir = resolve(process.cwd(), '../data')
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T

const tileNames = readJson<TileNamesData>('tile-names.json')
const locZh = readJson<LocalizationBundle>('loc.zh-Hans.json')
const items = readJson<{ items: { id: number; key: string }[] }>('items.json').items
const locItems = locZh.ItemName ?? {}
const itemsById = new Map(
  items.map((it) => [it.id, { ...it, name: locItems[it.key] ?? it.key }] as never),
)

/** 用真实数据拼一个够用的 dataset（只填 tiles 相关字段）。 */
function realDataset(): Dataset {
  const tiles = readJson<{ entries: { id: number; key: string; item: number | null }[] }>('tiles.json')
  const walls = readJson<{ entries: { id: number; key: string; item: number | null }[] }>('walls.json')
  const entries = tiles.entries.map((e) => ({ ...e }))
  const wallEntries = walls.entries.map((e) => ({ ...e }))
  return {
    ...makeDataset(),
    tileNames,
    loc: { ...makeDataset().loc, MapObject: locZh.MapObject },
    itemsById: itemsById as never,
    tiles: { ...makeDataset().tiles, entries },
    tilesById: new Map(entries.map((e) => [e.id, e])),
    walls: { ...makeDataset().walls, entries: wallEntries },
    wallsById: new Map(wallEntries.map((e) => [e.id, e])),
  } as Dataset
}

describe('图格名（口径 = 游戏地图图例）', () => {
  const dataset = realDataset()

  it('生命水晶：图格 12 没有代表物品，但图例名指向物品 29', () => {
    expect(tileNames.items['12']).toBe(29)
    const name = resolveTileName(dataset.tilesById.get(12), dataset)
    expect(name).toBe('生命水晶')
  })

  it('MapObject 类：铁矿石 / 罐子 / 树用本地化图例名', () => {
    expect(resolveTileName(dataset.tilesById.get(6), dataset)).toBe('铁')
    expect(resolveTileName(dataset.tilesById.get(28), dataset)).toBe('罐子')
    expect(resolveTileName(dataset.tilesById.get(5), dataset)).toBe('树')
  })

  it('没有任何名字来源时回退常量名', () => {
    const name = resolveTileName({ id: 999, key: 'MysteryTile', item: null }, dataset)
    expect(name).toBe('MysteryTile')
  })
})

describe('按名字搜图格', () => {
  const dataset = realDataset()

  it('搜「生命水晶」能命中图格 12', () => {
    const hits = searchTiles(dataset, '生命水晶')
    // 命中集合里必须有图格 12（它的图例名就是物品 29 = 生命水晶）。
    // 注意别断言「排第一位」：fixture 里图格 1 的代表物品也是 29，两者同名；
    // 真实数据里不会撞（图格 1 的代表物品是土块），排序按表顺序即可。
    expect(hits).toEqual(expect.arrayContaining([expect.objectContaining({ id: 12, name: '生命水晶' })]))
  })

  it('支持常量名与 id', () => {
    expect(searchTiles(dataset, 'Heart').some((h) => h.id === 12)).toBe(true)
    expect(searchTiles(dataset, '12')[0].id).toBe(12)
  })

  it('空关键词不返回任何结果（避免一次列出 754 条）', () => {
    expect(searchTiles(dataset, '   ')).toEqual([])
  })

  it('限制返回条数', () => {
    expect(searchTiles(dataset, '石', 3).length).toBeLessThanOrEqual(3)
  })
})

describe('统一搜索：图格 / 墙 / 液体', () => {
  const dataset = realDataset()
  const t = (key: string) =>
    ({
      'wld.analysis.water': '水',
      'wld.analysis.lava': '岩浆',
      'wld.analysis.honey': '蜂蜜',
      'wld.analysis.shimmer': '微光',
    })[key] ?? key

  it('搜液体名能命中液体目标', () => {
    const hits = searchTargets(dataset, '岩浆', t)
    expect(hits[0]).toMatchObject({ kind: 'liquid', id: 2, name: '岩浆' })
  })

  it('搜墙：常量名能命中（墙的 key 是 Stone / DirtUnsafe 这类）', () => {
    // 用真实数据：墙 40 的常量名是 SnowWallUnsafe
    const hits = searchTargets(dataset, 'SnowWallUnsafe', t)
    expect(hits.some((h) => h.kind === 'wall' && h.id === 40)).toBe(true)
    // 没有代表物品时回退常量名
    expect(wallDisplayName(dataset, 40)).toBe('SnowWallUnsafe')
  })

  it('结果按上限截断，且不会重复灌入同一目标', () => {
    const hits = searchTargets(dataset, '石', t, 5)
    expect(hits.length).toBeLessThanOrEqual(5)
    const keys = hits.map((h) => `${h.kind}:${h.id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('空关键词返回空', () => {
    expect(searchTargets(dataset, '  ', t)).toEqual([])
  })
})
