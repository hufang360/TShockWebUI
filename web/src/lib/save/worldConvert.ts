/**
 * `.wld` **版本转换**：在 1.4.0.1（225）… 1.4.6.1（329）之间改存档版本。
 *
 * 世界格式与角色不同，改版本要同时动四处（门槛见 `worldVersions.ts`）：
 * 1. **头部**：225–329 之间增删过一堆定长块（种子位、NPC 解锁位、日晷、团队出生点、
 *    最后游玩时间、manifest 等，完整清单见 `convertHeader` 的 `gates`）；
 * 2. **箱子段**：294 起从「整段共享容量」变成「每箱自带容量」；
 * 3. **NPC 段**：268 起多一段「微光化城镇 NPC」列表、315 起每个城镇 NPC 多一个 `homelessDespawn`；
 * 4. **图格实体段**：307 / 308 起假人（`TEDisplayDoll`）各多 1 字节（pose / bits3）。
 *
 * 做法：头部按 `WorldTrack.changePoints` 记录的锚点做**字节级插入 / 删除**（不认识的字段原样保留），
 * 箱子段用现成的 `encodeChestsSection` 重写，NPC / 图格实体段做**只插 / 只删固定字节**的手术。
 * 绝不猜位置：缺锚点或遇到未知实体类型就拒绝（`unreadable`）。
 *
 * 降级会真的丢数据（最后游玩时间、永久节日、种子位、团队出生点、manifest、NPC 流浪消失位…），
 * 而且在目标版本不认识某些内容（图格 / 墙 / 物品 / NPC / 图格实体）时会**拒绝**，不生成坏档。
 *
 * 策略：**升级**从 1.4.0.1 起都支持；**降级**只到 1.4.4（269）——再往下缺少可靠的实体类型表。
 */
import { ByteReader } from './bytes'
import { parseWorld, type WorldTrack } from './worldFile'
import { encodeChestsSection, type ChestWrite } from './worldSections'
import { parseWorldSections } from './worldStats'
import {
  WORLD_CONVERT_MAX_RELEASE,
  WORLD_CONVERT_MIN_RELEASE,
  WORLD_DOWNGRADE_MIN_RELEASE,
  isSameWorldLayout,
  worldVersionInfo,
  type WorldVersionInfo,
} from './worldVersions'

/** 不能转换的原因（UI 据此给出具体文案）。 */
export type WorldConvertProblem =
  | 'sourceTooOld'
  | 'sourceUnknown'
  | 'targetTooOld'
  | 'targetTooNew'
  | 'unknownTarget'
  | 'downgradeTooOld'
  | 'unreadable'

/** 世界内容里用到、但目标版本不认识的最大 ID。 */
export interface WorldContentIssue {
  kind: 'tile' | 'wall' | 'item' | 'npc' | 'entity'
  id: number
  max: number
}

/** 世界内容里实际用到的最大 ID（降级兼容性判据）。 */
export interface WorldContentUsage {
  tile: number
  wall: number
  item: number
  npc: number
  entity: number
}

const EMPTY_USAGE: WorldContentUsage = { tile: 0, wall: 0, item: 0, npc: 0, entity: 0 }

/** 纯判断：这份存档能不能转成 `to`（不含内容兼容性，后者要扫世界，见 `collectWorldUsage`）。 */
export function checkWorldConvert(from: number, to: number): WorldConvertProblem | null {
  if (to === from) return null
  if (from < WORLD_CONVERT_MIN_RELEASE) return 'sourceTooOld'
  // 只认发布过的版本：299–312 等预览版的段格式（尤其 311 的假人）没做过转换验证。
  if (!worldVersionInfo(from)) return 'sourceUnknown'
  if (to < WORLD_CONVERT_MIN_RELEASE) return 'targetTooOld'
  if (to > WORLD_CONVERT_MAX_RELEASE) return 'targetTooNew'
  if (!worldVersionInfo(to)) return 'unknownTarget'
  // 同布局段只改 4 字节版本号，不涉及格式（也允许降到 1.4.4 以下）。
  if (isSameWorldLayout(from, to)) return null
  if (to < from && to < WORLD_DOWNGRADE_MIN_RELEASE) return 'downgradeTooOld'
  return null
}

/** 目标版本不认识的内容（按 ID 大小，只报每类最大的那一项）。 */
export function worldContentIssues(
  target: WorldVersionInfo,
  usage: WorldContentUsage,
): WorldContentIssue[] {
  const issues: WorldContentIssue[] = []
  if (usage.tile > target.maxTile) issues.push({ kind: 'tile', id: usage.tile, max: target.maxTile })
  if (usage.wall > target.maxWall) issues.push({ kind: 'wall', id: usage.wall, max: target.maxWall })
  if (usage.item > target.maxItem) issues.push({ kind: 'item', id: usage.item, max: target.maxItem })
  if (usage.npc > target.maxNpc) issues.push({ kind: 'npc', id: usage.npc, max: target.maxNpc })
  if (usage.entity > target.maxEntity) {
    issues.push({ kind: 'entity', id: usage.entity, max: target.maxEntity })
  }
  return issues
}

/** 内容不兼容时的用户可读文案（保存失败会原样显示）。 */
export function worldContentIssueMessage(
  target: WorldVersionInfo,
  issue: WorldContentIssue,
): string {
  const kind = { tile: '图格', wall: '墙', item: '物品', npc: 'NPC', entity: '图格实体' }[issue.kind]
  return `目标版本 ${target.gameVersion}（${target.release}）不认识世界里的${kind} ID ${issue.id}（最高 ${issue.max}），已拒绝转换。`
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function splice(out: Uint8Array, at: number, remove: number, insert?: Uint8Array): Uint8Array {
  return concat([out.subarray(0, at), ...(insert ? [insert] : []), out.subarray(at + remove)])
}

/** 头部里的门槛块在源 / 目标版本里是否存在（313 是「299–312 才有」的特例）。 */
function gatePresent(gate: number, release: number): boolean {
  if (gate === 313) return release >= 299 && release < 313
  return release >= gate
}

/** 升级时用世界自身信息推出来的默认值（不是简单写 0 的那几项）。 */
interface ConvertDefaults {
  /** 天顶世界：267 之前由「醉汉 + 颠倒」推导，升级到 267+ 时要按推导结果写。 */
  zenith: boolean
  /** 251 的 8 个 NPC 解锁位：1.4.4.9 之前的加载端会按「世界里有没有这个 NPC」反推。 */
  npcUnlocks?: Uint8Array
}

/** 每个门槛在「目标有、源没有」时要插入的默认字节。 */
function defaultBlock(
  gate: number,
  src: Uint8Array,
  track: WorldTrack,
  defaults: ConvertDefaults,
): Uint8Array {
  switch (gate) {
    // 最后游玩时间：拿创建时间顶上（比写 0 更接近游戏自己的行为）。
    case 284: {
      const at = track.createdAtAt
      if (at != null && at + 8 <= src.length) return src.slice(at, at + 8)
      return new Uint8Array(8)
    }
    case 251:
      return defaults.npcUnlocks ?? new Uint8Array(8)
    case 267:
      return Uint8Array.of(defaults.zenith ? 1 : 0)
    case 287:
      return new Uint8Array(2) // 永久万圣节 / 圣诞节
    case 291:
      return new Uint8Array(8) // 流星雨 / 金币雨
    case 264:
      return new Uint8Array(2) // 日晷 / 月晷
    case 261:
      return new Uint8Array(7) // 7 种史莱姆
    case 289:
      return new Uint8Array(2) // 可领取横幅：int16 0
    case 297:
      return new Uint8Array(2) // 团队出生点：bool false + byte 0
    case 299:
      return new Uint8Array(1) // WorldManifestData：空字符串
    case 313:
      return new Uint8Array(4) // 299–312 的废弃 u32
    case 323:
      return new Uint8Array(2) // 更多闪电 / 无闪电
    default:
      // 单字节的布尔 / 计数位（227 / 238 / 239 / 240 / 241 / 249 / 250 / 257 / 259 / 260 / 266 / 288 / 296 / 302 / 304 / 328）
      return new Uint8Array(1)
  }
}

/**
 * 重写头部段：插入 / 删除各门槛块，其余字节原样保留。
 *
 * `gates` 是**文件里的真实顺序**（`302` 在创建时间前、`257` 在中段、`299/313` 在最后），
 * 同一位置有多个「源没有」的门槛时按这个顺序累加，再统一从后往前应用。
 */
function convertHeader(
  src: Uint8Array,
  track: WorldTrack,
  from: number,
  to: number,
  defaults: ConvertDefaults,
): Uint8Array {
  const cp = track.changePoints
  if (!cp) throw new Error('这份存档缺少版本门槛锚点，无法转换')

  const headerStart = track.headerAt
  const gates = [
    227, 238, 239, 241, 249, 266, 267, 302, // 难度 / 种子区（在创建时间前）
    284, // 最后游玩时间
    257, 289, // 击杀进度 / 可领取横幅
    240, 250, 251, 259, 260, 261, 264, // 1.4.2–1.4.4 的解锁位
    287, 288, 296, 291, 297, 304, 323, 328, // 1.4.5 / 1.4.6 尾巴
    313, 299, // 废弃 u32 / manifest
  ]

  type Change = { at: number; remove?: number; insert?: Uint8Array[] }
  const changes = new Map<number, Change>()

  for (const gate of gates) {
    const before = gatePresent(gate, from)
    const after = gatePresent(gate, to)
    if (before === after) continue
    const point = cp[gate]
    if (!point) throw new Error(`这份存档缺少版本门槛 ${gate} 的锚点，无法转换`)
    const at = point.start - headerStart
    const entry = changes.get(at) ?? { at }
    if (after && !before) {
      ;(entry.insert ??= []).push(defaultBlock(gate, src, track, defaults))
    } else {
      entry.remove = (entry.remove ?? 0) + (point.end - point.start)
    }
    changes.set(at, entry)
  }

  let header: Uint8Array = src.slice(headerStart, track.headerEnd)
  for (const change of [...changes.values()].sort((a, b) => b.at - a.at)) {
    header = splice(header, change.at, change.remove ?? 0, change.insert ? concat(change.insert) : undefined)
  }
  return header
}

/**
 * NPC 段：268（微光化列表）与 315（`homelessDespawn`）两个门槛。
 *
 * 268 的列表在段首：`int32 数量 + 数量 × int32 netID`；
 * 315 的位在每个城镇 NPC 的变体字节后面（第二个循环不受影响）。
 */
function convertNpcSection(section: Uint8Array, from: number, to: number): Uint8Array {
  const addShimmer = from < 268 && to >= 268
  const dropShimmer = from >= 268 && to < 268
  const addDespawn = from < 315 && to >= 315
  const dropDespawn = from >= 315 && to < 315
  if (!addShimmer && !dropShimmer && !addDespawn && !dropDespawn) return section

  const r = new ByteReader(section)
  let shimmerCount = 0
  if (from >= 268) {
    shimmerCount = r.i32()
    r.skip(shimmerCount * 4)
  }
  const despawnAt: number[] = []
  while (r.boolean()) {
    if (from >= 190) r.i32() // netID（更老的是名字字符串，但转换只支持 ≥1.4.0.1）
    r.str() // GivenName
    r.skip(8) // position.X / position.Y
    r.boolean() // homeless
    r.skip(8) // homeTileX / homeTileY
    if (from >= 213) {
      const flags = r.u8()
      if (flags & 1) r.skip(4) // townNpcVariationIndex
    }
    despawnAt.push(r.pos) // 源有 = despawn 的位置；源没有 = 插入点
    if (from >= 315) r.boolean()
  }

  type Edit = { at: number; remove: number; insert?: Uint8Array }
  const edits: Edit[] = []
  for (const at of despawnAt) {
    if (addDespawn) edits.push({ at, remove: 0, insert: Uint8Array.of(0) })
    else if (dropDespawn) edits.push({ at, remove: 1 })
  }
  if (addShimmer) edits.push({ at: 0, remove: 0, insert: new Uint8Array(4) })
  if (dropShimmer) edits.push({ at: 0, remove: 4 + shimmerCount * 4 })

  let out = section
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    out = splice(out, edit.at, edit.remove, edit.insert)
  }
  return out
}

/**
 * 图格实体段：只处理 **307 / 308 的假人（`TEDisplayDoll`）**。
 *
 * 段格式：`int32 数量` → 每条 `u8 类型 + int32 ID + int16 x + int16 y + 额外数据`。
 * 假人额外数据：`bits1, bits2, [pose ≥307], [bits3 ≥308]`，随后按位图读装备 / 染料 / 杂项。
 * 其它类型的额外数据都是定长（见 `skipEntityExtra`），用来走到下一条。
 */
function convertTileEntitySection(section: Uint8Array, from: number, to: number): Uint8Array {
  const touchesDoll = (from < 307 && to >= 307) || (from >= 307 && to < 307) || (from < 308 && to >= 308) || (from >= 308 && to < 308)
  if (!touchesDoll) return section

  const r = new ByteReader(section)
  const count = r.i32()
  type Edit = { at: number; remove: number; insert?: Uint8Array }
  const edits: Edit[] = []

  for (let i = 0; i < count; i++) {
    const type = r.u8()
    r.i32() // ID
    r.skip(4) // x, y
    const extra = r.pos

    if (type === 3) {
      const bits1 = r.u8()
      const bits2 = r.u8()
      const poseAt = extra + 2
      const bits3At = poseAt + (from >= 307 ? 1 : 0)
      let bits3 = 0
      if (from >= 307) r.u8() // pose
      if (from >= 308) bits3 = r.u8()

      if (from < 307) {
        if (to >= 308) edits.push({ at: poseAt, remove: 0, insert: Uint8Array.of(0, 0) })
        else edits.push({ at: poseAt, remove: 0, insert: Uint8Array.of(0) })
      } else if (from < 308) {
        if (to >= 308) edits.push({ at: bits3At, remove: 0, insert: Uint8Array.of(0) })
      } else if (to < 307) {
        edits.push({ at: poseAt, remove: 2 })
      } else if (to < 308) {
        edits.push({ at: bits3At, remove: 1 })
      }

      // 9 件装备 + 9 件染料 + 1 件杂项（只看「有没有」决定是否跳过 5 字节）。
      const equip = bits1 | (bits3 & 2 ? 0x100 : 0)
      for (let slot = 0; slot < 9; slot++) if (equip & (1 << slot)) r.skip(5)
      const dyes = bits2 | (bits3 & 4 ? 0x100 : 0)
      for (let slot = 0; slot < 9; slot++) if (dyes & (1 << slot)) r.skip(5)
      if (bits3 & 1) r.skip(5)
    } else {
      skipEntityExtra(r, type)
    }
  }

  if (edits.length === 0) return section
  let out = section
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    out = splice(out, edit.at, edit.remove, edit.insert)
  }
  return out
}

/** 非假人的图格实体额外数据（类型 ID 见 `TileEntitiesManager.RegisterAll` 的顺序）。 */
function skipEntityExtra(r: ByteReader, type: number): void {
  switch (type) {
    case 0: // TrainingDummy
    case 2: // LogicSensor
    case 9: // KiteAnchor（TELeashedEntityAnchorWithItem）
    case 10: // CritterAnchor
      r.skip(2)
      return
    case 1: // ItemFrame
    case 4: // WeaponsRack
    case 6: // FoodPlatter
    case 8: // DeadCellsDisplayJar
      r.skip(2 + 1 + 2) // int16 物品 + u8 词缀 + int16 数量
      return
    case 5: {
      // HatRack：1 字节位图 → 2 件装备 + 2 件染料
      const bits = r.u8()
      for (let i = 0; i < 4; i++) if (bits & (1 << i)) r.skip(5)
      return
    }
    case 7: // TeleportationPylon：没有额外数据
      return
    default:
      throw new Error(`未知的图格实体类型 ${type}，无法安全转换版本`)
  }
}

/** 扫图格实体段，返回出现过的最大类型 ID（同时校验能完整走完）。 */
export function scanTileEntityMax(src: Uint8Array, track: WorldTrack): number {
  const at = track.pointers[5] ?? 0
  const end = track.pointers[6] ?? track.footerAt
  if (!(end >= at && end <= src.length)) throw new Error('图格实体段定位失败')
  const r = new ByteReader(src.subarray(at, end))
  const count = r.i32()
  let max = 0
  for (let i = 0; i < count; i++) {
    const type = r.u8()
    if (type > max) max = type
    r.i32()
    r.skip(4)
    if (type === 3) {
      const bits1 = r.u8()
      const bits2 = r.u8()
      const release = track.release
      let bits3 = 0
      if (release >= 307) r.u8()
      if (release >= 308) bits3 = r.u8()
      const equip = bits1 | (bits3 & 2 ? 0x100 : 0)
      for (let slot = 0; slot < 9; slot++) if (equip & (1 << slot)) r.skip(5)
      const dyes = bits2 | (bits3 & 4 ? 0x100 : 0)
      for (let slot = 0; slot < 9; slot++) if (dyes & (1 << slot)) r.skip(5)
      if (bits3 & 1) r.skip(5)
    } else {
      skipEntityExtra(r, type)
    }
  }
  return max
}

/** 按替换后的段重建整份文件（重排段指针、Revision++、写版本号）。 */
function rebuild(
  src: Uint8Array,
  track: WorldTrack,
  replacements: Map<number, Uint8Array>,
  version: number,
): Uint8Array {
  const pieces: Uint8Array[] = []
  const newPointers: number[] = []
  let size = 0
  for (let i = 0; i < track.pointers.length; i++) {
    const from = i === 0 ? 0 : (track.pointers[i - 1] ?? 0)
    const to = track.pointers[i] ?? track.footerAt
    const piece = replacements.get(i) ?? src.slice(from, to)
    pieces.push(piece)
    size += piece.length
    newPointers[i] = size
  }
  for (let i = 0; i < newPointers.length; i++) {
    if (track.pointers[i] === 0) newPointers[i] = 0
  }
  pieces.push(src.slice(track.footerAt))

  const out = concat(pieces)
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
  newPointers.forEach((p, i) => dv.setInt32(track.pointersAt + i * 4, p, true))
  dv.setUint32(track.revisionAt, (dv.getUint32(track.revisionAt, true) + 1) >>> 0, true)
  dv.setInt32(0, version, true)
  return out
}

/**
 * 把世界从它自己的版本转到 `to`，返回**新的**字节（不改入参）。
 *
 * 同布局段内只改 4 字节版本号（不重建、不 Revision++），与「改难度」这类补丁一致。
 * `usage` 不传时会自己扫一遍世界内容做兼容性检查（只在降级且目标上限更小时才扫）。
 */
export function convertWorld(
  data: ArrayBuffer | Uint8Array,
  track: WorldTrack,
  to: number,
  usage?: WorldContentUsage,
): Uint8Array {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data)
  const from = track.release
  const problem = checkWorldConvert(from, to)
  if (problem) throw new Error(`不能转换这份世界：${problem}（${from} → ${to}）`)

  // 同布局段：只改版本号，其它字节一个都不动。
  if (isSameWorldLayout(from, to)) {
    const out = src.slice()
    new DataView(out.buffer, out.byteOffset, out.byteLength).setInt32(0, to, true)
    return out
  }

  const target = worldVersionInfo(to)
  if (!target) throw new Error(`不能转换这份世界：unknownTarget（${to}）`)

  // 降级才需要内容兼容性检查：目标上限低于源版本上限时，先扫世界。
  const source = worldVersionInfo(from)
  const needsCheck =
    source == null ||
    target.maxTile < source.maxTile ||
    target.maxWall < source.maxWall ||
    target.maxItem < source.maxItem ||
    target.maxNpc < source.maxNpc ||
    target.maxEntity < source.maxEntity
  if (needsCheck) {
    const used = usage ?? collectWorldUsage(src, track)
    const issue = worldContentIssues(target, used)[0]
    if (issue) throw new Error(worldContentIssueMessage(target, issue))
  }

  // 头部需要的「推导默认值」：天顶（<267 由醉汉 + 颠倒推导）与 251 的 NPC 解锁位（<251 由存在与否反推）。
  const info = parseWorld(src, {} as WorldTrack).info
  const defaults: ConvertDefaults = {
    zenith: info.specialSeeds.includes('drunk') && info.specialSeeds.includes('remix'),
  }
  if (from < 251 && to >= 251) {
    const npcIds = new Set(
      (parseWorldSections(src, track, from).npcList ?? []).map((entry) => entry.netId),
    )
    const order = [17, 38, 208, 207, 160, 19, 18, 663]
    defaults.npcUnlocks = Uint8Array.from(order.map((id) => (npcIds.has(id) ? 1 : 0)))
  }

  const replacements = new Map<number, Uint8Array>()
  replacements.set(1, convertHeader(src, track, from, to, defaults))

  // 294：箱子段格式变化。
  if (from < 294 !== to < 294) {
    const sections = parseWorldSections(src, track, from)
    if (!sections.chestList) throw new Error('箱子段读不动，无法转换版本')
    replacements.set(3, encodeChestsSection(sections.chestList as ChestWrite[], to))
  }

  // 268 / 315：NPC 段。
  if (from < 268 !== to < 268 || from < 315 !== to < 315) {
    const at = track.pointers[4] ?? 0
    const end = track.pointers[5] ?? track.footerAt
    if (!(end >= at && end <= src.length)) throw new Error('NPC 段定位失败，无法转换版本')
    replacements.set(5, convertNpcSection(src.slice(at, end), from, to))
  }

  // 307 / 308：图格实体段（假人）。
  if ((from < 307) !== (to < 307) || (from < 308) !== (to < 308)) {
    const at = track.pointers[5] ?? 0
    const end = track.pointers[6] ?? track.footerAt
    if (!(end >= at && end <= src.length)) throw new Error('图格实体段定位失败，无法转换版本')
    replacements.set(6, convertTileEntitySection(src.slice(at, end), from, to))
  }

  return rebuild(src, track, replacements, to)
}

/** 扫一遍世界内容，返回实际用到的最大 ID（图格 / 墙 / 箱子物品 / NPC / 图格实体）。 */
export function collectWorldUsage(
  data: ArrayBuffer | Uint8Array,
  track: WorldTrack,
): WorldContentUsage {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data)
  const usage: WorldContentUsage = { ...EMPTY_USAGE }
  const tile = scanTileWallMax(src)
  usage.tile = tile.tile
  usage.wall = tile.wall

  const sections = parseWorldSections(src, track, track.release)
  for (const chest of sections.chestList ?? []) {
    for (const item of chest.items) {
      if (item.id > usage.item) usage.item = item.id
    }
  }
  usage.npc = scanNpcMax(src, track)
  usage.entity = scanTileEntityMax(src, track)
  return usage
}

/**
 * 图格 / 墙的最大 ID。
 *
 * 字段顺序与 `worldThumb.ts` / `worldFind.ts` / `worldTileAt.ts` 的图格解码一致
 * （三处同一份规范，见 `docs/技术事实.md`）；这里只看 type / wall，不看 UV 与液体。
 */
function scanTileWallMax(src: Uint8Array): { tile: number; wall: number } {
  const parsed = parseWorld(src, {} as WorldTrack)
  const { width: w, height: h, release } = parsed.info
  const frameImportant = parsed.frameImportant
  let p = parsed.tilesAt
  let tile = 0
  let wall = 0

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (p >= src.length) throw new Error('图格数据不完整，无法检查内容兼容性')
      const h1 = src[p++]
      let h2 = 0
      let h3 = 0
      if (h1 & 0x01) {
        h2 = src[p++]
        if (h2 & 0x01) {
          h3 = src[p++]
          if (release >= 269 && h3 & 0x01) p++ // header4
        }
      }

      let wallLow = 0
      if (h1 & 0x02) {
        let type: number
        if (h1 & 0x20) {
          const lo = src[p++]
          const hi = src[p++]
          type = (hi << 8) | lo
        } else {
          type = src[p++]
        }
        if (type > tile) tile = type
        // 帧化图格带 U、V 各 int16。
        if (type >= frameImportant.length || frameImportant[type]) p += 4
        if (h3 & 0x08) p++ // 图格染料
      }
      if (h1 & 0x04) {
        wallLow = src[p++]
        if (h3 & 0x10) p++ // 墙染料
      }
      const liquidKind = (h1 & 0x18) >> 3
      if (liquidKind !== 0) p++ // 液体量
      // 墙 ID 高字节（header3 的 0x40，源码在液体之后读）。
      let wallId = wallLow
      if (h3 & 0x40) wallId = (src[p++] << 8) | wallLow
      if (wallId > wall) wall = wallId

      const rleKind = (h1 & 0xc0) >> 6
      if (rleKind === 1) y += src[p++]
      else if (rleKind === 2) {
        y += (src[p] | (src[p + 1] << 8)) << 16 >> 16
        p += 2
      }
    }
  }
  return { tile, wall }
}

/** NPC 段里出现过的最大 netID（微光列表 + 城镇 NPC + 保存/加载用 NPC）。 */
function scanNpcMax(src: Uint8Array, track: WorldTrack): number {
  const at = track.pointers[4] ?? 0
  const end = track.pointers[5] ?? track.footerAt
  if (!(end >= at && end <= src.length)) return 0
  const r = new ByteReader(src.subarray(at, end))
  const release = track.release
  let max = 0
  if (release >= 268) {
    const shimmered = r.i32()
    for (let i = 0; i < shimmered; i++) {
      const id = r.i32()
      if (id > max) max = id
    }
  }
  while (r.boolean()) {
    const id = r.i32()
    if (id > max) max = id
    r.str()
    r.skip(8 + 1 + 8)
    const flags = r.u8()
    if (flags & 1) r.skip(4)
    if (release >= 315) r.boolean()
  }
  while (r.boolean()) {
    const id = r.i32()
    if (id > max) max = id
    r.skip(8)
  }
  return max
}
