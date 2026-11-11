// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

  it('每个键的值都是字符串（防止误写出一元 + 把文案变成 NaN）', () => {
    // 真实踩过：`'x.help':` 下面那行写成 `+ '...'`，一元加号把字符串算成 NaN，
    // 界面上直接显示成「NaN权限由 TShock 判定…」。
    const bad: Array<{ lang: string; key: string; type: string; head: string }> = []
    for (const lang of ['zh', 'en'] as const) {
      for (const [key, value] of Object.entries(dicts[lang])) {
        if (typeof value !== 'string' || value.startsWith('NaN')) {
          bad.push({ lang, key, type: typeof value, head: String(value).slice(0, 12) })
        }
      }
    }
    expect(bad).toEqual([])
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

/**
 * 源码里用到的静态键必须都在语言包里 —— 少一个就会把 `save.edit.cancel` 这种**原始 key**
 * 直接渲染给用户（真实出现过两处：`wld.mode`、`save.edit.cancel`）。
 *
 * 只查静态字面量（`t('a.b')` 与校验结果的 `messageKey: 'a.b'`）；模板拼接的动态键
 * （如 `t(`wld.boss.${key}`)`）不在此列，由各功能自己的测试兜底。
 */
describe('i18n 使用面覆盖', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        if (!entry.name.includes('.test.')) files.push(path)
      }
    }
  }
  walk(resolve('src'))

  const used = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) used.add(m[1])
    for (const m of source.matchAll(/messageKey:\s*'([A-Za-z0-9_.]+)'/g)) used.add(m[1])
  }

  it('没有「用了但没定义」的键', () => {
    const missing = [...used].filter((key) => !(key in dicts.zh)).sort()
    expect(missing).toEqual([])
  })
})
