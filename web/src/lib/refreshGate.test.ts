import { beforeEach, describe, expect, it } from 'vitest'
import {
  REFRESH_GATE_MS,
  isRefreshDue,
  lastRefreshedAt,
  markRefreshed,
  refreshScope,
  resetRefreshGate,
} from './refreshGate'

beforeEach(() => {
  resetRefreshGate()
})

describe('refreshGate', () => {
  it('从未刷新过 → 到期', () => {
    expect(isRefreshDue('default:home')).toBe(true)
    expect(lastRefreshedAt('default:home')).toBeNull()
  })

  it('刷新后间隔内不再到期，超过后再次到期', () => {
    const now = 1_000_000
    expect(markRefreshed('default:home', now)).toBe(now)
    expect(isRefreshDue('default:home', REFRESH_GATE_MS, now + REFRESH_GATE_MS - 1)).toBe(false)
    expect(isRefreshDue('default:home', REFRESH_GATE_MS, now + REFRESH_GATE_MS)).toBe(true)
    expect(lastRefreshedAt('default:home')).toBe(now)
  })

  it('间隔为 0（不自动刷新）：首次仍加载一次，之后不再自动刷新', () => {
    expect(isRefreshDue('default:home', 0)).toBe(true)
    markRefreshed('default:home')
    expect(isRefreshDue('default:home', 0)).toBe(false)
  })

  it('作用域按「服务器:模块」隔离', () => {
    markRefreshed(refreshScope('default', 'home'))
    expect(isRefreshDue(refreshScope('default', 'fish'))).toBe(true)
    expect(isRefreshDue(refreshScope('http://1.2.3.4:7878', 'home'))).toBe(true)
    expect(isRefreshDue(refreshScope('default', 'home'))).toBe(false)
  })
})
