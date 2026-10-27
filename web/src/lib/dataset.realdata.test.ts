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
const itemGroups = readJson<{
  meta: { tabCount: number }
  tabs: Array<{ id: string; label: string }>
  items: Record<string, { g: string; gv: number; o: number; t: number[] }>
}>('item-groups.json')
const shimmer = readJson<{ meta: { count: number }; items: Record<string, number> }>('shimmer.json')
const prefixSets = readJson<{
  meta: { setCount: number }
  sets: number[][]
  items: Record<string, number>
}>('prefix-sets.json')
const permissionsData = readJson<{
  meta: { permissionCount: number; groupCount: number; tshockVersion: string }
  permissions: { node: string; desc: string }[]
  groups: string[]
}>('permissions.json')
const itemLimits = readJson<{
  meta: { itemCount: number; gameVersion: string }
  maxStack: Record<string, number>
  noInventory: number[]
}>('item-limits.json')

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
    expect(ds.itemGroups.tabs.length).toBe(11)
    expect(ds.itemGroups.items['4956'].g).toBe('MeleeWeapon')
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

describe('真实数据：创意菜单物品分组（item-groups.json）', () => {
  it('页签 = 游戏创意菜单的 11 个 ItemFilters，顺序固定', () => {
    expect(itemGroups.meta.tabCount).toBe(11)
    expect(itemGroups.tabs.map((t) => t.id)).toEqual([
      'weapons',
      'armor',
      'vanity',
      'blocks',
      'furniture',
      'accessories',
      'accessoriesMisc',
      'consumables',
      'tools',
      'materials',
      'misc',
    ])
    // 页签 key 保留游戏本地化出处
    for (const t of itemGroups.tabs) expect(t.label).toMatch(/^CreativePowers\.Tab/)
  })

  it('每件物品都有 ItemGroup / 组内顺序 / 页签下标，且下标合法', () => {
    const entries = Object.entries(itemGroups.items)
    expect(entries.length).toBeGreaterThan(6000)
    for (const [, v] of entries) {
      expect(typeof v.g).toBe('string')
      expect(typeof v.gv).toBe('number')
      expect(typeof v.o).toBe('number')
      expect(Array.isArray(v.t)).toBe(true)
      for (const i of v.t) {
        expect(i).toBeGreaterThanOrEqual(0)
        expect(i).toBeLessThan(11)
      }
    }
  })

  it('样例：天顶剑属于武器页签，生命水晶同时属于消耗品与材料', () => {
    expect(itemGroups.items['4956'].g).toBe('MeleeWeapon')
    expect(itemGroups.items['4956'].t).toContain(0)
    expect(itemGroups.items['29'].t).toEqual(expect.arrayContaining([7, 9]))
  })
})

describe('真实数据：可滚词缀（prefix-sets.json）', () => {
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

  it('武器有可滚词缀，材料 / 盔甲没有', () => {
    expect(prefixSets.meta.setCount).toBeGreaterThan(0)
    // 天顶剑（4956，剑）有；铁锭（22，材料）没有
    expect(prefixSets.items['4956']).toBeGreaterThanOrEqual(0)
    expect(prefixSets.items['22']).toBeUndefined()
  })

  it('loadDataset 建立 rollablePrefixesById', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    expect(ds.rollablePrefixesById.get(4956)?.length).toBeGreaterThan(0)
    expect(ds.rollablePrefixesById.has(22)).toBe(false)
  })
})

describe('真实数据：微光转换（shimmer.json）', () => {
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

  it('包含数百条映射，且都是有效物品 id', () => {
    expect(shimmer.meta.count).toBeGreaterThan(200)
    for (const [from, to] of Object.entries(shimmer.items)) {
      expect(Number(from)).toBeGreaterThan(0)
      expect(to).toBeGreaterThan(0)
      expect(to).not.toBe(Number(from))
    }
  })

  it('loadDataset 会建立正向 / 反向索引', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    const first = Number(Object.keys(shimmer.items)[0])
    const to = shimmer.items[String(first)]
    expect(ds.shimmerToById.get(first)).toBe(to)
    expect(ds.shimmerFromById.get(to)).toContain(first)
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

  it('loadDataset 载入图格 / 墙 ID 表', async () => {
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
    const ds = await loadDataset('zh')
    expect(ds.tiles.entries.length).toBeGreaterThan(700)
    expect(ds.walls.entries.length).toBeGreaterThan(300)
    expect(ds.tilesById.get(1)?.key).toBe('Stone')
    expect(ds.tilesById.get(1)?.item).toBe(3)
    expect(ds.tilesById.get(14)?.size).toEqual([3, 2])
    expect(ds.tilesById.get(5)?.frameImportant).toBe(true)
    expect(ds.wallsById.get(4)?.key).toBe('Wood')
    // 墙没有尺寸概念（frameImportant/size 只属于图格）
    expect(ds.wallsById.get(4)?.size).toBeUndefined()
    expect(ds.wallsById.get(4)?.frameImportant).toBeUndefined()
  })

  it('npcs.json 带有 /sb（spawnboss）参数信息', async () => {
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
    const ds = await loadDataset('zh')
    expect(ds.npcsById.get(4)?.sb).toBe('eye of cthulhu')
    expect(ds.npcsById.get(50)?.sb).toBe('king slime')
    expect(ds.npcsById.get(113)?.sb).toBe('wall of flesh')
    // 普通怪物没有 /sb
    expect(ds.npcsById.get(1)?.sb).toBeUndefined()
  })
})

describe('真实数据：物品数量上限（item-limits.json）', () => {
  it('覆盖全部物品，且是游戏自身的堆叠上限', () => {
    expect(itemLimits.meta.itemCount).toBeGreaterThan(6000)
    expect(Object.keys(itemLimits.maxStack)).toHaveLength(itemLimits.meta.itemCount)
    // 铜/银/金币 100、大多数物品 9999（`Item.CommonMaxStack`），少数拾取物 1。
    expect(itemLimits.maxStack['71']).toBe(100) // 铜币
    expect(itemLimits.maxStack['74']).toBe(9999) // 白金比索
    expect(itemLimits.maxStack['1']).toBe(9999) // 铁镐
    expect(itemLimits.maxStack['58']).toBe(1) // 生命之心
    // 每个值都必须是正整数
    for (const n of Object.values(itemLimits.maxStack)) expect(n).toBeGreaterThan(0)
  })

  it('禁入背包的 id 名单与源码一致（加载时会被 FixAgainstExploit 变成空气）', () => {
    expect(new Set(itemLimits.noInventory)).toEqual(
      new Set([58, 184, 1734, 1735, 1867, 1868, 3453, 3454, 3455, 4143, 5013, 6135, 6136]),
    )
  })
})

describe('真实数据：权限节点 / 内置用户组（permissions.json）', () => {
  it('从 TShock 源码抽到的节点数量与 meta 一致，且每个都有说明', () => {
    expect(permissionsData.permissions).toHaveLength(permissionsData.meta.permissionCount)
    expect(permissionsData.permissions.length).toBeGreaterThan(150)
    expect(permissionsData.permissions.every((p) => p.desc.length > 0)).toBe(true)
  })

  it('本项目依赖的两条 REST 权限在表里（登录 / 执行指令要用到）', () => {
    const nodes = new Set(permissionsData.permissions.map((p) => p.node))
    expect(nodes.has('tshock.rest.useapi')).toBe(true)
    expect(nodes.has('tshock.rest.command')).toBe(true)
  })

  it('内置用户组齐全（默认组 + 逐级管理员）', () => {
    expect(new Set(permissionsData.groups)).toEqual(
      new Set(['admin', 'default', 'guest', 'insecure-guest', 'newadmin', 'owner', 'trustedadmin', 'vip']),
    )
  })

  it('权限节点没有重复', () => {
    const nodes = permissionsData.permissions.map((p) => p.node)
    expect(nodes).toHaveLength(new Set(nodes).size)
  })
})
