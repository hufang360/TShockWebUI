import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlr, type PlrTrack } from './plr'
import {
  buildPlrEdits,
  draftFromPlayer,
  isDraftDirty,
  PLR_LIMITS,
  validatePlrDraft,
  type PlrEditDraft,
  type PlrItemCatalog,
} from './plrEdit'

const demo = () => new Uint8Array(readFileSync('public/demo/Joy.plr'))
const fixture326 = () => new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))

function parseWithTrack(data: Uint8Array) {
  const track = { boosts: {}, inventory: [] } as unknown as PlrTrack
  const player = parsePlr(data, track)
  return { player, track }
}

/** 假目录：id 1 = 可堆 9999 的可上词缀物品；id 58 = 禁入背包；id 9 = 不可上词缀。 */
const catalog: PlrItemCatalog = {
  // 模拟真实目录：id 1..9999 都存在（真实数据是 1..6195）
  hasItem: (id) => id >= 1 && id <= 9999,
  maxStack: (id) => (id === 9 ? 1 : 9999),
  blocked: (id) => id === 58,
  prefixes: (id) => (id === 1 ? [1, 2, 82] : id === 4956 ? [82, 83] : []),
}
const ctxOf = (original: ReturnType<typeof parseWithTrack>['player']) => ({ catalog, original })

function draftFor(data: Uint8Array): { draft: PlrEditDraft; track: PlrTrack; original: ReturnType<typeof parseWithTrack>['player'] } {
  const { player, track } = parseWithTrack(data)
  return { draft: draftFromPlayer(player, track), track, original: player }
}

const fields = (issues: { field: string }[]) => issues.map((i) => i.field)

describe('.plr 编辑校验', () => {
  it('原样草稿没有任何问题（不碰文件就是合法的）', () => {
    const { draft, original } = draftFor(demo())
    expect(validatePlrDraft(draft, ctxOf(original))).toEqual([])
  })

  it('生命上限 / 当前生命 / 魔力上限的限制与游戏一致', () => {
    const { draft, original } = draftFor(demo())
    const ctx = ctxOf(original)
    const bad = { ...draft, statLifeMax: PLR_LIMITS.lifeMax + 1 }
    expect(fields(validatePlrDraft(bad, ctx))).toContain('statLifeMax')

    const overLife = { ...draft, statLife: PLR_LIMITS.lifeMax, statLifeMax: PLR_LIMITS.lifeMax - 1 }
    expect(validatePlrDraft(overLife, ctx).map((i) => i.messageKey)).toContain(
      'save.edit.err.lifeOverMax',
    )

    const badMana = { ...draft, statManaMax: PLR_LIMITS.manaMax + 1 }
    expect(fields(validatePlrDraft(badMana, ctx))).toContain('statManaMax')

    const overMana = { ...draft, statMana: PLR_LIMITS.manaValueMax + 1 }
    expect(fields(validatePlrDraft(overMana, ctx))).toContain('statMana')

    const float = { ...draft, golferScore: 1.5 }
    expect(validatePlrDraft(float, ctx).map((i) => i.messageKey)).toContain('save.edit.err.int')
  })

  it('背包：数量不能超过游戏堆叠上限、词缀必须是该物品可滚的', () => {
    const { draft, original } = draftFor(demo())
    const ctx = ctxOf(original)
    const slot = (item: { id: number; stack: number; prefix: number }) => ({
      ...draft,
      inventory: { ...draft.inventory, 0: item },
    })
    expect(
      validatePlrDraft(slot({ id: 9, stack: 2, prefix: 0 }), ctx).map((i) => i.messageKey),
    ).toContain('save.edit.err.stackRange')
    expect(
      validatePlrDraft(slot({ id: 9, stack: 1, prefix: 82 }), ctx).map((i) => i.messageKey),
    ).toContain('save.edit.err.badPrefix')
    expect(validatePlrDraft(slot({ id: 4956, stack: 1, prefix: 82 }), ctx)).toEqual([])
    expect(
      validatePlrDraft(slot({ id: 10_000, stack: 1, prefix: 0 }), ctx).map((i) => i.messageKey),
    ).toContain('save.edit.err.badItem')
    expect(
      validatePlrDraft(slot({ id: 0, stack: 3, prefix: 0 }), ctx).map((i) => i.messageKey),
    ).toContain('save.edit.err.emptySlot')
  })

  it('禁入背包的物品直接拒绝（游戏会把它变成空气）', () => {
    const { draft, original } = draftFor(demo())
    const blocked = {
      ...draft,
      inventory: { ...draft.inventory, 0: { id: 58, stack: 1, prefix: 0 } },
    }
    expect(validatePlrDraft(blocked, ctxOf(original)).map((i) => i.messageKey)).toContain(
      'save.edit.err.blockedItem',
    )
  })

  it('版本号只允许在同一布局段内改', () => {
    const { draft, original } = draftFor(demo())
    const ctx = ctxOf(original)
    expect(validatePlrDraft({ ...draft, release: 228 }, ctx)).toEqual([]) // 226 → 1.4.0.4 同段
    expect(validatePlrDraft({ ...draft, release: 230 }, ctx).map((i) => i.messageKey)).toContain(
      'save.edit.err.releaseLayout',
    )
  })

  it('「矿车升级包」只在有该字段的存档上可改', () => {
    const { draft, original, track } = draftFor(fixture326())
    const next = { ...draft, superCart: { unlocked: true, enabled: true } }
    expect(validatePlrDraft(next, ctxOf(original))).toEqual([])
    expect(buildPlrEdits(original, track, next).superCart).toEqual({ unlocked: true, enabled: true })
  })
})

describe('.plr 编辑差异（只输出真正改动的字段）', () => {
  it('没改就不产生补丁；改了才进补丁', () => {
    const { player, track } = parseWithTrack(demo())
    const draft = draftFromPlayer(player, track)
    expect(isDraftDirty(player, track, draft)).toBe(false)
    expect(buildPlrEdits(player, track, draft)).toEqual({})

    const changed = { ...draft, statLife: draft.statLife - 1 }
    expect(isDraftDirty(player, track, changed)).toBe(true)
    const edits = buildPlrEdits(player, track, changed)
    expect(Object.keys(edits)).toEqual(['statLife'])
    expect(edits.statLife).toBe(draft.statLife - 1)
  })

  it('背包只带被改过的槽位', () => {
    const { player, track } = parseWithTrack(demo())
    const draft = draftFromPlayer(player, track)
    const edits = buildPlrEdits(player, track, {
      ...draft,
      inventory: { ...draft.inventory, 3: { id: 1, stack: 10, prefix: 2 } },
    })
    expect(edits.inventory).toEqual({ 3: { id: 1, stack: 10, prefix: 2 } })
  })

  it('老存档没有的永久增强字段不会进补丁', () => {
    const { player, track } = parseWithTrack(demo()) // release 226 没有这些位
    const draft = draftFromPlayer(player, track)
    const edits = buildPlrEdits(player, track, {
      ...draft,
      boosts: { ...draft.boosts, ateArtisanBread: true },
    })
    expect(edits.boosts).toBeUndefined()
  })
})
