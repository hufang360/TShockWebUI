import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandHelpLine, commandSyntaxArgs, computeCompletions } from './completion'
import { makeDataset } from '@/test/fixtures'
import type { CommandDef, PermissionsData } from '@/types'

/**
 * 用**真实生成的数据**（data/commands.json，由 tools/gen-data.mjs 从 TShock 源码提取）
 * 跑一遍参数补全，防止数据 schema 与前端逻辑漂移。
 * 物品/词缀沿用测试夹具，避免解析 1MB 的 items.json。
 */
// vitest 的 cwd 是 web/，数据在仓库根 data/ 下。
const commands = JSON.parse(
  readFileSync(resolve(process.cwd(), '../data/commands.json'), 'utf8'),
).commands as CommandDef[]

const dataset = makeDataset({ commands })
const at = (text: string) => ({ dataset, text, caret: text.length, players: ['Alice', 'Bob'] })

describe('真实命令数据（data/commands.json）', () => {
  it('绝大多数核心指令都带上了参数表', () => {
    const withParams = commands.filter((c) => (c.paramSets?.length ?? 0) > 0)
    expect(withParams.length).toBeGreaterThanOrEqual(60)
    for (const c of withParams) {
      for (const set of c.paramSets ?? []) {
        expect(set.syntax.length).toBeGreaterThan(0)
        for (const a of set.args) {
          expect(Boolean(a.literal) !== Boolean(a.name)).toBe(true)
          if (a.kind === 'enum') expect(a.values?.length ?? 0).toBeGreaterThan(0)
        }
      }
    }
  })

  it('/accountinfo：候选行带语法，参数区给出完整用法 + 说明', () => {
    const cmd = commands.find((c) => c.name === 'accountinfo')
    expect(cmd).toBeTruthy()
    // 候选行：`<username>`（指令名已在行首，不重复）。
    expect(commandSyntaxArgs(cmd!)).toBe('<username>')
    const item = computeCompletions(at('/accountinfo')).find((c) => c.command?.name === 'accountinfo')
    expect(item?.syntax).toBe('<username>')
    // 参数区：完整用法 + 中文说明；没人时下拉框也能靠这一行说明怎么写。
    expect(commandHelpLine(dataset, '/accountinfo ', 13)).toEqual({
      syntax: '/accountinfo <username>',
      note: '显示一个用户的信息。',
      argName: 'username',
      argRequired: true,
    })
    // 在线玩家为空时没有值候选（帮助行照样显示，见 CommandEditor）。
    expect(computeCompletions({ ...at('/accountinfo '), players: [] })).toHaveLength(0)
  })

  it('/help：候选行只说「是什么」，语法留给帮助条（不重复）', () => {
    const item = computeCompletions(at('/help')).find((c) => c.command?.name === 'help')
    // 行内：只有说明（别名先拼，没别名就只剩说明）。
    expect(item?.detail).toBe('列出指令或显示指令的帮助信息。')
    expect(item?.detail).not.toContain('<command/page>')
    // 帮助条：完整用法（带指令名）。
    expect(item?.syntax).toBe('<command/page>')
    // 参数区：同一条用法 + 当前参数名（供高亮）。
    expect(commandHelpLine(dataset, '/help ', 6)).toMatchObject({
      syntax: '/help <command/page>',
      argName: 'command/page',
      argRequired: true,
    })
  })

  it('/give：物品 → 玩家 → 数量 → 词缀 逐位补全', () => {
    expect(computeCompletions(at('/give 生命'))[0]).toMatchObject({ kind: 'item', insert: '29' })
    expect(computeCompletions(at('/give 29 A')).map((c) => c.insert)).toEqual(['Alice'])
    expect(computeCompletions(at('/give 29 Alice '))).toHaveLength(0) // amount：number
    expect(computeCompletions(at('/give 29 Alice 1 传'))[0]).toMatchObject({
      kind: 'prefix',
      insert: '81',
    })
  })

  it('/spawnboss：BOSS 名来自源码 switch 的 case 标签', () => {
    const items = computeCompletions(at('/spawnboss moon'))
    expect(items.map((c) => c.insert)).toContain('"moon lord"') // 含空格 → 自动加引号
    expect(items.every((c) => c.kind === 'enum')).toBe(true)
  })

  it('/spawnboss：枚举取值带 NPC 显示名，且可按中文名搜索', () => {
    const items = computeCompletions(at('/spawnboss eye'))
    const hit = items.find((c) => c.label === 'eye of cthulhu')
    expect(hit).toMatchObject({ kind: 'enum', detail: '克苏鲁之眼' })
    // 输入中文名也能命中对应取值（夹具 NPC：克苏鲁之眼）
    expect(computeCompletions(at('/spawnboss 克苏鲁')).map((c) => c.insert)).toContain(
      '"eye of cthulhu"',
    )
  })

  it('/worldevent /worldmode /time /clear：枚举取值带中文备注名', () => {
    expect(computeCompletions(at('/worldevent blood'))[0]).toMatchObject({
      kind: 'enum',
      label: 'bloodmoon',
      detail: '血月',
    })
    // 按中文备注名搜索
    expect(computeCompletions(at('/worldevent 血')).map((c) => c.insert)).toContain('bloodmoon')
    expect(computeCompletions(at('/worldmode exp'))[0]).toMatchObject({
      label: 'expert',
      detail: '专家',
    })
    expect(computeCompletions(at('/time mid'))[0]).toMatchObject({
      label: 'midnight',
      detail: '午夜',
    })
    expect(computeCompletions(at('/clear pro'))[0]).toMatchObject({
      label: 'projectile',
      detail: '弹幕',
    })
  })

  it('/worldevent invasion：三级子命令（入侵类型）补全 + 备注', () => {
    const kinds = computeCompletions(at('/worldevent invasion '))
    expect(kinds.map((c) => c.label)).toContain('goblins')
    expect(kinds.find((c) => c.label === 'goblins')?.detail).toBe('哥布林入侵')
    expect(kinds.find((c) => c.label === 'martians')?.detail).toBe('火星暴乱')
    // 前缀筛选
    expect(computeCompletions(at('/worldevent invasion pir')).map((c) => c.label)).toContain(
      'pirates',
    )
    // 波数是 number → 不给候选
    expect(computeCompletions(at('/worldevent invasion pumpkinmoon '))).toHaveLength(0)
  })

  it('字面量子命令（/region、/warp、/group）二级补全带备注', () => {
    const region = computeCompletions(at('/region '))
    expect(region.map((c) => c.label)).toContain('define')
    expect(region.find((c) => c.label === 'define')?.detail).toBe('定义区域')
    expect(computeCompletions(at('/region re')).map((c) => c.label)).toEqual(
      expect.arrayContaining(['resize', 'rename', 'remove']),
    )
    expect(computeCompletions(at('/warp ')).find((c) => c.label === 'send')?.detail).toBe(
      '把玩家送到传送点',
    )
    expect(computeCompletions(at('/group ')).map((c) => c.label)).toContain('addperm')
  })

  it('插件字面量子命令（/pm、/wm、/fish）二级补全带备注', () => {
    const pm: CommandDef = {
      name: 'playermanager',
      aliases: ['pm', 'ppm'],
      permission: null,
      help: '',
      allowServer: false,
      doLog: true,
    }
    const ds = makeDataset({ commands: [pm] })
    const items = computeCompletions({ dataset: ds, text: '/pm ', caret: 4, players: [] })
    expect(items.find((c) => c.label === 'export')?.detail).toBe('导出指定玩家 .plr')
    expect(items.find((c) => c.label === 'look')?.detail).toBe('查看玩家（背包 / 存档）')
  })

  it('「不加参数 = 查看」提示：/fish jar 与 /wm 系列', () => {
    const fish: CommandDef = {
      name: 'fishshop',
      aliases: ['fish', 'fs'],
      permission: null,
      help: '',
      allowServer: true,
      doLog: true,
    }
    const wm: CommandDef = {
      name: 'worldmodify',
      aliases: ['wm'],
      permission: null,
      help: '',
      allowServer: true,
      doLog: true,
    }
    // 下拉框「指令帮助」条：用法串 + 该形态的备注（按语言切换）。
    const fishDs = makeDataset({ commands: [fish] })
    expect(commandHelpLine(fishDs, '/fish jar ', 10, 'zh')?.note).toContain('不加参数 = 查看鱼罐')
    expect(commandHelpLine(fishDs, '/fish jar ', 10, 'en')?.note).toContain('no arg = view jar')

    const wmDs = makeDataset({ commands: [wm] })
    expect(commandHelpLine(wmDs, '/wm name ', 9, 'zh')?.note).toContain('查看世界名')
    expect(commandHelpLine(wmDs, '/wm seed ', 9, 'zh')?.note).toContain('查看种子')
    expect(commandHelpLine(wmDs, '/wm wind ', 9, 'zh')?.note).toContain('查看风速')
  })

  it('/time 与 /clear：枚举取值不允许顺手弹玩家名', () => {
    expect(computeCompletions(at('/time ni')).map((c) => c.insert)).toEqual(['night'])
    expect(computeCompletions(at('/clear item 50')).every((c) => c.kind !== 'player')).toBe(true)
  })

  it('/help：参数是指令名 → 不再弹一级指令列表', () => {
    // 一级指令前面已经敲过了，空格后不再弹一屏命令名；`/help user add` 也是语法错。
    expect(computeCompletions(at('/help '))).toHaveLength(0)
    expect(computeCompletions(at('/help gi'))).toHaveLength(0)
    // 也不能退化成玩家名补全
    expect(computeCompletions(at('/aliases A'))).toHaveLength(0)
  })

  it('/region allow：<name> 按源码实为账号名 → 玩家补全', () => {
    expect(computeCompletions(at('/region allow A')).map((c) => c.insert)).toEqual(['Alice'])
  })

  it('/item 只给自己发物品，没有玩家参数（第 2 位是数量，不给候选）', () => {
    const item = commands.find((c) => c.name === 'item')
    expect(item?.paramSets?.[0]?.args.map((a) => a.name)).toEqual([
      'item name/id',
      'item amount',
      'prefix id/name',
    ])
    expect(computeCompletions(at('/item 29 A'))).toHaveLength(0)
  })

  it('allowServer=false 的指令同样有参数表（前端仍会拦截执行）', () => {
    const tp = commands.find((c) => c.name === 'tp')
    expect(tp?.allowServer).toBe(false)
    expect(tp?.paramSets?.length ?? 0).toBeGreaterThan(0)
    expect(computeCompletions(at('/tp A')).map((c) => c.insert)).toEqual(['Alice'])
  })
})

describe('运行期补全数据（NPC / buff / 区域 / 传送点）', () => {
  const withRuntime = (text: string) => ({
    ...at(text),
    runtimeValues: { regions: ['主城', '商店 街'], warps: ['home', 'shop'] },
  })

  it('/spawnmob 与 /buff：NPC / buff 候选来自本地数据，插数字 ID', () => {
    expect(computeCompletions(at('/spawnmob 蓝'))[0]).toMatchObject({ kind: 'npc', insert: '1' })
    expect(computeCompletions(at('/buff 黑'))[0]).toMatchObject({ kind: 'buff', insert: '1' })
    // /gbuff 第二参是 buff
    expect(computeCompletions(at('/gbuff Alice 再'))[0]).toMatchObject({ kind: 'buff', insert: '2' })
    // /butcher 的 NPC 参数同样来自本地数据
    expect(computeCompletions(at('/butcher 蓝'))[0]).toMatchObject({ kind: 'npc', insert: '1' })
  })

  it('/warp：传送点候选来自运行时数据（含空格自动加引号）', () => {
    expect(computeCompletions(withRuntime('/warp ho')).map((c) => c.insert)).toContain('home')
    // 子命令 send 的 warpname 参数
    expect(computeCompletions(withRuntime('/warp send Alice sh')).map((c) => c.insert)).toContain('shop')
  })

  it('/region：区域名候选来自运行时数据', () => {
    expect(computeCompletions(withRuntime('/region tp 主')).map((c) => c.insert)).toEqual(['主城'])
    // 含空格 → 加双引号（TShock ParseParameters 支持引号）
    expect(computeCompletions(withRuntime('/region tp 商店')).map((c) => c.insert)).toEqual(['"商店 街"'])
  })

  it('没有运行时数据时区域/传送点不给候选（不猜）', () => {
    expect(computeCompletions(at('/warp ho'))).toHaveLength(0)
    expect(computeCompletions(at('/region tp 主')).every((c) => c.kind !== 'region')).toBe(true)
  })
})

describe('权限节点 / 用户组补全（data/permissions.json）', () => {
  // 用真实生成的 permissions.json（从 TShock 源码抽取）
  const permissions = JSON.parse(
    readFileSync(resolve(process.cwd(), '../data/permissions.json'), 'utf8'),
  ) as PermissionsData
  const withPerms = makeDataset({ commands, permissions })

  it('数据本身：节点与内置组都从 TShock 源码抽到了，且每个节点都带说明', () => {
    expect(permissions.meta.permissionCount).toBe(permissions.permissions.length)
    expect(permissions.permissions.length).toBeGreaterThan(150)
    expect(permissions.permissions.every((p) => p.node.startsWith('tshock.') || p.node.includes('.'))).toBe(true)
    expect(permissions.permissions.every((p) => p.desc.length > 0)).toBe(true)
    // 本项目的两条关键 REST 权限必须在
    const nodes = new Set(permissions.permissions.map((p) => p.node))
    expect(nodes.has('tshock.rest.useapi')).toBe(true)
    expect(nodes.has('tshock.rest.command')).toBe(true)
    expect(permissions.groups).toContain('default')
    expect(permissions.groups).toContain('guest')
  })

  it('/group addperm <组> <Tab> 出权限节点候选，插入的是节点原文', () => {
    // 注意：`/group addperm` 的第 2 个参数是**组名**，第 3 个才是权限节点
    const text = '/group addperm default tshock.'
    const items = computeCompletions({ dataset: withPerms, text, caret: text.length, players: [] })
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].kind).toBe('permission')
    expect(items[0].insert.startsWith('tshock.')).toBe(true)
    // 说明来自 TShock 源码的 [Description]
    expect(items[0].detail.length).toBeGreaterThan(0)
  })

  it('/group addperm 按说明搜（例如 rest）也能命中', () => {
    const text = '/group addperm default rest'
    const items = computeCompletions({ dataset: withPerms, text, caret: text.length, players: [] })
    // `rest` 命中一堆 REST 节点（`detail` 里也含 rest），断言集合里有 useapi 即可
    expect(items.some((i) => i.kind === 'permission' && i.insert.startsWith('tshock.rest.'))).toBe(true)
  })

  it('`/group addperm <Tab>` 的第 2 个参数出内置用户组候选', () => {
    // 注意：`/group <Tab>` 本身是**子命令**补全（add / addperm / del…），用户组名出现在子命令之后
    const text = '/group addperm de'
    const items = computeCompletions({ dataset: withPerms, text, caret: text.length, players: [] })
    expect(items.some((i) => i.kind === 'group' && i.insert === 'default')).toBe(true)
  })

  it('/itemban allow <Tab> 与 /region allowg <Tab> 也出用户组候选', () => {
    // `/itemban allow <物品名> <组名>`：组名在**第 3**个参数
    const allowText = '/itemban allow 29 gu'
    const allow = computeCompletions({ dataset: withPerms, text: allowText, caret: allowText.length, players: [] })
    expect(allow.some((i) => i.kind === 'group' && i.insert === 'guest')).toBe(true)

    const region = computeCompletions({
      dataset: withPerms,
      text: '/region allowg vi',
      caret: '/region allowg vi'.length,
      players: [],
    })
    expect(region.some((i) => i.kind === 'group' && i.insert === 'vip')).toBe(true)
  })
})
