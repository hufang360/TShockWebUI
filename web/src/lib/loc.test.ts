import { afterEach, describe, expect, it, vi } from 'vitest'
import { locText } from './loc'
import type { LocalizationBundle } from '@/types'

const loc: LocalizationBundle = {
  ItemName: { Wood: '木材', Zenith: '天顶剑' },
  Prefix: { Legendary: '传奇' },
  Misc: { Macaw: '金刚鹦鹉' },
  LegacyMisc: { 85: '丛林虫子' },
  NPCName: { Turtle: '龟' },
}

describe('locText', () => {
  it('解析 Category.Key', () => {
    expect(locText(loc, 'ItemName.Wood')).toBe('木材')
    expect(locText(loc, 'Misc.Macaw')).toBe('金刚鹦鹉')
    expect(locText(loc, 'NPCName.Turtle')).toBe('龟')
  })

  it('解析 Lang.misc[N] → LegacyMisc.N', () => {
    expect(locText(loc, 'Lang.misc[85]')).toBe('丛林虫子')
  })

  it('缺失/非法 key 返回 undefined', () => {
    expect(locText(loc, undefined)).toBeUndefined()
    expect(locText(loc, 'Nope')).toBeUndefined()
    expect(locText(loc, 'Misc.Nope')).toBeUndefined()
  })
})

describe('englishItemName', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('按 key 取英文名', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ItemName: { Zenith: 'Zenith Sword' } }))),
    )
    const { englishItemName } = await import('./loc')
    await expect(englishItemName('Zenith')).resolves.toBe('Zenith Sword')
  })

  it('加载失败回退到 key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const { englishItemName, loadEnglishLoc } = await import('./loc')
    await expect(loadEnglishLoc()).rejects.toThrow()
    await expect(englishItemName('Zenith')).resolves.toBe('Zenith')
  })
})
