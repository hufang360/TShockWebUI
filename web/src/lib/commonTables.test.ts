// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMON_TABLES, tableText, type SeedTable } from './commonTables'

const seedTable = (id: string) => {
  const table = COMMON_TABLES.find((item) => item.id === id)
  if (table?.kind !== 'seeds') throw new Error(`不是资料表：${id}`)
  return table as SeedTable
}
const seeds = seedTable('worldSeeds')
const sections = seeds.sections
const special = sections.find((section) => section.id === 'special')!
const secretSections = sections.filter((section) => section.id !== 'special')

describe('世界种子表', () => {
  it('特殊种子 9 行在前，秘密种子 7 个分类在后（37 行）', () => {
    expect(sections[0].id).toBe('special')
    expect(special.rows).toHaveLength(9)
    expect(secretSections).toHaveLength(7)
    expect(secretSections.flatMap((section) => section.rows)).toHaveLength(37)
    expect(new Set(secretSections.map((section) => section.id)).size).toBe(7)
  })

  it('内部名称唯一（用作行键）', () => {
    const rows = sections.flatMap((section) => section.rows)
    expect(new Set(rows.map((row) => row.internal)).size).toBe(rows.length)
  })

  it('每行的名称 / 种子 / 描述中英都非空', () => {
    expect(invalidRows(sections.flatMap((section) => section.rows))).toEqual([])
  })

  it('每行都有 WorldModify 的 /wm 关键词', () => {
    const rows = sections.flatMap((section) => section.rows)
    expect(rows.filter((row) => !row.wm || !row.wm.trim())).toEqual([])
    expect(new Set(rows.map((row) => row.wm)).size).toBe(rows.length)
  })

  it('特殊种子用各自的图标，吸血鬼用 NPC 159 的单独裁图', () => {
    for (const row of special.rows) expect(row.icon, row.internal).toBeTruthy()
    const secret = secretRows()
    const vampirism = secret.find((row) => row.internal === 'vampirism')!
    expect(vampirism.icon).toBe('seed-icons/Vampirism.png')
    // 其余秘密种子不单独给图标（走表级统一图标）
    expect(secret.filter((row) => row.icon).map((row) => row.internal)).toEqual(['vampirism'])
    expect(seeds.icon).toBe('seed-icons/WorldSeed.png')
  })

  it('图标文件真实存在', () => {
    const files = new Set(
      [...special.rows.map((row) => row.icon), seeds.icon, 'seed-icons/Vampirism.png'].filter(
        (file): file is string => Boolean(file),
      ),
    )
    for (const file of files) {
      const path = resolve(import.meta.dirname, '../../../data', file)
      expect(readFileSync(path).byteLength, file).toBeGreaterThan(0)
    }
  })
})

describe('词缀表', () => {
  const table = COMMON_TABLES.find((item) => item.id === 'modifiers')
  const rows = table?.kind === 'modifiers' ? table.rows : []

  it('96 条（77 武器 / 工具 + 19 饰品），id 唯一且升序', () => {
    expect(rows).toHaveLength(96)
    const ids = rows.map((row) => row.id)
    expect(new Set(ids).size).toBe(96)
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
    expect(rows.filter((row) => row.benefit)).toHaveLength(19)
  })

  it('每条都有价值与至少一项变化（「级别」有几个在 wiki 上就是 -）', () => {
    const bad = rows.filter(
      (row) =>
        !row.key || !row.value || (Object.keys(row.stats).length === 0 && !row.benefit),
    )
    expect(bad).toEqual([])
  })

  it('传奇（81）是最强的近战词缀：伤害 +15% / 速度 +10% / 暴击 +5%', () => {
    const legendary = rows.find((row) => row.id === 81)
    expect(legendary?.key).toBe('Legendary')
    expect(legendary?.stats).toMatchObject({ dmg: '+15%', speed: '+10%', crit: '+5%' })
  })

  it('wiki 链接按语言取对应站点', () => {
    expect(table && tableText(table.wiki, 'zh')).toContain('/zh/wiki/Modifiers')
    expect(table && tableText(table.wiki, 'en')).toBe('https://terraria.wiki.gg/wiki/Modifiers')
  })
})

function secretRows() {
  return secretSections.flatMap((section) => section.rows)
}

function invalidRows(list: SeedTable['sections'][number]['rows']) {
  return list.filter(
    (row) =>
      !row.internal ||
      row.codes.length === 0 ||
      row.codes.some((code) => !code.trim()) ||
      !row.name.zh.trim() ||
      !row.name.en.trim() ||
      !row.desc.zh.trim() ||
      !row.desc.en.trim(),
  )
}
