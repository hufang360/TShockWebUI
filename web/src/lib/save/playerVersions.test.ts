import { describe, expect, it } from 'vitest'
import { PLAYER_VERSIONS, playerGameVersion, versionOptionsFor } from './playerVersions'

describe('存档版本 → 游戏版本 / 下拉选项', () => {
  it('已知版本能映射到游戏版本', () => {
    expect(playerGameVersion(326)).toBe('1.4.5.8')
    expect(playerGameVersion(226)).toBe('1.4.0.2')
    expect(playerGameVersion(9999)).toBeNull()
  })

  it('下拉只给「同一布局段」的版本', () => {
    const options = versionOptionsFor(326).map((v) => v.release)
    // 段的起点是 324（再往前的 322 是另一个布局段）
    expect(options.every((r) => r >= 324)).toBe(true)
    expect(options).toContain(326)
    // 跨段的不出现
    expect(options).not.toContain(319)
  })

  it('版本表里没有的 release（实测 221）也要出现在选项里，并如实显示数字', () => {
    const options = versionOptionsFor(221)
    const current = options.find((v) => v.release === 221)
    expect(current).toEqual({ release: 221, gameVersion: '221' })
    // 仍然包含同段内已知版本，且按版本号升序
    expect(options.map((v) => v.release)).toEqual([...options.map((v) => v.release)].sort((a, b) => a - b))
    expect(options.some((v) => v.release === 225)).toBe(true)
  })

  it('PLAYER_VERSIONS 自身按 release 升序且无重复', () => {
    const releases = PLAYER_VERSIONS.map((v) => v.release)
    expect(releases).toEqual([...new Set(releases)].sort((a, b) => a - b))
  })
})
