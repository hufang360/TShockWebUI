import { afterEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_ID,
  activeTargetHeader,
  addServerTarget,
  hostPortLabel,
  isValidHost,
  loadServers,
  maskHost,
  maskedTargetLabel,
  parseTargetInput,
  readActiveTargetId,
  resolveTarget,
  sanitizeServers,
  saveServers,
  targetHeader,
  targetLabel,
  writeActiveTargetId,
  type ServerTarget,
} from './servers'

afterEach(() => localStorage.clear())

describe('sanitizeServers', () => {
  it('丢弃非法项并按 id 去重', () => {
    const list = sanitizeServers([
      { scheme: 'http', host: '127.0.0.1', port: 7878 },
      { scheme: 'http', host: '127.0.0.1', port: 7878 },
      { scheme: 'https', host: 'a.b', port: 443 },
      { scheme: 'http', host: '', port: 7878 },
      { scheme: 'http', host: 'x', port: 0 },
      { scheme: 'http', host: 'x', port: 70000 },
      'nope',
      null,
    ])
    expect(list.map((s) => s.id)).toEqual(['http://127.0.0.1:7878', 'https://a.b:443'])
  })
})

describe('parseTargetInput', () => {
  it('host + 空端口用默认 7878', () => {
    const r = parseTargetInput('127.0.0.1', '', 'http')
    expect('target' in r && r.target.id).toBe('http://127.0.0.1:7878')
  })

  it('粘贴 host:port 时拆分，并采用粘贴的端口', () => {
    const r = parseTargetInput('1.2.3.4:9999', '7878', 'https')
    expect('target' in r && r.target).toMatchObject({ host: '1.2.3.4', port: 9999, scheme: 'https' })
  })

  it('去掉 scheme 与路径', () => {
    const r = parseTargetInput('http://host/', '7878', 'http')
    expect('target' in r && r.target.host).toBe('host')
  })

  it('非法输入返回 error', () => {
    expect('error' in parseTargetInput('', '7878', 'http')).toBe(true)
    expect('error' in parseTargetInput('a b', '7878', 'http')).toBe(true)
    expect('error' in parseTargetInput('x', '0', 'http')).toBe(true)
  })
})

describe('当前上游', () => {
  const custom: ServerTarget = {
    id: 'http://1.2.3.4:7878',
    scheme: 'http',
    host: '1.2.3.4',
    port: 7878,
  }

  it('内置默认不发送 header', () => {
    expect(targetHeader(resolveTarget([], BUILTIN_ID))).toBeUndefined()
    expect(activeTargetHeader()).toBeUndefined()
  })

  it('选中自定义条目时返回完整 URL', () => {
    saveServers([custom])
    writeActiveTargetId(custom.id)
    expect(activeTargetHeader()).toBe('http://1.2.3.4:7878')
    expect(loadServers()).toHaveLength(1)
    expect(readActiveTargetId()).toBe(custom.id)
  })

  it('id 失效时回退到默认', () => {
    writeActiveTargetId('http://9.9.9.9:1')
    expect(activeTargetHeader()).toBeUndefined()
  })

  it('addServerTarget 置顶去重', () => {
    const a: ServerTarget = { id: 'http://a:1', scheme: 'http', host: 'a', port: 1 }
    const b: ServerTarget = { id: 'http://b:2', scheme: 'http', host: 'b', port: 2 }
    expect(addServerTarget(addServerTarget([], a), b).map((s) => s.id)).toEqual([b.id, a.id])
    expect(addServerTarget([a], a)).toHaveLength(1)
  })
})

describe('isValidHost', () => {
  it('接受 IP / 域名 / IPv6，拒绝空白', () => {
    expect(isValidHost('127.0.0.1')).toBe(true)
    expect(isValidHost('tc.example.com')).toBe(true)
    expect(isValidHost('[::1]')).toBe(true)
    expect(isValidHost('a b')).toBe(false)
    expect(isValidHost('')).toBe(false)
  })
})

describe('maskHost（隐私遮挡）', () => {
  it('IPv4 保留前两段', () => {
    expect(maskHost('203.0.113.7')).toBe('203.0.*.*')
  })
  it('IPv6 只保留第一组', () => {
    expect(maskHost('2001:db8::1')).toBe('2001:****')
    expect(maskHost('[2001:db8::1]')).toBe('2001:****')
  })
  it('域名保留前两字符与顶级域', () => {
    expect(maskHost('api.example.com')).toBe('ap***.com')
    expect(maskHost('example.com')).toBe('ex***.com')
  })
  it('maskedTargetLabel 对默认项返回空串', () => {
    expect(maskedTargetLabel({ id: BUILTIN_ID, scheme: 'http', host: '', port: 7878 })).toBe('')
    expect(
      maskedTargetLabel({ id: 'http://1.2.3.4:7878', scheme: 'http', host: '1.2.3.4', port: 7878 }),
    ).toBe('1.2.*.*:7878')
  })
})

describe('hostPortLabel（IPv6 加方括号）', () => {
  it('IPv4 / 域名正常拼接', () => {
    expect(hostPortLabel('1.2.3.4', 7878)).toBe('1.2.3.4:7878')
    expect(hostPortLabel('api.example.com', 7878)).toBe('api.example.com:7878')
  })
  it('IPv6 加方括号，已有方括号不重复', () => {
    expect(hostPortLabel('2001:db8::1', 7878)).toBe('[2001:db8::1]:7878')
    expect(hostPortLabel('[2001:db8::1]', 7878)).toBe('[2001:db8::1]:7878')
  })
  it('targetLabel / maskedTargetLabel 对 IPv6 同样加方括号', () => {
    const t: ServerTarget = { id: 'http://2001:db8::1:7878', scheme: 'http', host: '2001:db8::1', port: 7878 }
    expect(targetLabel(t)).toBe('[2001:db8::1]:7878')
    expect(maskedTargetLabel(t)).toBe('[2001:****]:7878')
  })
})
