// @vitest-environment node
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
const bestiary = readJson<{
  meta: { filterCount: number; npcCount: number }
  filters: { key: string; icon: { texture: string } }[]
  npcs: Record<string, { sortId: number; rarity: number; filters: number[]; damage: number }>
}>('npc-bestiary.json')
const bestiaryIcons = readJson<{
  meta: { tags: { cols: number; rows: number; cell: number }; rank: { cell: number } }
  filters: { key: string; texture: string; frame: number }[]
}>('bestiary-icons.json')
const npcVariants = readJson<{
  meta: { count: number }
  variants: { id: number; key: string | null; baseId: number; scale: number; color: number[] }[]
}>('npc-variants.json')
const allNpcs = readJson<{ npcs: Array<{ id: number; key: string; base?: number; scale?: number }> }>(
  'npcs.json',
).npcs
const allBuffIds = new Set(
  readJson<{ buffs: Array<{ id: number }> }>('buffs.json').buffs.map((b) => b.id),
)
const allItemIds = new Set(items.map((it) => it.id))
const buffItems = readJson<{
  meta: { buffCount: number; withItems: number; pairCount: number; gameVersion: string }
  items: Record<string, number[]>
}>('buff-items.json')
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

  it('负值变体的名字回退母体：界面上不出现 BigHornetStingy 这类内部名', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    // 只有 12 个变体有独立名字（小史莱姆 / 粉史莱姆…），其余显示母体名（黄蜂 / 僵尸 / 骷髅…）
    expect(ds.npcsById.get(-1)?.name).toBe('小史莱姆')
    expect(ds.npcsById.get(-8)?.name).toBe('红史莱姆')
    expect(ds.npcsById.get(-65)?.name).toBe('黄蜂')
    expect(ds.npcsById.get(-53)?.name).toBe('骷髅')
    for (const npc of ds.npcs) {
      if (npc.id >= 0) continue
      // 中文界面下不能是内部名（fallback 链走完仍无名字的才允许）
      expect(npc.name, `${npc.id} ${npc.key}`).not.toBe(npc.key)
    }
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

describe('真实数据：Buff 描述与来源物品（buff-items.json）', () => {
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

  it('buff-items.json 只列真实 buff / 物品，且每组升序', () => {
    expect(buffItems.meta.buffCount).toBe(400)
    expect(buffItems.meta.withItems).toBeGreaterThan(200)
    let pairs = 0
    for (const [buffId, list] of Object.entries(buffItems.items)) {
      expect(allBuffIds.has(Number(buffId))).toBe(true)
      expect(list.length).toBeGreaterThan(0)
      expect([...list].sort((a, b) => a - b)).toEqual(list)
      for (const id of list) {
        expect(allItemIds.has(id)).toBe(true)
        pairs += 1
      }
    }
    expect(pairs).toBe(buffItems.meta.pairCount)
  })

  it('使用物品来源：1 号 buff 来自 288 黑曜石皮药水（Item.buffType）', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    const buff = ds.buffsById.get(1)!
    expect(buff.tip).toBe('对熔岩免疫')
    expect(buff.items).toEqual([288])
    expect(ds.itemsById.get(288)?.name).toBe('黑曜石皮药水')
  })

  it('坐骑来源：兔兔坐骑 buff 来自 2428 绒毛胡萝卜（Mount.cs）', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    const buff = ds.buffsById.get(128)!
    expect(buff.items).toEqual([2428])
    expect(ds.itemsById.get(2428)?.name).toBe('绒毛胡萝卜')
  })

  it('多件来源全部保留：吃得好列出 42 种食物', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    const items26 = ds.buffsById.get(26)!.items ?? []
    expect(items26.length).toBe(42)
    for (const id of items26) expect(ds.itemsById.has(id)).toBe(true)
  })

  it('名称 / 描述里的 {$…} 占位符已展开（矿车系列引用 BuffName.Minecart）', async () => {
    mockFetch()
    const zh = await loadDataset('zh')
    expect(zh.buffsById.get(166)?.name).toBe('矿车')
    expect(zh.buffs.every((b) => !b.name.includes('{$'))).toBe(true)
    expect(zh.buffs.every((b) => !(b.tip ?? '').includes('{$'))).toBe(true)
    const en = await loadDataset('en')
    expect(en.buffsById.get(166)?.name).toBe('Minecart')
  })

  it('没有来源物品的 buff（debuff / 护甲套装）不硬凑物品', async () => {
    mockFetch()
    const ds = await loadDataset('zh')
    expect(ds.buffsById.get(20)?.items).toBeUndefined()
    expect(ds.buffsById.get(24)?.items).toBeUndefined()
  })
})

describe('真实数据：怪物图鉴（npc-bestiary / bestiary-icons / npc-variants）', () => {
  it('筛选器顺序与游戏一致，文案 key 都能在 loc 里找到', () => {
    expect(bestiary.meta.filterCount).toBe(59)
    // 游戏里第一个是「未解锁」（本站没有解锁进度，故意不导出），所以这里开头是 Boss / 稀有
    expect(bestiary.filters[0]?.key).toBe('BestiaryInfo.IsBoss')
    expect(bestiary.filters[1]?.key).toBe('BestiaryInfo.IsRare')
    expect(bestiary.filters[2]?.key).toBe('Bestiary_Biomes.Surface')
    for (const filter of bestiary.filters) {
      expect(locText(locZh, filter.key), filter.key).toBeTruthy()
      expect(locText(locEn, filter.key), filter.key).toBeTruthy()
    }
  })

  it('每个筛选器都有图标帧号，且帧号在贴图网格内', () => {
    const { cols, rows } = bestiaryIcons.meta.tags
    expect(bestiaryIcons.filters.map((f) => f.key)).toEqual(bestiary.filters.map((f) => f.key))
    for (const icon of bestiaryIcons.filters) {
      if (icon.texture === 'rank') {
        expect(icon.frame).toBe(0)
        continue
      }
      expect(icon.frame).toBeGreaterThanOrEqual(0)
      expect(icon.frame).toBeLessThan(cols * rows)
    }
  })

  it('每个 NPC（含负值变体）都有图鉴数据，筛选器下标合法', () => {
    const ids = new Set(allNpcs.map((n) => n.id))
    const indexed = Object.keys(bestiary.npcs).map(Number)
    expect(indexed.length).toBe(bestiary.meta.npcCount)
    // 反方向必须全覆盖：页面上出现的每个 NPC 都要能筛能排。
    // （反过来有 2 个例外：76 / 146 在 NPCID 里没有常量名，不落 npcs.json。）
    for (const id of ids) expect(bestiary.npcs[String(id)], `${id} 缺图鉴数据`).toBeTruthy()
    const withSortId = indexed.filter((id) => bestiary.npcs[String(id)]!.sortId > 0)
    // 652 个图鉴条目有序号；其余（旧变体 / 图鉴隐藏）由前端按自身 id 接在后面。
    expect(withSortId.length).toBeGreaterThan(600)
    for (const id of indexed) {
      const entry = bestiary.npcs[String(id)]!
      // 少数被图鉴隐藏的 NPC（ShouldHideBestiaryEntry）没有排序 id，界面里排最后。
      expect(entry.sortId).toBeGreaterThanOrEqual(0)
      for (const index of entry.filters) {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(bestiary.meta.filterCount)
      }
    }
    // 负值变体沿用母体条目的筛选器（Boss 眼球的替身之类不会漏）
    expect(bestiary.npcs['-8']?.filters.length).toBeGreaterThan(0)
  })

  it('负值变体：-1..-65 全在 npcs.json 里，带母体与缩放', () => {
    expect(npcVariants.variants).toHaveLength(65)
    expect(npcVariants.meta.count).toBe(65)
    const byId = new Map(allNpcs.map((n) => [n.id, n]))
    for (const variant of npcVariants.variants) {
      const npc = byId.get(variant.id)
      expect(npc, `npcs.json 缺 ${variant.id}`).toBeTruthy()
      expect(npc!.base).toBe(variant.baseId)
      expect(npc!.scale).toBeCloseTo(variant.scale, 3)
    }
    // 负值 id 连续覆盖 -1..-65
    expect(npcVariants.variants.map((v) => v.id).sort((a, b) => b - a)).toEqual(
      Array.from({ length: 65 }, (_, i) => -1 - i),
    )
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
    // 负值变体（-1..-65）大多没有独立名字（游戏里显示母体名），只统计正数 id。
    for (const n of npcs) {
      if (n.id < 0) continue
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
