import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODULES,
  autoActivateModules,
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

describe('autoActivateModules（探测到插件自动激活）', () => {
  const detected = { players: true, store: true, requisition: true }

  it('探测到插件的模块自动开启', () => {
    const next = autoActivateModules(DEFAULT_MODULES, DEFAULT_MODULES, 'default', detected)
    expect(isModuleEnabled(next, 'default', 'players')).toBe(true)
    expect(isModuleEnabled(next, 'default', 'store')).toBe(true)
    expect(isModuleEnabled(next, 'default', 'requisition')).toBe(true)
  })

  it('未探测到插件的模块不激活', () => {
    const next = autoActivateModules(DEFAULT_MODULES, DEFAULT_MODULES, 'default', {
      players: false,
      store: true,
      requisition: false,
    })
    expect(isModuleEnabled(next, 'default', 'players')).toBe(false)
    expect(isModuleEnabled(next, 'default', 'store')).toBe(true)
  })

  it('用户手动关过的模块不再被自动激活', () => {
    const userSet = setModuleEnabled(DEFAULT_MODULES, 'default', 'store', true)
    const next = autoActivateModules(DEFAULT_MODULES, userSet, 'default', detected)
    expect(isModuleEnabled(next, 'default', 'store')).toBe(false)
    expect(isModuleEnabled(next, 'default', 'players')).toBe(true)
  })

  it('已激活的模块保持原样，且按服务器区分', () => {
    const prefs = setModuleEnabled(DEFAULT_MODULES, 'default', 'players', true)
    const next = autoActivateModules(prefs, DEFAULT_MODULES, 'default', detected)
    expect(isModuleEnabled(next, 'default', 'players')).toBe(true)
    // 另一个服务器不应被激活
    expect(isModuleEnabled(next, 'other', 'players')).toBe(false)
  })

  it('无变化时返回原对象（调用方据此跳过无意义写入）', () => {
    const next = autoActivateModules(DEFAULT_MODULES, DEFAULT_MODULES, 'default', {
      players: false,
      store: false,
      requisition: false,
    })
    expect(next).toBe(DEFAULT_MODULES)
  })
})
