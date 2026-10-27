/**
 * 「地图分析」：世界存档的内容统计。
 *
 * 两类数据来源（见 `docs/功能-地图分析.md`）：
 * 1. **图格 / 墙 / 液体**：与缩略图**同一次解码**顺手累加（`worldThumb.ts`），不额外遍历 2000 万格；
 * 2. **箱子 / 招牌 / NPC / 图格实体**：按段指针切出各段，读各自的头部计数（箱子还会累加物品统计）。
 *
 * 段格式出处（1.4.5.8，`Terraria.IO/WorldFile.cs`）：
 * - `SaveChests`：`int16 数量`，每个箱子 `int x, int y, string name, int maxItems`，
 *   然后 `maxItems` 次 `int16 stack`（`stack > 0` 时再跟 `int32 type, u8 prefix`）；
 * - `SaveSigns`：`int16 数量`，每个 `string text, int x, int y`；
 * - `SaveNPCs`：`[int32 n + n×int32]`（≥268 的微光旅商）、然后 `bool` 循环的城镇 NPC、
 *   再一个 `bool` 循环（保存/加载用的 NPC）、最后 `false`；
 * - `SaveTileEntities`：`int32 数量` + 每个实体的类型相关内容（只读数量）。
 */
import { ByteReader } from './bytes'
import type { WorldTrack } from './worldFile'

/** 箱子里的一个非空物品（`slot` = 箱子内的格位，0–39）。 */
export interface ChestItemDetail {
  slot: number
  id: number
  stack: number
  prefix: number
  /**
   * 文件里原始的 `int16` 数量（可能是**负数**：游戏用「负 stack」表示「只有 1 个但带词缀」）。
   * 重建箱子段时必须写回原值，否则「原样重建」就不再逐字节相同。
   */
  rawStack?: number
}

/** 一个箱子（位置 + 非空内容）。 */
export interface ChestDetail {
  x: number
  y: number
  name: string
  items: ChestItemDetail[]
  /** 该箱子的格子数（≥294 每箱自带；更老是整段共享）——重建箱子段时要原样写回。 */
  capacity: number
}

/** 一块招牌。 */
export interface SignDetail {
  x: number
  y: number
  text: string
}

/** 一个城镇 NPC。 */
export interface NpcDetail {
  netId: number
  name: string
  x: number
  y: number
  homeX: number
  homeY: number
  homeless: boolean
}

/**
 * 世界各段的内容统计。
 *
 * 每项都可能是 `null`：段指针异常 / 该版本没有这一段 / 格式读不懂时，
 * 只隐藏对应那一项，不让整份「地图分析」失败。
 */
export interface WorldSections {
  chests: number | null
  /** 逐个箱子（明细，供下钻与导出）；读不到为 `null`。 */
  chestList: ChestDetail[] | null
  /** 招牌明细（含文本）。 */
  signList: SignDetail[] | null
  /** 城镇 NPC 明细。 */
  npcList: NpcDetail[] | null
  /** 箱子里的物品：物品 id → 总数量（只有 `stack > 0` 的才算）。 */
  chestItems: Map<number, number> | null
  /** 箱子里的物品种类数（去重 id 数）。 */
  chestItemKinds: number | null
  signs: number | null
  /** 城镇 NPC 数量（含已微光化的）。 */
  npcs: number | null
  tileEntities: number | null
}

interface SectionRange {
  start: number
  end: number
}

/**
 * 按段指针切出各段范围。
 *
 * `track.pointers[i]` = 第 i 段**结束**位置，所以第 i 段是 `[pointers[i-1], pointers[i])`；
 * 第 0 段（文件头）从 0 开始。
 */
function sectionRanges(track: WorldTrack): SectionRange[] {
  const ranges: SectionRange[] = []
  let start = 0
  for (const end of track.pointers) {
    ranges.push({ start, end })
    start = end
  }
  return ranges
}

/** 该段是否完整落在文件内（防御：段指针异常时不要越界读）。 */
function usable(range: SectionRange | undefined, length: number): range is SectionRange {
  return Boolean(range) && range!.start >= 0 && range!.end <= length && range!.end > range!.start
}

function reader(buf: Uint8Array, range: SectionRange): ByteReader {
  const slice = buf.subarray(range.start, range.end)
  return new ByteReader(slice)
}

/**
 * 箱子段：容量 + 逐个箱子明细 + 物品合并统计（坏数据时返回 `null`）。
 *
 * 两个版本门槛（`WorldFile.LoadChests`，少一个就会整段读偏）：
 * - `release < 294`：箱子容量是**整段共享的一个 `int16`**，写在箱子列表**之前**；≥294 才是每个箱子自带 `int32`；
 * - `stack < 0` 不是空槽：游戏用它表示「有词缀但只堆 1 个」，后面仍然跟着 `int32 id + u8 prefix`
 *   （只有 `stack == 0` 才是空槽）。
 */
function readChests(
  buf: Uint8Array,
  range: SectionRange | undefined,
  release: number,
): { chests: number; chestItems: Map<number, number>; chestList: ChestDetail[] } | null {
  if (!usable(range, buf.length)) return null
  try {
    const r = reader(buf, range)
    const count = r.i16()
    if (count < 0 || count > 8000) return null
    const sharedCapacity = release < 294 ? r.i16() : 0
    if (sharedCapacity < 0 || sharedCapacity > 200) return null
    const chestItems = new Map<number, number>()
    const chestList: ChestDetail[] = []
    for (let i = 0; i < count; i++) {
      const x = r.i32()
      const y = r.i32()
      const name = r.str()
      const maxItems = release >= 294 ? r.i32() : sharedCapacity
      if (maxItems < 0 || maxItems > 200) return null
      const items: ChestItemDetail[] = []
      for (let slot = 0; slot < maxItems; slot++) {
        const stack = r.i16()
        if (stack === 0) continue // 真正的空槽：后面不跟任何字节
        const type = r.i32()
        const prefix = r.u8()
        if (type <= 0) continue
        const n = stack < 0 ? 1 : stack // 负数 = 被压成 1 个（仍带词缀）
        chestItems.set(type, (chestItems.get(type) ?? 0) + n)
        items.push({ slot, id: type, stack: n, prefix, rawStack: stack })
      }
      chestList.push({ x, y, name, items, capacity: maxItems })
    }
    return { chests: count, chestItems, chestList }
  } catch {
    return null
  }
}

/** 招牌段：数量 + 文本明细。 */
function readSigns(
  buf: Uint8Array,
  range: SectionRange | undefined,
): { count: number; list: SignDetail[] } | null {
  if (!usable(range, buf.length)) return null
  try {
    const r = reader(buf, range)
    const count = r.i16()
    if (count < 0 || count > 32000) return null
    const list: SignDetail[] = []
    for (let i = 0; i < count; i++) {
      const text = r.str()
      const x = r.i32()
      const y = r.i32()
      list.push({ x, y, text })
    }
    return { count, list }
  } catch {
    return null
  }
}

/**
 * 城镇 NPC 数量（含微光化旅商的 id 列表 + 两个 bool 循环）。
 *
 * 字段门槛逐条照抄 `WorldFile.LoadNPCs`（1.4.5.8），一个都不能省——省一个就会把后面所有 NPC 读偏
 * （真实验证时 1.4.3 的世界就是这样读出一串乱码名字）：
 * - `release >= 268` 才有开头的「微光化城镇 NPC netID 列表」；
 * - `release >= 213` 才有 `townNpcVariation` 那个 `BitsByte`（bit0 后有 4 字节索引）；
 * - `release >= 315` 才有 `homelessDespawn` 布尔位；
 * - `release < 190` 的 netID 存的是**旧版名字字符串**（`NPCID.FromLegacyName`），本工具没有那张映射表，
 *   就跳过字符串、`netId` 记 0（名字本身仍是有效的 `GivenName`）。
 */
function readNpcs(
  buf: Uint8Array,
  range: SectionRange | undefined,
  release: number,
): { count: number; list: NpcDetail[] } | null {
  if (!usable(range, buf.length)) return null
  try {
    const r = reader(buf, range)
    /** ≥190 是 int32 netID；更老的是旧版名字字符串。 */
    const netId = (): number => (release >= 190 ? r.i32() : (r.str(), 0))
    // ≥268：微光化城镇 NPC 的 netID 列表（更老的存档没有这一段）
    let shimmered = 0
    if (release >= 268) {
      shimmered = r.i32()
      if (shimmered < 0 || shimmered > 200) return null
      for (let i = 0; i < shimmered; i++) r.i32()
    }
    const list: NpcDetail[] = []
    while (r.boolean()) {
      const id = netId()
      const name = r.str()
      const x = r.f32()
      const y = r.f32()
      const homeless = r.boolean()
      const homeX = r.i32()
      const homeY = r.i32()
      if (release >= 213) {
        const flags = r.u8()
        if (flags & 1) r.skip(4) // townNpcVariationIndex（int32）
      }
      if (release >= 315) r.boolean() // homelessDespawn
      list.push({ netId: id, name, x, y, homeX, homeY, homeless })
      if (list.length > 200) return null
    }
    // 第二个循环：保存/加载用 NPC（数量不计入「城镇 NPC」）
    let others = 0
    while (r.boolean()) {
      netId()
      r.skip(4 + 4) // position
      if (++others > 500) return null
    }
    // 微光化的城镇 NPC 只有 id 没有名字 / 坐标：数量算上，明细里不出现。
    return { count: list.length + shimmered, list }
  } catch {
    return null
  }
}

/** 图格实体段：只读第一个 int32（数量）。 */
function readTileEntities(buf: Uint8Array, range: SectionRange | undefined): number | null {
  if (!usable(range, buf.length)) return null
  try {
    const n = reader(buf, range).i32()
    return n >= 0 && n <= 100_000 ? n : null
  } catch {
    return null
  }
}

/**
 * 解析各段的统计（箱子 / 招牌 / NPC / 图格实体）。
 *
 * 段指针来自同一份字节的 `parseWorld(bytes, track)`；某段读不动时对应项为 `null`
 * （界面只隐藏那一项，不让整份分析失败）。
 */
export function parseWorldSections(
  data: ArrayBuffer | Uint8Array,
  track: WorldTrack,
  release: number,
): WorldSections {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  const ranges = sectionRanges(track)
  // 段顺序：0 文件头 / 1 头部 / 2 图格 / 3 箱子 / 4 招牌 / 5 NPC / 6 图格实体
  const chests = readChests(buf, ranges[3], release)
  const chestItems = chests?.chestItems ?? null
  const signs = readSigns(buf, ranges[4])
  const npcs = readNpcs(buf, ranges[5], release)
  return {
    chests: chests?.chests ?? null,
    chestList: chests?.chestList ?? null,
    chestItems,
    chestItemKinds: chestItems ? chestItems.size : null,
    signs: signs?.count ?? null,
    signList: signs?.list ?? null,
    npcs: npcs?.count ?? null,
    npcList: npcs?.list ?? null,
    tileEntities: readTileEntities(buf, ranges[6]),
  }
}
