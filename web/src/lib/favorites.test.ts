import { describe, expect, it } from 'vitest'
import {
  FAVORITES_LIMIT,
  addFavorite,
  isFavorited,
  normalizeFavorite,
  removeFavorite,
  sanitizeFavorites,
} from './favorites'

describe('normalizeFavorite', () => {
  it('去空白、折叠内部空白、只取首个非空行', () => {
    expect(normalizeFavorite('  /time   12:00  ')).toBe('/time 12:00')
    expect(normalizeFavorite('\n\n/i 29\n/give 2')).toBe('/i 29')
    expect(normalizeFavorite('   ')).toBe('')
  })
})

describe('sanitizeFavorites', () => {
  it('丢弃非法项、去重、按上限截断', () => {
    const cleaned = sanitizeFavorites([
      { cmd: '/time 12:00', ts: 2 },
      { cmd: '/time   12:00', ts: 1 }, // 归一化后重复
      { cmd: 123, ts: 1 },
      null,
      'nope',
      { cmd: '/who' },
    ])
    expect(cleaned.map((f) => f.cmd)).toEqual(['/time 12:00', '/who'])
    expect(cleaned[0].ts).toBe(2)
  })

  it('非数组输入返回空数组', () => {
    expect(sanitizeFavorites(undefined)).toEqual([])
    expect(sanitizeFavorites({ cmd: '/x' })).toEqual([])
  })

  it('超过上限时截断', () => {
    const many = Array.from({ length: FAVORITES_LIMIT + 5 }, (_, i) => ({
      cmd: `/cmd${i}`,
      ts: i,
    }))
    expect(sanitizeFavorites(many)).toHaveLength(FAVORITES_LIMIT)
  })
})

describe('add / remove / isFavorited', () => {
  it('收藏置顶并刷新时间，不产生重复', () => {
    let list = addFavorite([], '/who', 1)
    list = addFavorite(list, '/time 12:00', 2)
    list = addFavorite(list, '/who', 3)
    expect(list.map((f) => f.cmd)).toEqual(['/who', '/time 12:00'])
    expect(list[0].ts).toBe(3)
  })

  it('空指令不写入', () => {
    expect(addFavorite([], '   ')).toEqual([])
  })

  it('删除与查询按归一化键匹配', () => {
    const list = addFavorite([], '/time  12:00')
    expect(isFavorited(list, '/time 12:00')).toBe(true)
    expect(isFavorited(list, '/time 13:00')).toBe(false)
    expect(removeFavorite(list, '/time 12:00')).toEqual([])
  })
})
