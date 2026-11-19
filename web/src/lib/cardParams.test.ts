// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  argLabel,
  buildCardCommand,
  defaultArgMode,
  hasFillParams,
  hasValueParams,
  quoteParamValue,
  resolveCardTemplate,
  sanitizeCardTemplate,
  searchCardCommands,
  templateFromSet,
  templateSummary,
  type CardTemplate,
} from './cardParams'
import { makeDataset, testCommands } from '@/test/fixtures'
import type { CommandParamSet } from '@/types'

const dataset = makeDataset()

const cmdSet = (name: string, syntaxStart = ''): CommandParamSet => {
  const def = dataset.commands.find((c) => c.name === name)
  const set = def?.paramSets?.find((s) => s.syntax.startsWith(syntaxStart))
  if (!set) throw new Error(`missing paramSet ${name} ${syntaxStart}`)
  return set
}

const giveSet = cmdSet('give')
const groupAddperm = cmdSet('group', 'group addperm')

describe('defaultArgMode', () => {
  it('必填值参数默认执行时填，可选值参数默认不传', () => {
    expect(defaultArgMode({ name: 'item', required: true, kind: 'item' })).toBe('fill')
    expect(defaultArgMode({ name: 'amount', required: false, kind: 'number' })).toBe('omit')
  })

  it('字面子命令默认固定（可选的不传）', () => {
    expect(defaultArgMode({ literal: 'addperm' })).toBe('fixed')
    expect(defaultArgMode({ literal: '-d', required: false })).toBe('omit')
  })
})

describe('templateFromSet', () => {
  it('按参数表生成默认值：字面量填入自身，值参数留空', () => {
    expect(templateFromSet('/Give', giveSet)).toEqual({
      command: 'give',
      syntax: giveSet.syntax,
      args: [
        { mode: 'fill', value: '' },
        { mode: 'fill', value: '' },
        { mode: 'omit', value: '' },
        { mode: 'omit', value: '' },
      ],
    })
  })

  it('只有字面量的用法也算「没有值参数」', () => {
    expect(hasValueParams(giveSet)).toBe(true)
    expect(hasValueParams(groupAddperm)).toBe(true)
  })
})

describe('buildCardCommand', () => {
  it('按顺序拼出指令，跳过的可选参数不产生空占位', () => {
    const template: CardTemplate = templateFromSet('give', giveSet)
    template.args[0] = { mode: 'fill', value: '29' }
    template.args[1] = { mode: 'fill', value: '张三' }
    expect(buildCardCommand(template, giveSet)).toEqual({ command: '/give 29 张三', missing: [] })

    template.args[2] = { mode: 'fixed', value: '10' }
    expect(buildCardCommand(template, giveSet).command).toBe('/give 29 张三 10')
  })

  it('必填参数没值：记进 missing，指令里不出现空占位', () => {
    const template = templateFromSet('give', giveSet)
    template.args[0] = { mode: 'fill', value: '29' }
    const built = buildCardCommand(template, giveSet)
    expect(built.missing).toEqual([1])
    expect(built.command).toBe('/give 29')
  })

  it('必填参数被设成不传也算缺值', () => {
    const template = templateFromSet('give', giveSet)
    template.args[0] = { mode: 'omit', value: '' }
    template.args[1] = { mode: 'fill', value: '张三' }
    expect(buildCardCommand(template, giveSet).missing).toEqual([0])
  })

  it('可选参数填了值就带上，留空等同于不传', () => {
    const template = templateFromSet('give', giveSet)
    template.args[0] = { mode: 'fixed', value: '29' }
    template.args[1] = { mode: 'fixed', value: '张三' }
    template.args[2] = { mode: 'fill', value: '  ' }
    template.args[3] = { mode: 'fixed', value: '4' }
    expect(buildCardCommand(template, giveSet).command).toBe('/give 29 张三 4')
  })

  it('含空格的值加双引号，值里的引号被去掉', () => {
    const template = templateFromSet('give', giveSet)
    template.args[0] = { mode: 'fixed', value: '29' }
    template.args[1] = { mode: 'fixed', value: 'Zhang San' }
    expect(buildCardCommand(template, giveSet).command).toBe('/give 29 "Zhang San"')
    expect(quoteParamValue('a"b')).toBe('ab')
  })

  it('字面子命令按需带上：必填固定、可选默认不带', () => {
    const template = templateFromSet('group', groupAddperm)
    template.args[1] = { mode: 'fixed', value: 'vip' }
    template.args[2] = { mode: 'fill', value: 'tshock.admin *' }
    expect(buildCardCommand(template, groupAddperm).command).toBe(
      '/group addperm vip "tshock.admin *"',
    )
  })

  it('可选字面子命令可以打开', () => {
    const set: CommandParamSet = {
      syntax: 'region info <region> [-d] [page]',
      args: [
        { literal: 'info' },
        { name: 'region', required: true, kind: 'region' },
        { literal: '-d', required: false },
        { name: 'page', required: false, kind: 'number' },
      ],
    }
    const template = templateFromSet('region', set)
    template.args[1] = { mode: 'fixed', value: 'spawn' }
    expect(buildCardCommand(template, set).command).toBe('/region info spawn')
    template.args[2] = { mode: 'fixed', value: '-d' }
    expect(buildCardCommand(template, set).command).toBe('/region info spawn -d')
  })
})

describe('resolveCardTemplate', () => {
  it('指令 / 用法 / 参数个数都对得上才可用', () => {
    const template = templateFromSet('give', giveSet)
    const resolved = resolveCardTemplate(dataset, template)
    expect(resolved?.def.name).toBe('give')
    expect(resolved?.set.syntax).toBe(giveSet.syntax)
  })

  it('指令不存在 → null', () => {
    const template = templateFromSet('give', giveSet)
    expect(resolveCardTemplate(dataset, { ...template, command: 'nope' })).toBeNull()
  })

  it('用法串变了（指令库更新）→ null，不拿旧参数拼指令', () => {
    const template = templateFromSet('give', giveSet)
    expect(resolveCardTemplate(dataset, { ...template, syntax: 'give <player>' })).toBeNull()
  })

  it('参数个数对不上 → null', () => {
    const template = templateFromSet('give', giveSet)
    expect(
      resolveCardTemplate(dataset, { ...template, args: template.args.slice(0, 2) }),
    ).toBeNull()
  })

  it('没有模板 → null', () => {
    expect(resolveCardTemplate(dataset, undefined)).toBeNull()
  })
})

describe('sanitizeCardTemplate', () => {
  it('结构非法一律丢弃', () => {
    for (const bad of [null, 42, 'x', [], {}, { command: 'give' }, { command: 'give', syntax: 's' }]) {
      expect(sanitizeCardTemplate(bad)).toBeUndefined()
    }
    expect(
      sanitizeCardTemplate({ command: 'give', syntax: 's', args: [{ mode: 'nope', value: '' }] }),
    ).toBeUndefined()
    expect(
      sanitizeCardTemplate({ command: 'give', syntax: 's', args: [{ mode: 'fill', value: 1 }] }),
    ).toEqual({ command: 'give', syntax: 's', args: [{ mode: 'fill', value: '' }] })
  })

  it('保留合法值，指令名归一成小写无斜杠', () => {
    expect(
      sanitizeCardTemplate({
        command: '/Give',
        syntax: ' give <item type/id> <player> ',
        args: [{ mode: 'fill', value: '29' }],
      }),
    ).toEqual({
      command: 'give',
      syntax: 'give <item type/id> <player>',
      args: [{ mode: 'fill', value: '29' }],
    })
  })
})

describe('searchCardCommands', () => {
  it('按名称匹配，前缀优先', () => {
    const names = searchCardCommands(dataset, 'gi', 'zh').map((c) => c.name)
    expect(names[0]).toBe('give')
  })

  it('前导斜杠不参与匹配', () => {
    expect(searchCardCommands(dataset, '/time', 'zh')[0]?.name).toBe('time')
  })

  it('别名也能搜到', () => {
    expect(searchCardCommands(dataset, 'g', 'zh').map((c) => c.name)).toContain('give')
  })

  it('中文帮助与枚举取值备注名都能搜到', () => {
    expect(searchCardCommands(dataset, '设置世界时间', 'zh').map((c) => c.name)).toEqual(['time'])
    expect(searchCardCommands(dataset, '白天', 'zh').map((c) => c.name)).toEqual(['time'])
  })

  it('空词返回整库（按名字排序），limit 生效', () => {
    const all = searchCardCommands(dataset, '', 'zh')
    expect(all.length).toBe(dataset.commands.length)
    expect(searchCardCommands(dataset, '', 'zh', 2)).toHaveLength(2)
  })

  it('搜不到返回空', () => {
    expect(searchCardCommands(dataset, 'zzzz', 'zh')).toEqual([])
  })
})

describe('展示辅助', () => {
  it('argLabel / templateSummary', () => {
    expect(argLabel(giveSet.args[0]!, 0, 'zh')).toBe('item type/id')
    expect(argLabel({ literal: 'addperm' }, 0, 'zh')).toBe('addperm')
    expect(templateSummary(giveSet)).toBe('<item type/id> <player> [item amount] [prefix id/name]')
  })

  it('hasFillParams 判断卡片上是否有输入框', () => {
    const template = templateFromSet('give', giveSet)
    expect(hasFillParams(template)).toBe(true)
    template.args = template.args.map((a) => ({ ...a, mode: 'fixed' as const }))
    expect(hasFillParams(template)).toBe(false)
  })

  it('测试数据里的指令都在库里', () => {
    for (const def of testCommands) {
      expect(dataset.commandsByToken.has(def.name)).toBe(true)
    }
  })
})
