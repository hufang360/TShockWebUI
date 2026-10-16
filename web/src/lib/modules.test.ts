import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODULES,
  isModuleEnabled,
  sanitizeModules,
  setModuleEnabled,
} from './modules'

describe('modules（按服务器分开记忆）', () => {
  it('默认不激活任何模块', () => {
    expect(isModuleEnabled(DEFAULT_MODULES, 'default', 'players')).toBe(false)
    expect(isModuleEnabled(DEFAULT_MODULES, 'default', 'store')).toBe(false)
  })

  it('可打开 / 关闭模块', () => {
    const on = setModuleEnabled(DEFAULT_MODULES, 'default', 'store', true)
    expect(isModuleEnabled(on, 'default', 'store')).toBe(true)
    const off = setModuleEnabled(on, 'default', 'store', false)
    expect(isModuleEnabled(off, 'default', 'store')).toBe(false)
  })

  it('不同服务器的激活互不影响', () => {
    const prefs = setModuleEnabled(DEFAULT_MODULES, 'online', 'players', true)
    expect(isModuleEnabled(prefs, 'online', 'players')).toBe(true)
    // 本地（另一个服务器 id）不应看到线上激活的模块
    expect(isModuleEnabled(prefs, 'local', 'players')).toBe(false)

    const both = setModuleEnabled(prefs, 'local', 'store', true)
    expect(isModuleEnabled(both, 'local', 'store')).toBe(true)
    expect(isModuleEnabled(both, 'online', 'store')).toBe(false)
  })

  it('sanitize 丢弃非法模块 id 与非数组值', () => {
    const prefs = sanitizeModules({
      byServer: {
        default: ['players', 'bogus', 'players'],
        other: 'nope',
        empty: [],
      },
    })
    expect(prefs.byServer.default).toEqual(['players'])
    expect(prefs.byServer.other).toBeUndefined()
    expect(prefs.byServer.empty).toBeUndefined()
  })

  it('sanitize 容错坏数据（含旧的全局结构）', () => {
    expect(sanitizeModules(null).byServer).toEqual({})
    expect(sanitizeModules('nope').byServer).toEqual({})
    // 旧结构 { enabled: {...} } 不再使用 → 视为空
    expect(sanitizeModules({ enabled: { players: true } }).byServer).toEqual({})
  })
})
