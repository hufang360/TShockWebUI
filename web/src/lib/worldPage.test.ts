import { describe, expect, it } from 'vitest'
import {
  cacheWorld,
  cachedWorld,
  clearWorldCache,
  canExportHiRes,
  formatWorldClock,
  formatWorldTime,
  renderWorldHiRes,
  WORLD_CACHE_LIMIT,
  type WorldView,
} from './worldPage'
import type { WorldInfo } from '@/lib/save/worldFile'
import type { WorldSections } from '@/lib/save/worldStats'
import type { WorldThumb } from '@/lib/save/worldThumb'

/** 只填缓存部分用得到的字段（其余用不到）。 */
function view(name: string): WorldView {
  return {
    info: { name } as WorldInfo,
    thumb: { width: 1, height: 1, pixels: new Uint8ClampedArray(4), stats: {} } as unknown as WorldThumb,
    sections: {} as WorldSections,
    parsed: {} as WorldView['parsed'],
  }
}

describe('世界存档的每服缓存（LRU）', () => {
  it('只保留最近 N 个世界，最久没用的被淘汰', () => {
    clearWorldCache()
    for (let i = 0; i < WORLD_CACHE_LIMIT + 2; i++) cacheWorld(`s${i}`, view(`w${i}`))
    expect(cachedWorld('s0')).toBeUndefined() // 最早的被淘汰
    expect(cachedWorld(`s${WORLD_CACHE_LIMIT + 1}`)?.info.name).toBe(`w${WORLD_CACHE_LIMIT + 1}`)
  })

  it('读一次会刷新使用顺序（命中后不会被下一个顶掉）', () => {
    clearWorldCache()
    for (let i = 0; i < WORLD_CACHE_LIMIT; i++) cacheWorld(`s${i}`, view(`w${i}`))
    // 访问最早的 s0 → 变成最近使用
    expect(cachedWorld('s0')?.info.name).toBe('w0')
    cacheWorld('new', view('wnew'))
    expect(cachedWorld('s0')?.info.name).toBe('w0') // 仍在
    expect(cachedWorld('s1')).toBeUndefined() // 被顶掉的是 s1
  })
})

describe('世界时间换算', () => {
  it('tick → HH:MM（一天从 04:30 起算）', () => {
    expect(formatWorldClock(0)).toBe('04:30')
    expect(formatWorldClock(54000 / 2)).toBe('16:30') // 正午 12:00 再走 4.5 小时
    expect(formatWorldClock(27000)).toBe('16:30')
  })
})

describe('世界时间显示：按 Kind 决定要不要换算', () => {
  it('带时区（UTC，最后游玩）→ 换算成浏览器本地时区', () => {
    const iso = '2026-09-17T12:25:42.928Z'
    const at = new Date(iso)
    const p2 = (n: number) => String(n).padStart(2, '0')
    const expected = `${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}`
    expect(formatWorldTime(iso)).toBe(expected)
  })

  it('不带时区（本地墙上时间，创建时间）→ 原样显示，绝不换算', () => {
    expect(formatWorldTime('2026-09-17T09:59:24.953')).toBe('2026-09-17 09:59')
    expect(formatWorldTime('2024-05-06T07:08:09.000')).toBe('2024-05-06 07:08')
  })

  it('空值 / 太短 → 空串', () => {
    expect(formatWorldTime(null)).toBe('')
    expect(formatWorldTime(undefined)).toBe('')
    expect(formatWorldTime('2024-05-06')).toBe('')
  })
})

describe('高清导出：内存守卫', () => {
  it('最大世界（8400×2400）允许；超过上限拒绝', () => {
    expect(canExportHiRes(8400, 2400)).toBe(true) // 20.16M px ≈ 160 MB，桌面可接受
    expect(canExportHiRes(9000, 3000)).toBe(false) // 27M px，超过 24M 上限
  })

  it('renderWorldHiRes 超出上限时抛错而不是分配内存', async () => {
    const { buildWorld } = await import('@/test/worldFile')
    const { parseWorld } = await import('@/lib/save/worldFile')
    const bytes = buildWorld({ width: 10, height: 10, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, {} as never)
    // 伪造一个「超上限」的世界尺寸（只改 info，不真的生成那么大）
    const huge = { ...parsed, info: { ...parsed.info, width: 9000, height: 3000 } }
    await expect(renderWorldHiRes(bytes, huge)).rejects.toThrow(/太大/)
  })
})
