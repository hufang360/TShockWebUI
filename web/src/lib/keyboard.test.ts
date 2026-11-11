import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMacPlatform, modKeyLabel, shortcutLabel } from './keyboard'

const original = {
  platform: navigator.platform,
  userAgent: navigator.userAgent,
}

function setPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
}

afterEach(() => {
  Object.defineProperty(navigator, 'platform', { value: original.platform, configurable: true })
  Object.defineProperty(navigator, 'userAgent', { value: original.userAgent, configurable: true })
})

describe('keyboard 快捷键文案', () => {
  it('macOS 用 ⌘', () => {
    setPlatform('MacIntel')
    expect(isMacPlatform()).toBe(true)
    expect(shortcutLabel('K')).toBe('⌘K')
  })

  it('Windows / Linux 用 Ctrl', () => {
    setPlatform('Win32')
    expect(modKeyLabel()).toBe('Ctrl')
    expect(shortcutLabel('K')).toBe('Ctrl K')

    setPlatform('Linux x86_64')
    expect(shortcutLabel('K')).toBe('Ctrl K')
  })

  it('platform 为空时退回 userAgent', () => {
    setPlatform('')
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      configurable: true,
    })
    expect(isMacPlatform()).toBe(true)
  })

  it('没有 navigator 时不抛错', () => {
    const spy = vi.spyOn(globalThis, 'navigator', 'get').mockReturnValue(undefined as never)
    expect(isMacPlatform()).toBe(false)
    spy.mockRestore()
  })
})
