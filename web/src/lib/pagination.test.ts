import { describe, expect, it } from 'vitest'
import {
  PAGE_SIZE,
  clampPage,
  paginate,
  paginationRange,
  shuffleWithSeed,
  totalPages,
} from './pagination'

describe('shuffleWithSeed', () => {
  const items = Array.from({ length: 50 }, (_, i) => i)

  it('同一 seed 得到相同顺序', () => {
    expect(shuffleWithSeed(items, 42)).toEqual(shuffleWithSeed(items, 42))
  })

  it('不修改入参', () => {
    const input = [1, 2, 3, 4, 5]
    const copy = input.slice()
    shuffleWithSeed(input, 7)
    expect(input).toEqual(copy)
  })

  it('保留全部元素（同一多重集合）', () => {
    const out = shuffleWithSeed(items, 12345)
    expect(out).toHaveLength(items.length)
    expect([...out].sort((a, b) => a - b)).toEqual(items)
  })

  it('不同 seed 顺序不同（50 个元素时）', () => {
    expect(shuffleWithSeed(items, 1)).not.toEqual(shuffleWithSeed(items, 2))
  })
})

describe('totalPages / clampPage / paginate', () => {
  it('总页数按每页 100 计算，且至少 1 页', () => {
    expect(PAGE_SIZE).toBe(100)
    expect(totalPages(0)).toBe(1)
    expect(totalPages(1)).toBe(1)
    expect(totalPages(100)).toBe(1)
    expect(totalPages(101)).toBe(2)
    expect(totalPages(6195)).toBe(62)
  })

  it('页码被夹在有效范围内', () => {
    expect(clampPage(0, 62)).toBe(1)
    expect(clampPage(63, 62)).toBe(62)
    expect(clampPage(5, 62)).toBe(5)
    expect(clampPage(Number.NaN, 62)).toBe(1)
  })

  it('paginate 返回对应切片', () => {
    const items = Array.from({ length: 250 }, (_, i) => i)
    expect(paginate(items, 1)).toEqual(items.slice(0, 100))
    expect(paginate(items, 2)).toEqual(items.slice(100, 200))
    expect(paginate(items, 3)).toEqual(items.slice(200, 250))
    expect(paginate(items, 4)).toEqual([])
    expect(paginate(items, 6)).toEqual([])
  })
})

describe('paginationRange', () => {
  it('页数不多时全部列出，不省略', () => {
    expect(paginationRange(1, 1)).toEqual([1])
    expect(paginationRange(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(paginationRange(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('页数多时用省略号收窄窗口，且始终含首尾页', () => {
    expect(paginationRange(1, 124)).toEqual([1, 2, 'ellipsis', 124])
    expect(paginationRange(5, 124)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 124])
    expect(paginationRange(124, 124)).toEqual([1, 'ellipsis', 123, 124])
    expect(paginationRange(62, 124)).toEqual([1, 'ellipsis', 61, 62, 63, 'ellipsis', 124])
  })

  it('非法页码会被夹到有效范围', () => {
    expect(paginationRange(0, 124)).toEqual([1, 2, 'ellipsis', 124])
    expect(paginationRange(999, 124)).toEqual([1, 'ellipsis', 123, 124])
    expect(paginationRange(Number.NaN, 124)).toEqual([1, 2, 'ellipsis', 124])
  })
})
