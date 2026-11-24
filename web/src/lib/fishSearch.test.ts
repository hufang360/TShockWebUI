// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Dataset } from '@/types'
import type { FishGood } from '@/lib/tshock'
import { matchFishGood } from './fishSearch'

const GOOD: FishGood = {
  serial: 7,
  id: 29,
  name: '回城',
  icon: '[i:29]',
  buyMax: 1,
  needArgs: false,
  map: ['服务', 'Teleport'],
  desc: '把你送回出生点',
  cost: '5 金币',
  unlock: '',
  comment: '',
}

// 只要 itemsById 的几件物品（别的字段搜索用不到）
const dataset = {
  itemsById: new Map([
    [29, { id: 29, key: 'LifeCrystal', name: '生命水晶', icon: 29, frames: 1, sprite: [16, 16], tags: [] }],
  ]),
} as unknown as Dataset

describe('matchFishGood', () => {
  it('名称 / 编号 / 说明都能搜', () => {
    expect(matchFishGood(GOOD, '回城', dataset)).toBe(true)
    expect(matchFishGood(GOOD, '7', dataset)).toBe(true)
    expect(matchFishGood(GOOD, '出生点', dataset)).toBe(true)
  })

  it('别名（插件 map）不区分大小写', () => {
    expect(matchFishGood(GOOD, '服务', dataset)).toBe(true)
    expect(matchFishGood(GOOD, 'teleport', dataset)).toBe(true)
  })

  it('商品名 ≠ 物品名时，物品的显示名与内部名都能命中', () => {
    expect(matchFishGood(GOOD, '生命水晶', dataset)).toBe(true)
    expect(matchFishGood(GOOD, 'lifecrystal', dataset)).toBe(true)
  })

  it('没有物品数据 / id 不是原版物品时只看商品自身字段', () => {
    expect(matchFishGood(GOOD, '生命水晶', null)).toBe(false)
    // 服务类商品（id < 0）的图标是借来的识别图：不按那件物品匹配
    expect(matchFishGood({ ...GOOD, id: -29 }, '生命水晶', dataset)).toBe(false)
  })

  it('空关键词视为全部命中（由调用方决定是否过滤），无关的词不命中', () => {
    expect(matchFishGood(GOOD, '  ', dataset)).toBe(true)
    expect(matchFishGood(GOOD, '不存在的商品', dataset)).toBe(false)
  })
})
