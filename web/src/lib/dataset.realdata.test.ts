import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDataset } from './dataset'
import { locText } from './loc'
import type { Item, LocalizationBundle, Prefix, RecipesData } from '@/types'

/**
 * 真实生成数据的一致性测试：语言拆分后 items/prefixes 不再带名字，
 * 名字必须能从 loc.<culture>.json 解析；配方组名同理。
 * 防止 tools/ 生成脚本与前端数据契约漂移。
 */
// vitest 的 cwd 是 web/，数据在仓库根 data/ 下。
const dataDir = resolve(process.cwd(), '../data')
const readJson = <T>(file: string): T => JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')) as T

const items = readJson<{ items: Array<Omit<Item, 'name'>> }>('items.json').items
const prefixes = readJson<{ prefixes: Array<Omit<Prefix, 'name'>> }>('prefixes.json').prefixes
const recipes = readJson<RecipesData>('recipes.json')
const locZh = readJson<LocalizationBundle>('loc.zh-Hans.json')
const locEn = readJson<LocalizationBundle>('loc.en-US.json')
const stats = readJson<{ items: Record<string, { stats?: unknown }> }>('item-stats.json')
const tipsZh = readJson<{ items: Record<string, string[]> }>('item-tips.zh-Hans.json')
const tipsEn = readJson<{ items: Record<string, string[]> }>('item-tips.en-US.json')

describe('真实数据：语言拆分契约', () => {
  it('items.json / prefixes.json 不含任何语言字段', () => {
    expect(items.length).toBeGreaterThan(6000)
    for (const it of items) {
      expect(it).not.toHaveProperty('name')
      expect(it).not.toHaveProperty('nameEn')
      expect(typeof it.key).toBe('string')
    }
    for (const pf of prefixes) {
      expect(pf).not.toHaveProperty('name')
      expect(pf).not.toHaveProperty('nameEn')
    }
  })

  it('每个物品的内部名都能解析出中英名', () => {
    const missingZh: string[] = []
    const missingEn: string[] = []
    for (const it of items) {
      if (!locZh.ItemName?.[it.key]) missingZh.push(it.key)
      if (!locEn.ItemName?.[it.key]) missingEn.push(it.key)
    }
    // 官方本地化存在少量无名字的回退项（items.json 会退回内部名），数量应极少。
    expect(missingZh.length).toBeLessThan(20)
    expect(missingEn.length).toBeLessThan(20)
  })

  it('每个物品都有对应的 tip 行文件（按语言）', () => {
    expect(Object.keys(tipsZh.items).length).toBeGreaterThan(6000)
    expect(Object.keys(tipsEn.items).length).toBeGreaterThan(6000)
  })

  it('item-stats.json 只含 stats，不含 tip', () => {
    for (const id of Object.keys(stats.items)) {
      expect(stats.items[id]).not.toHaveProperty('tip')
    }
  })

  it('所有配方组 key 都能在中英本地化里解析出名字', () => {
    const groups = Object.entries(recipes.groups)
    expect(groups.length).toBe(34)
    for (const [name, g] of groups) {
      expect(g).not.toHaveProperty('name')
      const zh = locText(locZh, g.key)
      const en = locText(locEn, g.key)
      expect(zh, `配方组 ${name} (${g.key}) 缺中文名`).toBeTruthy()
      expect(en, `配方组 ${name} (${g.key}) 缺英文名`).toBeTruthy()
    }
  })

  it('样例：天顶剑在两种语言下名字正确', () => {
    const zenith = items.find((it) => it.id === 4956)
    expect(zenith?.key).toBe('Zenith')
    expect(locZh.ItemName?.[zenith!.key]).toBe('天顶剑')
    expect(locEn.ItemName?.[zenith!.key]).toBe('Zenith')
    expect(tipsZh.items['4956']?.[0]).toContain('伤害')
    expect(tipsEn.items['4956']?.[0]).toContain('damage')
  })
})

describe('loadDataset 按语言加载（真实数据）', () => {
  afterEach(() => vi.unstubAllGlobals())

  const mockFetch = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const rel = String(input).replace(/^.*\/data\//, '')
        try {
          return new Response(readFileSync(resolve(dataDir, rel)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        } catch {
          return new Response('not found', { status: 404 })
        }
      }),
    )

  it('中文：名称 / 提示行 / 词缀 / 配方组名均取 zh-Hans', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    expect(ds.itemsById.get(4956)?.name).toBe('天顶剑')
    expect(ds.itemStats.items['4956']?.tip?.[0]).toContain('伤害')
    expect(ds.prefixesById.get(1)?.name).toBe('大')
    expect(locText(ds.loc, ds.recipes.groups.Wood.key)).toBe('木材')
    expect(locText(ds.loc, ds.recipes.groups.Turtles.key)).toBe('龟')
  })

  it('英文：名称 / 提示行 / 词缀均取 en-US', async () => {
    mockFetch()
    const ds = await loadDataset('en')
    expect(ds.itemsById.get(4956)?.name).toBe('Zenith')
    expect(ds.itemStats.items['4956']?.tip?.[0]).toContain('damage')
    expect(ds.prefixesById.get(1)?.name).toBe('Large')
    expect(locText(ds.loc, ds.recipes.groups.Wood.key)).toBe('Wood')
  })
})

describe('真实数据：NPC / buff（参数补全数据源）', () => {
  const npcs = readJson<{ npcs: Array<{ id: number; key: string }> }>('npcs.json').npcs
  const buffs = readJson<{ buffs: Array<{ id: number; key: string }> }>('buffs.json').buffs

  it('npcs.json / buffs.json 只含 id+key，名字交给本地化', () => {
    expect(npcs.length).toBeGreaterThan(600)
    expect(buffs.length).toBeGreaterThan(300)
    for (const n of npcs) expect(n).not.toHaveProperty('name')
    for (const b of buffs) expect(b).not.toHaveProperty('name')
  })

  it('绝大多数 NPC / buff 内部名能解析出中英名', () => {
    let missNpcZh = 0, missNpcEn = 0, missBuffZh = 0, missBuffEn = 0
    for (const n of npcs) {
      if (!locZh.NPCName?.[n.key]) missNpcZh++
      if (!locEn.NPCName?.[n.key]) missNpcEn++
    }
    for (const b of buffs) {
      if (!locZh.BuffName?.[b.key]) missBuffZh++
      if (!locEn.BuffName?.[b.key]) missBuffEn++
    }
    expect(missNpcZh).toBeLessThan(40)
    expect(missNpcEn).toBeLessThan(40)
    expect(missBuffZh).toBeLessThan(60)
    expect(missBuffEn).toBeLessThan(60)
  })

  it('loadDataset 解析出 NPC / buff 显示名', async () => {
    const mockFetch = () =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const rel = String(input).replace(/^.*\/data\//, '')
          try {
            return new Response(readFileSync(resolve(dataDir, rel)), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          } catch {
            return new Response('not found', { status: 404 })
          }
        }),
      )
    mockFetch()
    const ds = await loadDataset('zh')
    expect(ds.npcsById.get(1)?.name).toBe('蓝史莱姆')
    expect(ds.buffsById.get(1)?.name).toBe('黑曜石皮')
    expect(ds.npcsById.get(1)?.key).toBe('BlueSlime')
  })
})
