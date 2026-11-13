// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DRILL_MEMORY_TTL_MS, forgetDrill, recallDrill, rememberDrill } from './searchDrill'

const entry = { query: '石头', group: 'items' as const, selected: 'items:200' }

describe('searchDrill', () => {
  it('记住的位置在 60s 内可取回', () => {
    forgetDrill()
    rememberDrill(entry, 1_000)
    expect(recallDrill(1_000 + DRILL_MEMORY_TTL_MS)).toEqual({ ...entry, at: 1_000 })
  })

  it('超过 60s 就忘了（记忆不是持久偏好）', () => {
    rememberDrill(entry, 1_000)
    expect(recallDrill(1_000 + DRILL_MEMORY_TTL_MS + 1)).toBeNull()
  })

  it('forgetDrill 清空：跳页 / 填终端后不该再回到旧位置', () => {
    rememberDrill(entry, 1_000)
    forgetDrill()
    expect(recallDrill(1_000)).toBeNull()
  })
})
