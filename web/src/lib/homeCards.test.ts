import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CARD_IDS,
  DEFAULT_HOME_CARDS,
  createCustomCard,
  customCardCommand,
  isBuiltinCardId,
  isCustomCardId,
  moveCard,
  normalizeCustomCommand,
  sanitizeHomeCards,
  shiftCard,
  upgradeHomeCardsLayout,
} from './homeCards'

describe('normalizeCustomCommand', () => {
  it('补前导斜杠、取第一条非空行并去空白', () => {
    expect(normalizeCustomCommand('  time 12:00  ')).toBe('/time 12:00')
    expect(normalizeCustomCommand('/who')).toBe('/who')
    expect(normalizeCustomCommand('\n\n/fish 鲈鱼\n/give x')).toBe('/fish 鲈鱼')
    expect(normalizeCustomCommand('   ')).toBe('')
  })
})

describe('sanitizeHomeCards', () => {
  it('空 / 非法输入回退到默认（含全部内置卡片）', () => {
    for (const bad of [null, undefined, 42, 'x', [], { order: 'nope' }]) {
      const prefs = sanitizeHomeCards(bad)
      expect(prefs.order).toEqual([...BUILTIN_CARD_IDS])
      expect(prefs.custom).toEqual([])
      expect(prefs.hidden).toEqual({})
    }
  })

  it('补齐缺失内置卡片、去重、丢弃未知 id', () => {
    const prefs = sanitizeHomeCards({
      order: ['online', 'online', 'ghost', 'time'],
      hidden: { online: true, ghost: true },
      custom: [],
    })
    expect(prefs.order.slice(0, 2)).toEqual(['online', 'time'])
    expect(new Set(prefs.order).size).toBe(prefs.order.length)
    expect(prefs.order).toContain('server')
    expect(prefs.order).not.toContain('ghost')
    expect(prefs.hidden).toEqual({ online: true })
  })

  it('保留自定义卡片并把它们补进顺序', () => {
    const card = createCustomCard('钓鲈鱼', 'fish 鲈鱼')
    const prefs = sanitizeHomeCards({ order: ['time'], custom: [card] })
    expect(prefs.custom).toEqual([{ id: card.id, name: '钓鲈鱼', command: 'fish 鲈鱼' }])
    expect(prefs.order.indexOf(card.id)).toBeGreaterThan(prefs.order.indexOf('time'))
    expect(prefs.order).toContain('server')
  })

  it('原样保留名称/指令中的空格，便于输入框编辑', () => {
    const prefs = sanitizeHomeCards({
      custom: [{ id: 'c:1', name: '全服 公告', command: '/say hello world' }],
    })
    expect(prefs.custom[0]).toEqual({ id: 'c:1', name: '全服 公告', command: '/say hello world' })
  })

  it('丢弃无 id / 重复 id 的自定义卡片', () => {
    const prefs = sanitizeHomeCards({
      custom: [
        { id: '', name: 'a', command: '/a' },
        { id: 'c:1', name: 'b', command: '/b' },
        { id: 'c:1', name: 'c', command: '/c' },
        { id: 'builtin-ish', name: 'd', command: '/d' },
      ],
    })
    expect(prefs.custom).toEqual([{ id: 'c:1', name: 'b', command: '/b' }])
  })
})

describe('id 判定', () => {
  it('区分内置与自定义', () => {
    expect(isBuiltinCardId('online')).toBe(true)
    expect(isBuiltinCardId('c:1')).toBe(false)
    expect(isCustomCardId('c:1')).toBe(true)
    expect(isCustomCardId('online')).toBe(false)
    expect(isCustomCardId('c:')).toBe(false)
  })
})

describe('排序', () => {
  const order = ['a', 'b', 'c', 'd']

  it('moveCard 把源移到目标位置', () => {
    expect(moveCard(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveCard(order, 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveCard(order, 'a', 'a')).toEqual(order)
    expect(moveCard(order, 'x', 'a')).toEqual(order)
  })

  it('shiftCard 上/下移一格且越界不变', () => {
    expect(shiftCard(order, 'b', -1)).toEqual(['b', 'a', 'c', 'd'])
    expect(shiftCard(order, 'b', 1)).toEqual(['a', 'c', 'b', 'd'])
    expect(shiftCard(order, 'a', -1)).toEqual(order)
    expect(shiftCard(order, 'd', 1)).toEqual(order)
  })
})

describe('customCardCommand', () => {
  it('规范化后可执行；空指令返回 null', () => {
    expect(customCardCommand({ id: 'c:1', name: 'x', command: 'who' })).toBe('/who')
    expect(customCardCommand({ id: 'c:1', name: 'x', command: '  ' })).toBeNull()
  })
})

describe('默认配置', () => {
  it('顺序与内置卡片一致', () => {
    expect(DEFAULT_HOME_CARDS.order).toEqual([...BUILTIN_CARD_IDS])
    expect(DEFAULT_HOME_CARDS.hidden).toEqual({})
    expect(DEFAULT_HOME_CARDS.custom).toEqual([])
  })

  it('服务器动态在第 2 位、快捷入口在第 3 位', () => {
    expect(DEFAULT_HOME_CARDS.order[1]).toBe('events')
    expect(DEFAULT_HOME_CARDS.order[2]).toBe('quick')
  })
})

describe('upgradeHomeCardsLayout', () => {
  it('老布局只挪动动态与快捷入口，其余顺序与隐藏态保留', () => {
    const prefs = sanitizeHomeCards({
      order: ['server', 'online', 'events', 'bossinfo', 'world', 'lookbag', 'time', 'bossdamage', 'alldeath', 'recent', 'quick'],
      hidden: { alldeath: true },
    })
    const upgraded = upgradeHomeCardsLayout(prefs)
    expect(upgraded.order.slice(0, 4)).toEqual(['server', 'events', 'quick', 'online'])
    expect(upgraded.hidden).toEqual({ alldeath: true })
    expect(upgraded.order).toHaveLength(BUILTIN_CARD_IDS.length)
  })

  it('自定义卡片保持原有相对顺序', () => {
    const card = createCustomCard('钓鲈鱼', 'fish')
    const prefs = sanitizeHomeCards({ order: [card.id, ...BUILTIN_CARD_IDS], custom: [card] })
    const upgraded = upgradeHomeCardsLayout(prefs)
    expect(upgraded.order[0]).toBe(card.id)
    expect(upgraded.order[1]).toBe('events')
    expect(upgraded.order[2]).toBe('quick')
  })

  it('已是当前版本时原样返回', () => {
    const prefs = sanitizeHomeCards(DEFAULT_HOME_CARDS)
    expect(upgradeHomeCardsLayout(prefs)).toBe(prefs)
  })
})
