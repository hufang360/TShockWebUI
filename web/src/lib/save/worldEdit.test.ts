import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildWorld } from '@/test/worldFile'
import { parseWorld, type WorldInfo, type WorldTrack } from './worldFile'
import {
  buildWorldEdits,
  draftFromWorld,
  isWorldDraftDirty,
  validateWorldDraft,
  WORLD_NAME_MAX,
} from './worldEdit'
import { applyWorldEdits } from './worldWrite'

const demo = () => new Uint8Array(readFileSync('public/demo/world.wld'))

function tracked(bytes: Uint8Array) {
  const track = { bosses: {} } as unknown as WorldTrack
  const info = parseWorld(bytes, track).info
  return { info, track }
}

describe('.wld 编辑校验', () => {
  it('原样草稿没有问题，也没有差异', () => {
    const { info, track } = tracked(demo())
    const draft = draftFromWorld(info, track)
    expect(validateWorldDraft(draft, { info, track })).toEqual([])
    expect(isWorldDraftDirty(info, track, draft)).toBe(false)
    expect(buildWorldEdits(info, track, draft)).toEqual({})
  })

  it('世界名不能为空、不能超过 20 个字符（按字符算，中文也算 1 个）', () => {
    const { info, track } = tracked(demo())
    const draft = draftFromWorld(info, track)
    expect(validateWorldDraft({ ...draft, name: '   ' }, { info, track })).toEqual([
      expect.objectContaining({ field: 'name', messageKey: 'wld.edit.err.nameEmpty' }),
    ])
    const long = '世'.repeat(WORLD_NAME_MAX + 1)
    expect(validateWorldDraft({ ...draft, name: long }, { info, track })).toEqual([
      expect.objectContaining({ field: 'name', messageKey: 'wld.edit.err.nameTooLong' }),
    ])
    // 恰好 20 个中文字符是允许的（4 字节/字符也不影响字符数判断）
    expect(validateWorldDraft({ ...draft, name: '世'.repeat(WORLD_NAME_MAX) }, { info, track })).toEqual(
      [],
    )
  })

  it('出生点必须在世界范围内，时间 / 月相 / 难度有取值范围', () => {
    const { info, track } = tracked(demo())
    const draft = draftFromWorld(info, track)
    expect(validateWorldDraft({ ...draft, spawnX: info.width }, { info, track })).toEqual([
      expect.objectContaining({ field: 'spawnX' }),
    ])
    expect(validateWorldDraft({ ...draft, spawnY: -1 }, { info, track })).toEqual([
      expect.objectContaining({ field: 'spawnY' }),
    ])
    expect(validateWorldDraft({ ...draft, time: 54000 }, { info, track })).toEqual([
      expect.objectContaining({ field: 'time' }),
    ])
    expect(validateWorldDraft({ ...draft, moonPhase: 9 }, { info, track })).toEqual([
      expect.objectContaining({ field: 'moonPhase' }),
    ])
    expect(validateWorldDraft({ ...draft, gameMode: 4 }, { info, track })).toEqual([
      expect.objectContaining({ field: 'gameMode' }),
    ])
  })

  it('release 179 的种子是整数 → 只读（track 里没有 seed 字符串位置）', () => {
    const bytes = buildWorld({ width: 16, height: 16, tiles: () => ({ typ: -1 }) })
    const { info } = tracked(bytes)
    // 模拟 179：解析器只在「种子是字符串」时记录 track.seed
    const track = { bosses: {} } as unknown as WorldTrack
    const draft = { ...draftFromWorld(info, track), seed: 'x' }
    expect(validateWorldDraft(draft, { info, track })).toEqual([
      expect.objectContaining({ field: 'seed', messageKey: 'wld.edit.err.seedReadOnly' }),
    ])
  })
})

describe('.wld 编辑差异与写回', () => {
  it('只改难度的补丁只包含 gameMode', () => {
    const { info, track } = tracked(demo())
    const draft = draftFromWorld(info, track)
    expect(buildWorldEdits(info, track, { ...draft, gameMode: 2 })).toEqual({ gameMode: 2 })
  })

  it('Boss 位按「与当前是否不同」出补丁', () => {
    const { info, track } = tracked(demo())
    const draft = draftFromWorld(info, track)
    const edits = buildWorldEdits(info, track, {
      ...draft,
      bosses: { ...draft.bosses, moonLord: true, eyeOfCthulhu: true },
    })
    // demo 世界这两项原本都是 false → 两个都进补丁（只补「变化了」的位）
    expect(edits.bosses).toEqual({ moonLord: true, eyeOfCthulhu: true })
  })

  it('写回后能重新解析，且改的是目标值（合成世界，验证段指针与 footer）', () => {
    const bytes = buildWorld({ width: 16, height: 16, tiles: () => ({ typ: -1 }), name: '旧名字' })
    const { info, track } = tracked(bytes)
    const draft = { ...draftFromWorld(info, track), name: '新名字', gameMode: 2 }
    const out = applyWorldEdits(bytes, track, buildWorldEdits(info, track, draft))
    const after = tracked(out)
    expect(after.info.name).toBe('新名字')
    expect(after.info.gameMode).toBe(2)
    expect(after.track.pointers[0]).toBe(track.pointers[0])
    expect(after.track.pointers.at(-1)! - track.pointers.at(-1)!).toBe(
      out.length - bytes.length,
    )
  })
})

/**
 * release < 209 的世界里难度是 **bool**（只有普通 / 专家），写入 2/3 会被静默降级成「专家」。
 * 这里钉死：老存档只允许 0–1，界面也只会给两个选项。
 */
describe('世界难度：老存档只有 bool', () => {
  it('release < 209 时 gameMode 只能是 0 / 1，写 2 直接报范围错', () => {
    const track = { gameModeIsInt: false, bosses: {} } as unknown as WorldTrack
    const info = {
      release: 194,
      spawn: { x: 10, y: 20 },
      dungeon: { x: 30, y: 40 },
      name: '老世界',
      gameMode: 0,
      seed: '',
      width: 100,
      height: 100,
      time: 0,
      dayTime: true,
      moonPhase: 0,
      bloodMoon: false,
      eclipse: false,
      hardmode: false,
      bossesDowned: [] as string[],
    } as unknown as WorldInfo
    const draft = { ...draftFromWorld(info, track), gameMode: 2 }
    const issues = validateWorldDraft(draft, { info, track })
    expect(issues.some((i) => i.field === 'gameMode')).toBe(true)
    // 0 / 1 正常
    expect(validateWorldDraft({ ...draft, gameMode: 1 }, { info, track })).toEqual([])
  })
})

describe('世界名带首尾空格', () => {
  it('不改名字时不算「有未保存改动」，也不会把空格写掉', () => {
    const raw = buildWorld({ width: 20, height: 20, tiles: () => ({ typ: 1 }), name: '留空格 ' })
    const track = {} as WorldTrack
    const parsed = parseWorld(raw, track)
    expect(parsed.info.name).toBe('留空格 ')
    const draft = draftFromWorld(parsed.info, track)
    expect(isWorldDraftDirty(parsed.info, track, draft)).toBe(false)
    expect(buildWorldEdits(parsed.info, track, draft).name).toBeUndefined()
    // 真的改了才写
    expect(buildWorldEdits(parsed.info, track, { ...draft, name: '新名字' }).name).toBe('新名字')
  })
})

describe('超长世界名（别的工具写出来的）', () => {
  const longName = 'A'.repeat(25)
  const bytes = () => buildWorld({ width: 20, height: 20, tiles: () => ({ typ: 1 }), name: longName })

  it('不改名字时，改难度不被无关的名字长度拦下', () => {
    const track = {} as WorldTrack
    const info = parseWorld(bytes(), track).info
    const draft = { ...draftFromWorld(info, track), gameMode: 1 }
    expect(validateWorldDraft(draft, { info, track })).toEqual([])
    // 也不会把名字写回去
    expect(buildWorldEdits(info, track, draft).name).toBeUndefined()
  })

  it('真改名时才要求 1–20 字符', () => {
    const track = {} as WorldTrack
    const info = parseWorld(bytes(), track).info
    const draft = { ...draftFromWorld(info, track), name: 'B'.repeat(21) }
    const issues = validateWorldDraft(draft, { info, track })
    expect(issues.some((i) => i.messageKey === 'wld.edit.err.nameTooLong')).toBe(true)
    expect(validateWorldDraft({ ...draft, name: '' }, { info, track }).some((i) => i.messageKey === 'wld.edit.err.nameEmpty')).toBe(true)
  })
})
