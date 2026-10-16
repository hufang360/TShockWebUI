import { afterEach, describe, expect, it } from 'vitest'
import { clearLoginMemory, loadLoginMemory, saveLoginMemory } from './credentials'

afterEach(() => localStorage.clear())

describe('登录记忆（用户名共用 / 密码按服务器）', () => {
  it('空记忆回填为空串，默认记住', () => {
    expect(loadLoginMemory('default')).toEqual({ username: '', password: '', remember: true })
  })

  it('用户名全局共用，密码按 serverId 分别记忆', () => {
    saveLoginMemory('default', { username: 'HF', password: 'pw-local', remember: true })
    saveLoginMemory('http://1.2.3.4:7878', { username: 'HF', password: 'pw-remote', remember: true })

    // 用户名共用
    expect(loadLoginMemory('default').username).toBe('HF')
    expect(loadLoginMemory('http://1.2.3.4:7878').username).toBe('HF')
    // 密码各自独立
    expect(loadLoginMemory('default').password).toBe('pw-local')
    expect(loadLoginMemory('http://1.2.3.4:7878').password).toBe('pw-remote')
    expect(loadLoginMemory('http://9.9.9.9:7878').password).toBe('')
  })

  it('关闭记住密码时清空全部', () => {
    saveLoginMemory('default', { username: 'HF', password: 'pw', remember: true })
    saveLoginMemory('default', { username: 'HF', password: 'pw', remember: false })
    expect(localStorage.getItem('tswui:login')).toBeNull()
    expect(localStorage.getItem('tswui:passwords')).toBeNull()
  })

  it('clearLoginMemory(serverId) 只清该服务器密码，保留共用用户名与其它服务器', () => {
    saveLoginMemory('default', { username: 'HF', password: 'a', remember: true })
    saveLoginMemory('http://x:1', { username: 'HF', password: 'b', remember: true })

    clearLoginMemory('default')
    expect(loadLoginMemory('default').password).toBe('')
    expect(loadLoginMemory('default').username).toBe('HF')
    expect(loadLoginMemory('http://x:1').password).toBe('b')

    clearLoginMemory()
    expect(localStorage.getItem('tswui:login')).toBeNull()
    expect(localStorage.getItem('tswui:passwords')).toBeNull()
  })

  it('损坏的 JSON 不抛错，回退到空记忆', () => {
    localStorage.setItem('tswui:login', '{not json')
    localStorage.setItem('tswui:passwords', 'nope')
    expect(loadLoginMemory('default')).toEqual({ username: '', password: '', remember: true })
  })

  it('不写入任何 token 字段', () => {
    saveLoginMemory('default', { username: 'HF', password: 's3cret', remember: true })
    const raw = (localStorage.getItem('tswui:login') ?? '') + (localStorage.getItem('tswui:passwords') ?? '')
    expect(raw.toLowerCase()).not.toContain('token')
  })
})
