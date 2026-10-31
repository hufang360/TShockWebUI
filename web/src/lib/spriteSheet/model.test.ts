import { describe, expect, it } from 'vitest'
import {
  buildEntries,
  gridKey,
  manualKey,
  parseKey,
  sanitizeFilePart,
  sliceFileNames,
  type ManualSlice,
} from './model'

const size = { width: 64, height: 32 }
const grid = { rows: 1, cols: 2, margin: 0, gap: 0 }

describe('buildEntries', () => {
  it('网格切片在前、手动切片在后；键与默认名稳定', () => {
    const manual: ManualSlice[] = [{ id: 7, rect: { x: 4, y: 4, w: 10, h: 10 } }]
    const entries = buildEntries({ size, grid, overrides: new Map(), manual, names: new Map() })
    expect(entries.map((entry) => entry.key)).toEqual([gridKey(0), gridKey(1), manualKey(7)])
    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2])
    expect(entries.map((entry) => entry.kind)).toEqual(['grid', 'grid', 'manual'])
    expect(entries.map((entry) => entry.defaultName)).toEqual(['r1c1', 'r1c2', 'slice-7'])
    expect(entries[2].rect).toEqual({ x: 4, y: 4, w: 10, h: 10 })
  })

  it('微调与命名只影响对应切片；空白名字回退默认名', () => {
    const entries = buildEntries({
      size,
      grid,
      overrides: new Map([[0, { x: 1, y: 2, w: 8, h: 9 }]]),
      manual: [],
      names: new Map([[gridKey(0), 'head'], [gridKey(1), '   ']]),
    })
    expect(entries[0]).toMatchObject({
      rect: { x: 1, y: 2, w: 8, h: 9 },
      adjusted: true,
      name: 'head',
      displayName: 'head',
    })
    expect(entries[1]).toMatchObject({ adjusted: false, displayName: 'r1c2' })
  })
})

describe('parseKey', () => {
  it('解析网格 / 手动键，非法值返回 null', () => {
    expect(parseKey('g:3')).toEqual({ kind: 'grid', value: 3 })
    expect(parseKey('m:12')).toEqual({ kind: 'manual', value: 12 })
    expect(parseKey('x:1')).toBeNull()
    expect(parseKey('g:')).toBeNull()
  })
})

describe('sanitizeFilePart', () => {
  it('去掉路径分隔符 / 非法字符 / 首尾点，压空白', () => {
    expect(sanitizeFilePart('a/b:c*?.png', 'fallback')).toBe('a-b-c--.png')
    expect(sanitizeFilePart('  two   words  ', 'fallback')).toBe('two words')
    expect(sanitizeFilePart('...hidden', 'fallback')).toBe('hidden')
    expect(sanitizeFilePart('   ', 'fallback')).toBe('fallback')
    expect(sanitizeFilePart('x'.repeat(100), 'fallback')).toHaveLength(64)
  })
})

describe('sliceFileNames', () => {
  it('命名优先，重名（忽略大小写）自动加 -2 / -3', () => {
    const entries = buildEntries({
      size,
      grid,
      overrides: new Map(),
      manual: [{ id: 1, rect: { x: 0, y: 0, w: 8, h: 8 } }],
      names: new Map([
        [gridKey(0), 'Hero'],
        [gridKey(1), 'hero'],
      ]),
    })
    expect(sliceFileNames(entries)).toEqual(['Hero', 'hero-2', 'slice-1'])
  })

  it('空名字用默认名；非法字符被替换', () => {
    const entries = buildEntries({
      size,
      grid,
      overrides: new Map(),
      manual: [],
      names: new Map([[gridKey(0), 'a/b']]),
    })
    expect(sliceFileNames(entries)).toEqual(['a-b', 'r1c2'])
  })
})
