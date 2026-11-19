// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  addModuleCard,
  createModuleCard,
  moduleCardsFor,
  removeModuleCard,
  sanitizeModuleCards,
  updateModuleCard,
} from './moduleCards'

const template = {
  command: 'give',
  syntax: 'give <item type/id> <player>',
  args: [
    { mode: 'fill', value: '' },
    { mode: 'fill', value: '' },
  ],
} as const

describe('moduleCards', () => {
  it('默认空态', () => {
    expect(sanitizeModuleCards(null)).toEqual({ byServer: {} })
    expect(sanitizeModuleCards({ byServer: { s1: { world: [] } } })).toEqual({ byServer: {} })
  })

  it('增删改：按服务器 + 模块隔离，删除最后一个卡片时清掉模块键', () => {
    const card = createModuleCard('给物品', 'give', { ...template, args: [...template.args] })
    let prefs = addModuleCard({ byServer: {} }, 's1', 'world', card)
    expect(moduleCardsFor(prefs, 's1', 'world')).toHaveLength(1)
    expect(moduleCardsFor(prefs, 's2', 'world')).toHaveLength(0)

    prefs = updateModuleCard(prefs, 's1', 'world', card.id, { name: '改名' })
    expect(moduleCardsFor(prefs, 's1', 'world')[0]?.name).toBe('改名')

    prefs = removeModuleCard(prefs, 's1', 'world', card.id)
    expect(prefs).toEqual({ byServer: {} })
  })

  it('未知模块 id 的卡片被丢弃，自定义模块（`m:` 前缀）保留', () => {
    const prefs = sanitizeModuleCards({
      byServer: {
        s1: {
          nope: [{ id: 'c:1', name: 'x', command: '/x' }],
          'm:gone': [{ id: 'c:2', name: 'y', command: '/y' }],
        },
      },
    })
    expect(Object.keys(prefs.byServer.s1 ?? {})).toEqual(['m:gone'])
  })

  it('保留参数卡片模板，非法模板退回普通卡片', () => {
    const prefs = sanitizeModuleCards({
      byServer: {
        s1: {
          store: [
            { id: 'c:1', name: '给物品', command: 'give', template },
            { id: 'c:2', name: '坏的', command: '/who', template: { command: 'who', args: [] } },
          ],
        },
      },
    })
    const cards = moduleCardsFor(prefs, 's1', 'store')
    expect(cards[0]?.template).toEqual(template)
    expect(cards[1]?.template).toBeUndefined()
  })
})
