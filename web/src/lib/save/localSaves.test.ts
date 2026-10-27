/**
 * 用**本机真实存档**做的端到端核对（默认跳过，不进 CI）。
 *
 * 为什么单独放一个文件：仓库里不放真实世界文件（12 MB × N），CI 也没有游戏客户端。
 * 但「解析 / 统计 / 查找 / 写回」的正确性只有拿真实文件跑一遍才敢说验过，
 * 所以留这个可重跑的入口：指向任意真实存档目录即可。
 *
 * 用法（多个目录用 `:` 分隔）：
 * ```bash
 * TSWUI_REAL_WORLDS=~/Terraria/Worlds TSWUI_REAL_PLAYERS=~/Terraria/Players \
 *   npx vitest run src/lib/save/localSaves.test.ts
 * ```
 *
 * 覆盖的不变量：
 * - 世界：`空气 + 图格 = 总格数`、分层合计 = 总格数、`findMatches` 的计数与缩略图统计一致、
 *   箱子/招牌/NPC 明细条数与计数一致且内容不是乱码、**把所有定长字段写成现有值后逐字节不变**
 *   （证明偏移表就是那些字段）、改名后指针平移 / 中间段逐字节不变 / footer 同步、空编辑逐字节不变。
 * - 角色：空编辑逐字节不变、改生命只有该 int32 的字节变化、**把背包 58 格 / 永久增强 / 矿车包
 *   写成现有值后逐字节不变**（证明背包偏移表与增强位都正确）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decryptPlr, isSameReleaseLayout, parsePlr, plrSlots, type PlrTrack } from './plr'
import { PLAYER_VERSIONS } from './playerVersions'
import { applyPlrEdits, changedPlainOffsets } from './plrWrite'
import { parseWorld, type WorldTrack } from './worldFile'
import { SaveFormatError } from './bytes'
import { parseWorldSections } from './worldStats'
import { buildAnalysisText } from './worldAnalysisText'
import { buildContentEdits, draftFromContent } from './worldContent'
import { tileAt } from './worldTileAt'
import { checkTileReplace, replaceTileType } from './worldTileReplace'
import { renderWorldThumbnail } from './worldThumb'
import { findMatches } from './worldFind'
import { applyWorldEdits } from './worldWrite'
import { draftFromWorld, isWorldDraftDirty } from './worldEdit'
import { draftFromPlayer, isDraftDirty, validatePlrDraft } from './plrEdit'

/** 全部物品的内部键名（研究进度里的 persistentId 就是它）。 */
const itemKeys = new Set(
  (JSON.parse(readFileSync(resolve('..', 'data', 'items.json'), 'utf8')) as { items: { key: string }[] }).items.map(
    (it) => it.key,
  ),
)

const dirsOf = (env: string | undefined): string[] =>
  (env ?? '')
    .split(':')
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0)

const WORLD_DIRS = dirsOf(process.env.TSWUI_REAL_WORLDS)
const PLAYER_DIRS = dirsOf(process.env.TSWUI_REAL_PLAYERS)

function listFiles(dirs: string[], ext: string): string[] {
  const out: string[] = []
  for (const dir of dirs) {
    try {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(ext)) continue
        const path = join(dir, name)
        try {
          if (statSync(path).isFile()) out.push(path)
        } catch {
          /* 读不了的文件（权限 / 已被清理）跳过 */
        }
      }
    } catch {
      /* 目录不存在就跳过 */
    }
  }
  return out
}

const worlds = listFiles(WORLD_DIRS, '.wld')
const players = listFiles(PLAYER_DIRS, '.plr')

/** 控制字符 = 读偏了的典型症状（真名不会是乱码）。 */
const hasControlChars = (s: string) => {
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
  }
  return false
}

describe.skipIf(worlds.length === 0)('真实世界文件', () => {
  for (const path of worlds) {
    it(`统计 / 查找 / 改名 自洽：${path.split('/').pop()}`, async () => {
      const raw = new Uint8Array(readFileSync(path))
      const track = {} as WorldTrack
      let parsed: ReturnType<typeof parseWorld>
      try {
        parsed = parseWorld(raw, track)
      } catch (e) {
        // 不支持的存档（手机版 xindong 魔数 / release < 140 / 损坏）可以拒，但必须是**可读的中文原因**，
        // 不能是 TypeError 之类内部错误；也不能把错拒的 1.4 世界算进来。
        expect(e).toBeInstanceOf(SaveFormatError)
        expect((e as Error).message).toMatch(/世界存档|版本过旧/)
        return
      }
      const { width: w, height: h } = parsed.info

      // 缩略图统计：总和必须闭合
      const thumb = await renderWorldThumbnail(raw, parsed, { maxPixels: 40_000, yieldEvery: 100_000 })
      const stats = thumb.stats
      const tileTotal = [...stats.tiles.values()].reduce((a, b) => a + b, 0)
      expect(stats.total).toBe(w * h)
      expect(stats.air + tileTotal).toBe(w * h)
      expect(stats.zones.reduce((n, z) => n + z.total, 0)).toBe(w * h)
      for (const zone of stats.zones) {
        const zoned = [...zone.tiles.values()].reduce((a, b) => a + b, 0)
        expect(zone.air + zoned).toBe(zone.total)
      }

      // 「查找图格」独立跑一趟，计数必须与统计一致（两条解码路径互证）
      const top = [...stats.tiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
      if (top.length > 0) {
        const found = await findMatches(
          raw,
          parsed,
          top.map(([id]) => ({ kind: 'tile' as const, id })),
          { limit: 10 },
        )
        for (const [id, n] of top) expect(found.counts.get(`tile:${id}`)).toBe(n)
        expect(found.truncated).toBe(true)
        for (const hit of found.hits) {
          expect(hit.x).toBeGreaterThanOrEqual(0)
          expect(hit.x).toBeLessThan(w)
          expect(hit.y).toBeGreaterThanOrEqual(0)
          expect(hit.y).toBeLessThan(h)
        }
      }

      // 各段统计：条数与计数一致，内容不能是乱码
      const sections = parseWorldSections(raw, track, parsed.info.release)
      if (sections.chestList) {
        expect(sections.chestList.length).toBe(sections.chests)
        for (const chest of sections.chestList) {
          expect(chest.x).toBeGreaterThanOrEqual(0)
          expect(chest.x).toBeLessThan(w)
          expect(chest.y).toBeGreaterThanOrEqual(0)
          expect(chest.y).toBeLessThan(h)
          for (const item of chest.items) {
            expect(item.id).toBeGreaterThan(0)
            expect(item.stack).toBeGreaterThan(0)
            expect(item.prefix).toBeLessThan(256)
            expect(item.slot).toBeGreaterThanOrEqual(0)
          }
        }
      }
      if (sections.signList) expect(sections.signList.length).toBe(sections.signs)
      if (sections.npcList) {
        expect(sections.npcList.length).toBeLessThanOrEqual(sections.npcs!)
        for (const npc of sections.npcList) {
          // 老人（netId 37）这类 NPC 的 GivenName 本来就是空；更老的存档没有 netId（记 0）
          expect(hasControlChars(npc.name)).toBe(false)
          if (parsed.info.release >= 190) expect(npc.netId).toBeGreaterThan(0)
        }
      }
      if (sections.tileEntities != null) expect(sections.tileEntities).toBeLessThan(100_000)

      // 跨段互证：箱子 / 招牌的坐标（来自第 3/4 段）必须落在对应的图格上
      // （图格流是另一套解码，路数不同，能当独立 oracle；箱子=21/467 家具=88，招牌=55/85/425 布吿框）
      if (sections.chestList && sections.chestList.length > 0) {
        const hits = await findMatches(
          raw,
          parsed,
          [
            { kind: 'tile', id: 21 }, // 箱子
            { kind: 'tile', id: 467 }, // 集装箱 2
            { kind: 'tile', id: 470 }, // 集装箱 3
            { kind: 'tile', id: 475 }, // 集装箱 4
            { kind: 'tile', id: 88 }, // 穿衣镜（也是箱子）
          ],
          { limit: 400_000 },
        )
        const set = new Set(hits.hits.map((h) => `${h.x},${h.y}`))
        const matched = sections.chestList.filter((c) => set.has(`${c.x},${c.y}`)).length
        // 允许极少数「箱子已被拆掉但段里还留着」的存档（实测 <1%）
        expect(matched / sections.chestList.length).toBeGreaterThan(0.95)
      }
      // 招牌不做「坐标必须落在招牌图格上」的断言：真实存档里常见**残留记录**
      // （墓碑被挖掉后记录仍在，游戏 `LoadSigns` 会直接丢弃这类记录，实测 world-S87 9/9 都是这种）。
      if (sections.signList) expect(sections.signList.length).toBe(sections.signs)

      // 把所有定长字段写成「现有值」→ 必须逐字节不变（偏移表正确性的强证据）
      const echo = applyWorldEdits(raw, track, {
        gameMode: parsed.info.gameMode,
        spawn: { x: parsed.info.spawn.x, y: parsed.info.spawn.y },
        time: parsed.info.time,
        dayTime: parsed.info.dayTime,
        moonPhase: parsed.info.moonPhase,
        bloodMoon: parsed.info.bloodMoon,
        eclipse: parsed.info.eclipse,
        hardmode: parsed.info.hardmode,
        bosses: Object.fromEntries(parsed.info.bossesDowned.map((k) => [k, true])),
      })
      expect(Buffer.from(echo).equals(Buffer.from(raw))).toBe(true)


      // 空编辑 → 逐字节不变
      expect(Buffer.from(applyWorldEdits(raw, track, {})).equals(Buffer.from(raw))).toBe(true)

      // 箱子 / 招牌段「原样重建」→ 结构上必须是恒等变换（最容易写坏的地方）。
      // 唯一允许的差异是 `Revision++`（游戏自己保存世界也会 +1），所以比对时跳过那 4 个字节。
      const sameExceptRevision = (out: Uint8Array) => {
        if (out.length !== raw.length) return false
        for (let i = 0; i < out.length; i++) {
          if (i >= track.revisionAt && i < track.revisionAt + 4) continue
          if (out[i] !== raw[i]) return false
        }
        return true
      }
      if (sections.chestList && sections.chestList.length > 0) {
        const rebuilt = applyWorldEdits(raw, track, {
          chests: sections.chestList.map((c) => ({
            x: c.x,
            y: c.y,
            name: c.name,
            capacity: c.capacity,
            items: c.items,
          })),
        })
        expect(sameExceptRevision(rebuilt)).toBe(true)
        // 长度没变 → 段指针表也应原样
        const t2 = {} as WorldTrack
        parseWorld(rebuilt, t2)
        expect(t2.pointers).toEqual(track.pointers)
      }
      if (sections.signList && sections.signList.length > 0) {
        const rebuilt = applyWorldEdits(raw, track, { signs: sections.signList })
        expect(sameExceptRevision(rebuilt)).toBe(true)
      }

      // 箱子 / 招牌「真改一次」：改第 1 块招牌文本 + 第 1 个箱子名 → 重新解析读到新值，
      // 且图格段逐字节不变（证明只有箱子/招牌段被重建、后续段只是平移）。
      if (sections.signList && sections.signList.length > 0) {
        const draft = draftFromContent(sections.chestList ?? [], sections.signList)
        draft.signs[0].text = `${draft.signs[0].text}-edit`
        if (draft.chests.length > 0) draft.chests[0].name = 'edited'
        const edits = buildContentEdits(draft, {
          chests: sections.chestList ?? [],
          signs: sections.signList,
        })
        const out = applyWorldEdits(raw, track, edits)
        const t2 = {} as WorldTrack
        const parsed2 = parseWorld(out, t2)
        const sec2 = parseWorldSections(out, t2, parsed2.info.release)
        expect(sec2.signList![0].text).toBe(draft.signs[0].text)
        if (draft.chests.length > 0) expect(sec2.chestList![0].name).toBe('edited')
        expect(sec2.signs).toBe(sections.signs)
        expect(sec2.chests).toBe(sections.chests)
        // 图格段原样（[pointers[1], pointers[2])）
        expect(
          Buffer.from(out.subarray(t2.pointers[1], t2.pointers[2])).equals(
            Buffer.from(raw.subarray(track.pointers[1], track.pointers[2])),
          ),
        ).toBe(true)
      }

      // 时间字段：创建时间是本地墙上时间（不带 Z），最后游玩是 UTC（带 Z）。
      // 这条能挡住「把 Kind 位当无事」的回归（实测曾经把最后游玩显示早一个时区）。
      if (parsed.info.createdAt) expect(parsed.info.createdAt.endsWith('Z')).toBe(false)
      if (parsed.info.lastPlayed) expect(parsed.info.lastPlayed.endsWith('Z')).toBe(true)

      // 悬停解码器（tileAt，第三份实现）与箱子段交叉验证：
      // 每个箱子的坐标在 tileAt 看来必须是**箱子类图格**（21 / 467 / 88 / 470 / 475）。
      if (thumb.columnOffsets && sections.chestList && sections.chestList.length > 0) {
        const chestTiles = new Set([21, 88, 467, 470, 475])
        let ok = 0
        for (const chest of sections.chestList) {
          const cell = tileAt(raw, parsed, thumb.columnOffsets, chest.x, chest.y)
          if (cell && chestTiles.has(cell.tile)) ok++
        }
        expect(ok / sections.chestList.length).toBeGreaterThan(0.95)
      }

      // 图格替换（安全子集）：挑一个真实存在的图格换成另一个同类的，
      // 断言「文件长度不变 / 被换的格子数 == 原计数 / 其它统计不变」。
      if (thumb.columnOffsets) {
        const candidates = [...stats.tiles.entries()]
          .map(([id, n]) => ({ id, n }))
          .filter(({ id }) => checkTileReplace(parsed, id, id === 1 ? 0 : 1) === null)
          .sort((a, b) => b.n - a.n)
        const pick = candidates[0]
        if (pick) {
          const to = pick.id === 1 ? 0 : 1
          const res = replaceTileType(raw, parsed, pick.id, to)
          expect(res.bytes.length).toBe(raw.length)
          expect(res.replacedCells).toBe(pick.n)
          const after = await renderWorldThumbnail(res.bytes, parseWorld(res.bytes, {} as WorldTrack), {
            maxPixels: 40_000,
            yieldEvery: 100_000,
          })
          expect(after.stats.tiles.get(pick.id)).toBeUndefined()
          expect(after.stats.tiles.get(to)).toBe((stats.tiles.get(to) ?? 0) + pick.n)
          expect(after.stats.air).toBe(stats.air)
          expect([...after.stats.walls.entries()]).toEqual([...stats.walls.entries()])
          // 段指针 / footer 位置一个都没动（长度不变的自然结果，这里显式断言）
          const t2 = {} as WorldTrack
          parseWorld(res.bytes, t2)
          expect(t2.pointers).toEqual(track.pointers)
          expect(t2.footerAt).toBe(track.footerAt)
        }
      }

      // 导出报告：每个图格 / 墙都要出现，空气与箱子计数要与统计一致（防「静默丢行」）
      const report = buildAnalysisText({
        info: parsed.info,
        stats,
        sections,
        names: {
          tile: (id) => `#t${id}`,
          wall: (id) => `#w${id}`,
          item: (id) => `#i${id}`,
          prefix: (id) => `#p${id}`,
          npc: (id) => `#n${id}`,
        },
        exportedAt: '2026-10-27T00:00:00.000Z',
      })
      expect(report).toContain(`Air: ${stats.air} (`)
      if (sections.chests != null) expect(report).toContain(`Chest Count: ${sections.chests}`)
      for (const id of stats.tiles.keys()) expect(report).toContain(`#t${id}: `)
      for (const id of stats.walls.keys()) expect(report).toContain(`#w${id}: `)
      // 箱子：有明细时逐箱都要出现（`[x, y]` 前缀）
      if (sections.chestList) for (const chest of sections.chestList) expect(report).toContain(`[${chest.x}, ${chest.y}]`)

      // 刚生成的草稿必须是「干净的」（否则界面会一进编辑态就提示有未保存改动）
      const freshDraft = draftFromWorld(parsed.info, track)
      expect({ name: parsed.info.name, dirty: isWorldDraftDirty(parsed.info, track, freshDraft) }).toEqual({
        name: parsed.info.name,
        dirty: false,
      })

      // 改名（长度变化）→ 指针整体平移、中间段逐字节不变、footer 同步
      const newName = `${parsed.info.name}改`.slice(0, 20)
      const out = applyWorldEdits(raw, track, { name: newName })
      const track2 = {} as WorldTrack
      const parsed2 = parseWorld(out, track2)
      expect(parsed2.info.name).toBe(newName)
      expect(track2.worldId).toBe(track.worldId)
      // 平移量 = 头部段增量（footer 名字增量不算在指针里）
      const delta = track2.pointers[1] - track.pointers[1]
      expect(out.length - raw.length).toBeGreaterThanOrEqual(delta)
      expect(track2.pointers[0]).toBe(track.pointers[0])
      for (let i = 1; i < track.pointers.length; i++) {
        // 0 是「该版本没有这一段」的占位，必须原样保留
        if (track.pointers[i] === 0) expect(track2.pointers[i]).toBe(0)
        else expect(track2.pointers[i]).toBe(track.pointers[i] + delta)
      }
      expect(track2.footerAt).toBe(track.footerAt + delta)
      expect(
        Buffer.from(out.subarray(track2.pointers[1], track2.footerAt)).equals(
          Buffer.from(raw.subarray(track.pointers[1], track.footerAt)),
        ),
      ).toBe(true)

      // 全套可编辑字段一次改完 → 重新解析必须**逐项**读到新值（含种子重排）
      const editName = 'Agent 复核'.slice(0, 20)
      const editSeed = track.seed ? 'verify-seed' : undefined
      const spawnX = Math.min(123, w - 1)
      const spawnY = Math.min(45, h - 1)
      // release < 209 的难度是 bool：只能在 0/1 之间切
      const nextMode = track.gameModeIsInt === false ? 1 - parsed.info.gameMode : (parsed.info.gameMode + 1) % 4
      const edited = applyWorldEdits(raw, track, {
        name: editName,
        ...(editSeed ? { seed: editSeed } : {}),
        gameMode: nextMode,
        spawn: { x: spawnX, y: spawnY },
        time: 12345,
        dayTime: true,
        moonPhase: 3,
        bloodMoon: false,
        eclipse: false,
        hardmode: true,
        bosses: { moonLord: true },
      })
      const check = parseWorld(edited, {} as WorldTrack)
      expect(check.info.name).toBe(editName)
      if (editSeed) expect(check.info.seed).toBe(editSeed)
      expect(check.info.gameMode).toBe(nextMode)
      expect(check.info.spawn).toEqual({ x: spawnX, y: spawnY })
      expect(check.info.time).toBe(12345)
      expect(check.info.dayTime).toBe(true)
      expect(check.info.moonPhase).toBe(3)
      expect(check.info.hardmode).toBe(true)
      expect(check.info.bossesDowned).toContain('moonLord')
      // 世界尺寸 / 图格统计不受影响
      expect(check.info.width).toBe(w)
      expect(check.info.height).toBe(h)
      const restats = await renderWorldThumbnail(edited, check, { maxPixels: 40_000, yieldEvery: 100_000 })
      expect(restats.stats.total).toBe(stats.total)
      const restatTotal = [...restats.stats.tiles.values()].reduce((a, b) => a + b, 0)
      expect(restats.stats.air + restatTotal).toBe(w * h)
    }, 180_000)
  }
})

describe.skipIf(players.length === 0)('真实角色存档', () => {
  for (const path of players) {
    it(`解析 / 往返 / 改写：${path.split('/').pop()}`, () => {
      const raw = new Uint8Array(readFileSync(path))
      const track = {} as PlrTrack
      const p = parsePlr(raw, track)
      expect(p.name.length).toBeGreaterThan(0)

      // 配装（≥262）：有解析结果就必须是 3 套、下标 0–2、物品 id 合法，
      // 且 `plrSlots` 的 260–349 里非空格子数 == 配装里非空物品数（槽位映射没串位）
      const expectedLoadoutItems =
        track.tailUnparsed || p.release < 262
          ? null
          : p.loadouts.reduce((n, lo) => n + [...lo.armor, ...lo.dye].filter((it) => it.id > 0).length, 0)
      if (expectedLoadoutItems != null) {
        expect(p.loadouts).toHaveLength(3)
        expect(p.currentLoadoutIndex).toBeGreaterThanOrEqual(0)
        expect(p.currentLoadoutIndex).toBeLessThanOrEqual(2)
        for (const loadout of p.loadouts) {
          for (const item of [...loadout.armor, ...loadout.dye]) {
            expect(item.id === 0 || (item.id > 0 && item.id < 7000)).toBe(true)
          }
        }
        const slots = plrSlots(p).filter((s) => s.slot >= 260 && s.id > 0)
        expect(slots.length).toBe(expectedLoadoutItems)
      }

      // 研究进度明细：条数要与「已研究 N 种」一致；persistentId 绝大多数能对回 items.json 的 key。
      // 少数对不回是**正常的**：老存档里会留下已改名/移除的物品（实测 Joy 里的 `EldMelter`，
      // 1.4.5 已改名为 `ElfMelter`），界面按「原始键名」显示。
      if (p.research) {
        expect(p.research.length).toBe(p.researchedCount ?? p.research.length)
        const unknown = p.research.filter((e) => !itemKeys.has(e.persistentId))
        expect(unknown.length / Math.max(1, p.research.length)).toBeLessThan(0.05)
      }

      // 刚生成的草稿必须是「干净的」
      expect(isDraftDirty(p, track, draftFromPlayer(p, track))).toBe(false)

      // 空编辑：输出必须与原文件逐字节相同（同一份明文 + 同一 key/IV）
      const same = applyPlrEdits(raw, track, {})
      expect(Buffer.from(same).equals(Buffer.from(raw))).toBe(true)
      expect(same.length).toBe(raw.length)

      // 改生命：只有该 int32 的字节变化，其余字段与明文长度都不变
      const life = Math.max(1, Math.min(p.statLifeMax, 100))
      if (p.statLife !== life) {
        const out = applyPlrEdits(raw, track, { statLife: life })
        const p2 = parsePlr(out)
        expect(p2.statLife).toBe(life)
        expect(p2.statLifeMax).toBe(p.statLifeMax)
        expect(p2.name).toBe(p.name)
        expect(p2.inventory.map((i) => `${i.id}:${i.stack}:${i.prefix}`)).toEqual(
          p.inventory.map((i) => `${i.id}:${i.stack}:${i.prefix}`),
        )
        const pos = track.statLife!
        expect(changedPlainOffsets(raw, out).every((o) => o >= pos && o < pos + 4)).toBe(true)
        expect(decryptPlr(out).length).toBe(decryptPlr(raw).length)
      }

      // 把背包 / 永久增强 / 矿车包写成**存档里的原始值**（不是展示值）→ 必须逐字节不变。
      // 注意：`statLifeMax`/`statManaMax` 读的时候会按游戏规则夹到 500/200，回写要用原始字节值。
      const plain = decryptPlr(raw)
      const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength)
      const rawI32 = (pos: number | undefined) => (pos == null ? undefined : dv.getInt32(pos, true))
      const rawU8 = (pos: number | undefined) => (pos == null ? undefined : plain[pos])
      const inventory = Object.fromEntries(
        p.inventory.map((item, i) => [
          i,
          {
            id: rawI32(track.inventory[i].id) ?? item.id,
            stack: rawI32(track.inventory[i].stack) ?? item.stack,
            prefix: rawU8(track.inventory[i].prefix) ?? item.prefix,
          },
        ]),
      )
      const boosts = Object.fromEntries(
        Object.entries(track.boosts).map(([key, pos]) => [key, (rawU8(pos) ?? 0) !== 0]),
      )
      const echo = applyPlrEdits(raw, track, {
        statLife: rawI32(track.statLife),
        statLifeMax: rawI32(track.statLifeMax),
        statMana: rawI32(track.statMana),
        statManaMax: rawI32(track.statManaMax),
        anglerQuests: rawI32(track.anglerQuests),
        golferScore: rawI32(track.golferScore),
        boosts: boosts as never,
        inventory,
        ...(track.superCartBits != null
          ? {
              superCart: {
                unlocked: (rawU8(track.superCartBits)! & 1) !== 0,
                enabled: (rawU8(track.superCartBits)! & 2) !== 0,
              },
            }
          : {}),
      })
      expect(Buffer.from(echo).equals(Buffer.from(raw))).toBe(true)

      // 装备区（装备 / 时装 / 染料 / 杂项）：把现有 id + prefix 原样写回 → 必须逐字节不变。
      // 这条能证明装备区的偏移表是对的（错了就会把别的字节写坏）。
      const equipmentEcho = {
        armor: Object.fromEntries(p.armor.map((it, i) => [i, { id: it.id, stack: 0, prefix: it.prefix }])),
        dye: Object.fromEntries(p.dye.map((it, i) => [i, { id: it.id, stack: 0, prefix: it.prefix }])),
        miscEquips: Object.fromEntries(p.miscEquips.map((it, i) => [i, { id: it.id, stack: 0, prefix: it.prefix }])),
        miscDyes: Object.fromEntries(p.miscDyes.map((it, i) => [i, { id: it.id, stack: 0, prefix: it.prefix }])),
      }
      expect(Buffer.from(applyPlrEdits(raw, track, { equipment: equipmentEcho })).equals(Buffer.from(raw))).toBe(true)

      // 随身仓储（猪猪 / 保险箱 / 熔炉 / 虚空袋）：把**文件里的原始字节值**原样写回 → 逐字节不变。
      // 注意要用 rawI32/rawU8 而不是解析值：`normalize()` 会把空格的 stack 0 补成 1，那不是文件真值。
      const echoSlots = (offsets: { id: number; stack: number; prefix: number }[]) =>
        Object.fromEntries(
          offsets.map((slot, i) => [
            i,
            { id: rawI32(slot.id) ?? 0, stack: rawI32(slot.stack) ?? 0, prefix: rawU8(slot.prefix) ?? 0 },
          ]),
        )
      const storageEcho = {
        piggyBank: echoSlots(track.storage.piggyBank!),
        safe: echoSlots(track.storage.safe!),
        forge: echoSlots(track.storage.forge ?? []),
        voidVault: echoSlots(track.storage.voidVault ?? []),
      }
      expect(Buffer.from(applyPlrEdits(raw, track, { storage: storageEcho })).equals(Buffer.from(raw))).toBe(true)

      // 三套配装：现有 id + stack + prefix 原样写回 → 逐字节不变（≥262 且尾部解析成功才有）
      if (track.loadouts.length > 0) {
        const loadoutEcho = Object.fromEntries(
          track.loadouts.map((lo, i) => [i, { armor: echoSlots(lo.armor), dye: echoSlots(lo.dye) }]),
        )
        expect(Buffer.from(applyPlrEdits(raw, track, { loadouts: loadoutEcho })).equals(Buffer.from(raw))).toBe(true)
      }

      // 多字段 + 背包槽一次改完 → 重新解析逐项读到新值，其余字段不变
      const targetLife = Math.min(p.statLifeMax, 100)
      const edits: Parameters<typeof applyPlrEdits>[2] = {
        statLife: targetLife,
        ...(track.statLifeMax != null ? { statLifeMax: Math.max(p.statLifeMax, targetLife) } : {}),
        ...(track.anglerQuests != null ? { anglerQuests: 5 } : {}),
        ...(track.golferScore != null ? { golferScore: 7 } : {}),
        ...(track.boosts.extraAccessory != null ? { boosts: { extraAccessory: true } as never } : {}),
        inventory: { 10: { id: 75, stack: 5, prefix: 0 } }, // 坠落之星（堆叠上限 9999）
      }
      const edited = applyPlrEdits(raw, track, edits)
      const after = parsePlr(edited)
      expect(after.statLife).toBe(targetLife)
      if (track.anglerQuests != null) expect(after.anglerQuests).toBe(5)
      if (track.golferScore != null) expect(after.golferScore).toBe(7)
      if (track.boosts.extraAccessory != null) expect(after.extraAccessory).toBe(true)
      expect(after.inventory[10]).toMatchObject({ id: 75, stack: 5, prefix: 0 })
      // 其余字段与背包其它格原样保留
      expect(after.name).toBe(p.name)
      expect(after.difficulty).toBe(p.difficulty)
      expect(after.release).toBe(p.release)
      expect(after.buffs.length).toBe(p.buffs.length)
      expect(after.spawns).toEqual(p.spawns)
      const untouched = p.inventory.map((it, i) => (i === 10 ? null : `${it.id}:${it.stack}:${it.prefix}`))
      expect(after.inventory.map((it, i) => (i === 10 ? null : `${it.id}:${it.stack}:${it.prefix}`))).toEqual(untouched)
      expect(edited.length).toBe(raw.length)
      // 空编辑仍然逐字节相同（同一份明文、同一 key/IV）
      expect(Buffer.from(applyPlrEdits(raw, track, {})).equals(Buffer.from(raw))).toBe(true)
    })
  }
})


/**
 * 版本段表（`isSameReleaseLayout` / 59 个 `release >= N` 门槛）的正确性：
 * 同段内改版本号 → 重新解析必须**除 release 外逐字段相同**（布局真的没变）；
 * 跨段 → 校验层必须报 `releaseLayout`（否则就是允许跨布局写版本，等于毁档）。
 *
 * 每个 release 取一份真实存档来验证（同版本布局一致，不必重复）。
 */
describe.skipIf(players.length === 0)('真实存档：版本段表', () => {
  it('同段改版本号不改变任何其它字段；跨段被拦下', () => {
    const seen = new Set<number>()
    let sameSegment = 0
    let crossRejected = 0
    const failures: string[] = []
    const catalog = {
      hasItem: (id: number) => id > 0 && id < 7000,
      maxStack: () => undefined,
      blocked: () => false,
      prefixes: () => undefined as readonly number[] | undefined,
    }

    for (const path of players) {
      const raw = new Uint8Array(readFileSync(path))
      let track: PlrTrack
      let player: ReturnType<typeof parsePlr>
      try {
        track = {} as PlrTrack
        player = parsePlr(raw, track)
      } catch {
        continue
      }
      if (seen.has(player.release)) continue
      seen.add(player.release)

      for (const v of PLAYER_VERSIONS) {
        if (v.release === player.release) continue
        const inSegment = isSameReleaseLayout(player.release, v.release)
        const draft = { ...draftFromPlayer(player, track), release: v.release }
        const rejected = validatePlrDraft(draft, { catalog, original: player }).some(
          (i) => i.messageKey === 'save.edit.err.releaseLayout',
        )
        if (inSegment === rejected) {
          failures.push(`rel ${player.release} → ${v.release}: inSegment=${inSegment} rejected=${rejected}`)
        }
        if (!inSegment) {
          crossRejected++
          continue
        }
        const after = parsePlr(applyPlrEdits(raw, track, { release: v.release }))
        if (after.release !== v.release) failures.push(`rel ${player.release} → ${v.release}: 写回 release=${after.release}`)
        for (const key of Object.keys(player) as (keyof typeof player)[]) {
          if (key === 'release') continue
          const a = player[key]
          const b = after[key]
          const ja = typeof a === 'object' ? JSON.stringify(a) : String(a)
          const jb = typeof b === 'object' ? JSON.stringify(b) : String(b)
          if (ja !== jb) failures.push(`rel ${player.release} → ${v.release}: 字段 ${String(key)} 变了`)
        }
        sameSegment++
      }
    }
    expect({ versions: seen.size, sameSegment, crossRejected, failures: failures.slice(0, 8) }).toEqual({
      versions: seen.size,
      sameSegment,
      crossRejected,
      failures: [],
    })
    expect(sameSegment).toBeGreaterThan(0)
    expect(crossRejected).toBeGreaterThan(0)
  })
})


/**
 * 写回路径的**确定性随机**压测（LCG 固定种子，结果可复现）：
 * 随机改生命 / 魔力 / 渔夫 / Golf / 随机背包格，重新解析必须逐项读到新值，长度不变。
 * 目的是抓「两个字段共用同一偏移」这类只有随机组合才能撞出来的错。
 */
describe.skipIf(players.length === 0)('真实存档：写回随机压测', () => {
  it('随机改一组字段后重新解析逐项一致（含文件长度不变）', () => {
    const rnd = (() => {
      let s = 20261027
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0x100000000
      }
    })()
    const failures: string[] = []
    let checked = 0

    for (const path of players) {
      const raw = new Uint8Array(readFileSync(path))
      let track: PlrTrack
      let before: ReturnType<typeof parsePlr>
      try {
        track = {} as PlrTrack
        before = parsePlr(raw, track)
      } catch {
        continue
      }
      const lifeMax = Math.floor(rnd() * 500)
      const life = Math.floor(rnd() * (lifeMax + 1))
      const manaMax = Math.floor(rnd() * 200)
      const mana = Math.floor(rnd() * 401)
      const angler = Math.floor(rnd() * 9999)
      const golf = Math.floor(rnd() * 2_000_000)
      const slot = Math.floor(rnd() * 58)
      const id = [0, 1, 2, 3, 29, 75, 4956][Math.floor(rnd() * 7)]
      const stack = id === 0 ? 0 : 1 + Math.floor(rnd() * 50)

      const out = applyPlrEdits(raw, track, {
        statLife: life,
        statLifeMax: lifeMax,
        statMana: mana,
        statManaMax: manaMax,
        ...(track.anglerQuests != null ? { anglerQuests: angler } : {}),
        ...(track.golferScore != null ? { golferScore: golf } : {}),
        inventory: { [slot]: { id, stack, prefix: 0 } },
      })
      const after = parsePlr(out)
      const name = path.split('/').pop()
      if (after.statLife !== life) failures.push(`${name}: life ${after.statLife} ≠ ${life}`)
      if (after.statLifeMax !== lifeMax) failures.push(`${name}: lifeMax ${after.statLifeMax} ≠ ${lifeMax}`)
      if (after.statMana !== mana) failures.push(`${name}: mana ${after.statMana} ≠ ${mana}`)
      if (after.statManaMax !== manaMax) failures.push(`${name}: manaMax ${after.statManaMax} ≠ ${manaMax}`)
      if (track.anglerQuests != null && after.anglerQuests !== angler) failures.push(`${name}: angler 不一致`)
      if (track.golferScore != null && after.golferScore !== golf) failures.push(`${name}: golf 不一致`)
      if (after.inventory[slot].id !== id) failures.push(`${name}: slot ${slot} id ${after.inventory[slot].id} ≠ ${id}`)
      if (after.inventory[slot].stack !== stack) failures.push(`${name}: slot ${slot} stack 不一致`)
      if (out.length !== raw.length) failures.push(`${name}: 长度变了`)
      if (after.name !== before.name) failures.push(`${name}: 名字变了`)
      checked++
    }
    expect({ checked, failures: failures.slice(0, 8) }).toEqual({ checked, failures: [] })
    expect(checked).toBeGreaterThan(0)
  })
})
