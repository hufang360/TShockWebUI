import { describe, expect, it } from 'vitest'

import { dicts } from './i18n'

/** 取出字符串里的占位符，如 `{n}` / `{name}`，用于校验两语言用法一致。 */
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

describe('i18n 语言包一致性', () => {
  const zhKeys = Object.keys(dicts.zh).sort()
  const enKeys = Object.keys(dicts.en).sort()

  it('zh / en 的键集合完全一致', () => {
    const missingInEn = zhKeys.filter((k) => !(k in dicts.en))
    const missingInZh = enKeys.filter((k) => !(k in dicts.zh))
    expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] })
    expect(enKeys).toEqual(zhKeys)
  })

  it('同一键在两语言里的占位符一致', () => {
    const mismatches: Array<{ key: string; zh: string[]; en: string[] }> = []
    for (const key of zhKeys) {
      const zh = placeholders(dicts.zh[key] ?? '')
      const en = placeholders(dicts.en[key] ?? '')
      if (zh.join(',') !== en.join(',')) mismatches.push({ key, zh, en })
    }
    expect(mismatches).toEqual([])
  })
})
