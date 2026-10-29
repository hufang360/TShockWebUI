import { describe, expect, it } from 'vitest'
import {
  applyCompletion,
  computeCompletions,
  paramHintFor,
  type CompletionItem,
} from './completion'
import { makeDataset } from '@/test/fixtures'

const dataset = makeDataset()

describe('computeCompletions', () => {
  it('在第一段给出指令补全', () => {
    const text = '/ti'
    const items = computeCompletions({ dataset, text, caret: text.length, players: [] })
    expect(items[0]?.kind).toBe('command')
    expect(items[0]?.insert).toBe('/time')
  })

  it('allowServer=false 的指令被标记为游戏内', () => {
    const text = '/it'
    const items = computeCompletions({ dataset, text, caret: text.length, players: [] })
    const item = items.find((c) => c.command?.name === 'item')
    expect(item?.inGameOnly).toBe(true)
  })

  it('参数位置不再出现物品补全（改由右侧面板手动插入）', () => {
    const text = '/time 生命'
    const items = computeCompletions({ dataset, text, caret: text.length, players: [] })
    expect(items.some((c) => c.kind === 'item')).toBe(false)
  })

  it('参数位置补全在线玩家名（该参数确实是玩家名）', () => {
    const text = '/give 29 Ali'
    const items = computeCompletions({
      dataset,
      text,
      caret: text.length,
      players: ['Alice', 'Bob'],
    })
    expect(items.some((c) => c.kind === 'player' && c.insert === 'Alice')).toBe(true)
  })

  it('严格取值的参数不弹玩家名（避免误导）', () => {
    const text = '/time Ali'
    const items = computeCompletions({
      dataset,
      text,
      caret: text.length,
      players: ['Alice', 'Bob'],
    })
    expect(items).toHaveLength(0)
  })

  it('没有参数表的指令仍退回玩家名补全', () => {
    const text = '/help Ali'
    const items = computeCompletions({
      dataset,
      text,
      caret: text.length,
      players: ['Alice'],
    })
    expect(items.some((c) => c.insert === 'Alice')).toBe(true)
  })

  it('别名放在说明前面，且不写「别名：」前缀', () => {
    const items = computeCompletions({ dataset, text: '/giv', caret: 4, players: [] })
    const give = items.find((c) => c.id === 'cmd:give')
    // `give` 的别名是 `/g`：说明里直接以 `/g · ` 开头，后面才是帮助文本。
    expect(give?.detail.startsWith('/g · ')).toBe(true)
    expect(give?.detail).not.toContain('别名')
    expect(give?.detail).not.toContain('Aliases')
  })

  it('指令帮助文本按语言取中文/英文', () => {
    const zh = computeCompletions({ dataset, text: '/ti', caret: 3, players: [], lang: 'zh' })
    expect(zh.find((c) => c.id === 'cmd:time')?.detail).toContain('设置世界时间')
    const en = computeCompletions({ dataset, text: '/ti', caret: 3, players: [], lang: 'en' })
    expect(en.find((c) => c.id === 'cmd:time')?.detail).toContain('Changes world time')
  })
})

describe('参数补全（来自 TShock 源码用法串）', () => {
  const players = ['Alice', 'Bob']

  it('物品参数按 ID 插入，并带物品图标信息', () => {
    const text = '/give 生命'
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    const first = items[0]
    expect(first?.kind).toBe('item')
    expect(first?.insert).toBe('29')
    expect(first?.item?.id).toBe(29)
    expect(first?.suffix).toBe(' ')
  })

  it('物品参数在第 2 位时补玩家名，不会串位', () => {
    const text = '/give 29 '
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    expect(items.map((c) => c.insert)).toEqual(['Alice', 'Bob'])
  })

  it('枚举参数给出源码里的可选值', () => {
    const text = '/time '
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    expect(items.map((c) => c.insert)).toEqual(['day', 'night', 'noon', 'midnight'])
  })

  it('枚举值按前缀过滤', () => {
    const text = '/time ni'
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    expect(items.map((c) => c.insert)).toEqual(['night'])
  })

  it('词缀参数插 ID', () => {
    const text = '/give 29 Alice 1 传'
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    expect(items[0]?.kind).toBe('prefix')
    expect(items[0]?.insert).toBe('81')
  })

  it('位置超出申明参数时不再给参数候选', () => {
    const text = '/give 29 Alice 1 # 传奇 1 2 '
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    // 超出参数表 → 退回玩家名（保持原有行为），但不会冒出物品/词缀候选
    expect(items.every((c) => c.kind === 'player')).toBe(true)
  })

  it('子命令字面量参与对齐：/group addperm 的第 3 个参数不误判', () => {
    const text = '/group addperm default '
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    // permissions 是 text（本地没有权限节点数据源）→ 不给候选，也不弹玩家名
    expect(items).toHaveLength(0)
  })

  it('数字参数不给候选（只做提示）', () => {
    const text = '/give 29 Alice '
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    // amount 是 number：本地没有数量数据源，弹玩家名只会误导 → 不给候选
    expect(items).toHaveLength(0)
  })

  it('引号内的参数整体替换，不会截断', () => {
    const text = '/time "ni'
    const items = computeCompletions({ dataset, text, caret: text.length, players })
    expect(items.map((c) => c.insert)).toEqual(['night'])
    // 范围含开头的引号，替换后不会留下孤立的引号
    expect(items[0].range).toEqual({ start: 6, end: 9 })
    const applied = applyCompletion(text, text.length, items[0])
    expect(applied.text).toBe('/time night ')
  })

  it('paramHintFor 给出源码用法串', () => {
    expect(paramHintFor(dataset, '/give 29 ', 9)).toBe('give <item type/id> <player> [item amount] [prefix id/name]')
    expect(paramHintFor(dataset, '/give', 5)).toBeNull()
    expect(paramHintFor(dataset, '/time ', 6)).toBe('time <day|night|noon|midnight|hh:mm>')
  })
})

describe('applyCompletion', () => {
  const cmdHelp: CompletionItem = {
    id: 'cmd:help',
    kind: 'command',
    label: '/help',
    detail: '',
    insert: '/help',
  }
  const itemLife: CompletionItem = {
    id: 'item:29',
    kind: 'item',
    label: '生命水晶',
    detail: '',
    insert: '[i:29]',
  }

  it('已在首 token 上时接受补全不会变成 /help/help', () => {
    const res = applyCompletion('/help', 5, cmdHelp)
    expect(res.text).toBe('/help ')
    expect(res.caret).toBe(6)
  })

  it('前缀补全替换整个 token', () => {
    const res = applyCompletion('/he', 3, cmdHelp)
    expect(res.text).toBe('/help ')
  })

  it('首 token 补全不会产生双空格', () => {
    const res = applyCompletion('/help time', 5, cmdHelp)
    expect(res.text).toBe('/help time')
  })

  it('参数位置整词替换（含光标后内容）', () => {
    const res = applyCompletion('/give abc', 9, itemLife)
    expect(res.text).toBe('/give [i:29]')
    expect(res.caret).toBe('/give [i:29]'.length)
  })
})
