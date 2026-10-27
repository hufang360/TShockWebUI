import { describe, expect, it } from 'vitest'
import { dicts } from '@/lib/i18n'
import { emptyPlayerLook } from '@/lib/tshock'
import { playerInfoLines } from './usePlayerShot'

const t = (key: string) => dicts.zh[key] ?? key

describe('导出图片的属性行', () => {
  it('本地存档多出的字段（研究 / Golf / 死亡 / 最后保存 / 版本 / 模式 / 游戏时间）都进图片', () => {
    const lines = playerInfoLines(
      {
        ...emptyPlayerLook('hf'),
        saveVersion: 326,
        gameVersion: '1.4.5.8',
        difficulty: 3,
        playTimeTicks: 13_500_000_000,
        golferScore: 42,
        deathsPve: 2,
        deathsPvp: 1,
        lastSaved: '2026-10-26T12:00:00.000Z',
        researchedCount: 705,
      },
      t,
    )
    expect(lines).toContain('已研究 705 种')
    expect(lines.some((l) => l.startsWith('Golf'))).toBe(true)
    expect(lines.some((l) => l.startsWith('死亡'))).toBe(true)
    expect(lines.some((l) => l.startsWith('版本'))).toBe(true)
    expect(lines.some((l) => l.startsWith('模式'))).toBe(true)
    expect(lines.some((l) => l.startsWith('游戏时间'))).toBe(true)
  })

  it('只有 `/pm/look` 的数据（没有本地字段）时不出现这些行', () => {
    const lines = playerInfoLines(emptyPlayerLook('hf'), t)
    expect(lines.some((l) => l.startsWith('已研究'))).toBe(false)
    expect(lines.some((l) => l.startsWith('版本'))).toBe(false)
    // 基础行始终有
    expect(lines[0]).toMatch(/^生命 /)
    expect(lines[1]).toMatch(/^魔力 /)
  })
})
