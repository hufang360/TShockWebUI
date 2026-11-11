import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSearchIntent,
  consumeSearchIntent,
  requestSearchIntent,
  resetSearchIntent,
  useSearchIntent,
} from './searchIntent'

afterEach(() => resetSearchIntent())

describe('searchIntent 待办', () => {
  it('请求 → 按页面消费一次，之后清空', () => {
    requestSearchIntent('dataid', { kind: 'npc', query: '僵尸' })
    expect(consumeSearchIntent('dataid')).toEqual({ kind: 'npc', query: '僵尸' })
    expect(consumeSearchIntent('dataid')).toBeNull()
  })

  it('页面不匹配时不动待办（其它页仍能拿到）', () => {
    requestSearchIntent('items', { collectionId: 'gems' })
    expect(consumeSearchIntent('dataid')).toBeNull()
    expect(consumeSearchIntent('items')).toEqual({ collectionId: 'gems' })
  })

  it('普通导航作废待办', () => {
    requestSearchIntent('commands', { query: 'tp' })
    clearSearchIntent()
    expect(consumeSearchIntent('commands')).toBeNull()
  })
})

describe('useSearchIntent', () => {
  it('挂载时消费已存在的待办（页面还没挂载就导航过来）', () => {
    requestSearchIntent('players', { query: 'Alice' })
    const apply = vi.fn()
    renderHook(() => useSearchIntent('players', apply))
    expect(apply).toHaveBeenCalledWith({ query: 'Alice' })
  })

  it('页面已挂载时被通知（同一页里再搜一次）', () => {
    const apply = vi.fn()
    renderHook(() => useSearchIntent('players', apply))
    act(() => requestSearchIntent('players', { query: 'Bob' }))
    expect(apply).toHaveBeenCalledWith({ query: 'Bob' })
  })

  it('别的页面的待办不触发', () => {
    const apply = vi.fn()
    renderHook(() => useSearchIntent('dataid', apply))
    act(() => requestSearchIntent('items', { query: '天顶' }))
    expect(apply).not.toHaveBeenCalled()
    // 待办仍在，等 items 页挂载时消费。
    expect(consumeSearchIntent('items')).toEqual({ query: '天顶' })
  })
})
