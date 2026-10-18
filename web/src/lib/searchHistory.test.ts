import { describe, expect, it } from 'vitest'
import {
  SEARCH_HISTORY_MAX,
  SEARCH_HISTORY_NARROW_MAX,
  addSearchHistory,
  sanitizeSearchHistory,
} from './searchHistory'

describe('searchHistory', () => {
  it('最多保留 10 条，去重，最新在前', () => {
    let list: string[] = []
    for (let i = 1; i <= 15; i++) list = addSearchHistory(list, `q${i}`)
    expect(list).toHaveLength(SEARCH_HISTORY_MAX)
    expect(list[0]).toBe('q15')
    // 再搜已有的词 → 提到最前、不重复
    list = addSearchHistory(list, 'q10')
    expect(list[0]).toBe('q10')
    expect(list.filter((x) => x === 'q10')).toHaveLength(1)
  })

  it('忽略大小写去重、去空白', () => {
    let list = addSearchHistory([], 'Zenith')
    list = addSearchHistory(list, 'zenith')
    expect(list).toEqual(['zenith'])
    expect(addSearchHistory(list, '   ')).toEqual(['zenith'])
  })

  it('sanitize：丢弃非法项、去重、截断', () => {
    expect(sanitizeSearchHistory(null)).toEqual([])
    expect(sanitizeSearchHistory(['a', '', 1, 'A', ' b '])).toEqual(['a', 'b'])
    const long = Array.from({ length: 20 }, (_, i) => `x${i}`)
    expect(sanitizeSearchHistory(long)).toHaveLength(SEARCH_HISTORY_MAX)
  })

  it('窄区域阈值常量', () => {
    expect(SEARCH_HISTORY_NARROW_MAX).toBe(5)
    expect(SEARCH_HISTORY_NARROW_MAX).toBeLessThan(SEARCH_HISTORY_MAX)
  })
})
