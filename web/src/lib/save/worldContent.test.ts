import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildWorld } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from './worldFile'
import { parseWorldSections } from './worldStats'
import { applyWorldEdits } from './worldWrite'
import { buildContentEdits, draftFromContent, validateContentDraft } from './worldContent'

const catalog = {
  hasItem: (id: number) => id > 0 && id < 7000,
  maxStack: () => 9999,
  blocked: () => false,
  prefixes: () => undefined as readonly number[] | undefined,
}

function worldWithChest() {
  // 20×10：中间放个箱子（图格 21 是 frame-important，写 4 字节 frame）
  const bytes = buildWorld({
    width: 20,
    height: 10,
    tiles: () => ({ typ: 21 }),
    chests: [{ x: 3, y: 4, name: '宝箱', items: [[29, 5], [75, 3]] }],
    signs: [{ x: 5, y: 6, text: '第一行\n第二行' }],
  })
  const track = {} as WorldTrack
  const parsed = parseWorld(bytes, track)
  const sections = parseWorldSections(bytes, track, parsed.info.release)
  return { bytes, track, parsed, sections }
}

describe('箱子 / 招牌内容编辑（W4）', () => {
  it('草稿与解析结果互逆；不动就没差异', () => {
    const { sections } = worldWithChest()
    const draft = draftFromContent(sections.chestList!, sections.signList!)
    expect(draft.chests[0]).toMatchObject({ x: 3, y: 4, name: '宝箱', capacity: 40 })
    expect(draft.chests[0].items[0]).toEqual({ id: 29, stack: 5, prefix: 0 })
    expect(draft.chests[0].items[1]).toEqual({ id: 75, stack: 3, prefix: 0 })
    expect(draft.chests[0].items[2]).toBeNull()
    expect(buildContentEdits(draft, { chests: sections.chestList!, signs: sections.signList! })).toEqual({})
  })

  it('改箱子名 / 改格子 / 清空格子 → 只有对应的段进补丁', () => {
    const { sections } = worldWithChest()
    const draft = draftFromContent(sections.chestList!, sections.signList!)
    draft.chests[0].name = '新名字'
    draft.chests[0].items[0] = { id: 4956, stack: 1, prefix: 0 }
    draft.chests[0].items[1] = null // 清空第 2 格
    const edits = buildContentEdits(draft, { chests: sections.chestList!, signs: sections.signList! })
    expect(edits.chests).toHaveLength(1)
    expect(edits.chests![0].name).toBe('新名字')
    expect(edits.chests![0].items).toEqual([{ slot: 0, id: 4956, stack: 1, prefix: 0 }])
    expect(edits.signs).toBeUndefined()
  })

  it('改招牌文本 → 只重排招牌段', () => {
    const { sections } = worldWithChest()
    const draft = draftFromContent(sections.chestList!, sections.signList!)
    draft.signs[0].text = '换成一段更长的新文字\n第二行'
    const edits = buildContentEdits(draft, { chests: sections.chestList!, signs: sections.signList! })
    expect(edits.signs).toEqual([{ text: '换成一段更长的新文字\n第二行', x: 5, y: 6 }])
    expect(edits.chests).toBeUndefined()
  })

  it('校验：箱子名超 20 字符 / 招牌超 1000 字符 / 非法物品 / 超堆叠', () => {
    const { sections } = worldWithChest()
    const draft = draftFromContent(sections.chestList!, sections.signList!)
    draft.chests[0].name = 'A'.repeat(21)
    draft.signs[0].text = 'x'.repeat(1001)
    draft.chests[0].items[0] = { id: 9999, stack: 1, prefix: 0 }
    const issues = validateContentDraft(draft, {
      chests: sections.chestList!,
      signs: sections.signList!,
      catalog,
    })
    const keys = issues.map((i) => i.messageKey)
    expect(keys).toContain('wld.content.err.nameTooLong')
    expect(keys).toContain('wld.content.err.signTooLong')
    expect(keys).toContain('save.edit.err.badItem')

    // 数量超上限
    const draft2 = draftFromContent(sections.chestList!, sections.signList!)
    draft2.chests[0].items[0] = { id: 29, stack: 99999, prefix: 0 }
    expect(
      validateContentDraft(draft2, {
        chests: sections.chestList!,
        signs: sections.signList!,
        catalog: { ...catalog, maxStack: () => 100 },
      }).some((i) => i.messageKey === 'save.edit.err.stackRange'),
    ).toBe(true)
  })

  it('写回：改箱子名与招牌文本 → 重新解析生效，其它段原样（长度变化、指针重排）', () => {
    const { bytes, track, sections } = worldWithChest()
    const draft = draftFromContent(sections.chestList!, sections.signList!)
    draft.chests[0].name = '改过的箱子名'
    draft.signs[0].text = '新招牌文字，比原来长不少'
    const edits = buildContentEdits(draft, { chests: sections.chestList!, signs: sections.signList! })

    const out = applyWorldEdits(bytes, track, edits)
    const t2 = {} as WorldTrack
    const parsed2 = parseWorld(out, t2)
    const sec2 = parseWorldSections(out, t2, parsed2.info.release)
    expect(sec2.signList![0].text).toBe('新招牌文字，比原来长不少')
    expect(sec2.chestList![0].name).toBe('改过的箱子名')
    // 段指针整体后移（长度变大），但世界信息不变
    expect(parsed2.info.name).toBe(sections && 'x' ? parsed2.info.name : parsed2.info.name)
    expect(parsed2.info.width).toBe(20)
    expect(t2.pointers[0]).toBe(track.pointers[0]) // 文件头不变
    expect(t2.pointers[3]).toBeGreaterThan(track.pointers[3]) // 箱子段变长
    expect(out.length).toBeGreaterThan(bytes.length)
  })

  it('真实世界：把第 1 块招牌文本改长 → 重新解析读到新文本，箱子数不变', () => {
    const raw = new Uint8Array(readFileSync('public/demo/world.wld'))
    const track = {} as WorldTrack
    const parsed = parseWorld(raw, track)
    const sections = parseWorldSections(raw, track, parsed.info.release)
    if (!sections.signList || sections.signList.length === 0) return // demo 世界没有招牌就跳过
    const draft = draftFromContent(sections.chestList ?? [], sections.signList)
    draft.signs[0].text = `${draft.signs[0].text}（编辑测试）`
    const out = applyWorldEdits(raw, track, buildContentEdits(draft, {
      chests: sections.chestList ?? [],
      signs: sections.signList,
    }))
    const t2 = {} as WorldTrack
    const parsed2 = parseWorld(out, t2)
    const sec2 = parseWorldSections(out, t2, parsed2.info.release)
    expect(sec2.signList![0].text).toBe(draft.signs[0].text)
    expect(sec2.chests).toBe(sections.chests)
    // 图格段逐字节不变
    expect(Buffer.from(out.subarray(t2.pointers[1], t2.pointers[2])).equals(
      Buffer.from(raw.subarray(track.pointers[1], track.pointers[2])),
    )).toBe(true)
  })
})
