/**
 * `.plr` **升级**（低版本存档 → 高版本存档）：只插入新版本多出来的字段，其余字节一字节不动。
 *
 * 为什么不是「重写整份序列化器」：`Player.Deserialize` 的 59 个门槛里，1.4.0 之后
 * 全是**只增不减**（见下表），所以升级 = 在若干已知位置插入定长块 / 整段默认值，
 * 不需要把研究进度 / 创意能力 / 配装 / BUFF / 重生点这些变长段重新序列化一遍。
 *
 * | 门槛 | 字段 | 插入量 | 默认值（游戏自己的取值） |
 * | --- | --- | --- | --- |
 * | 229 | `unlockedBiomeTorches` / `UsingBiomeTorches` | 2 | 0 / 0 |
 * | 230 | `builderAccStatus[11]` | 4 | 0 |
 * | 252 | BUFF 容量 22 → 44 | 176 | 22 个空位（游戏写端固定写满 44 对） |
 * | 253 | 矿车升级包位图 | 1 | 0 |
 * | 254 | PVE / PVP 死亡次数 | 8 | 0 / 0 |
 * | 255 | 虚空袋 40 格的 `favorited` | 40 | 0 |
 * | 256 | `ateArtisanBread` | 1 | 0 |
 * | 260 | 6 个 `used*` 药剂位 | 6 | 0 |
 * | 262 | 三套配装（`CurrentLoadoutIndex` + 3 × 30 格 + 隐藏位） | 844（目标 ≥322 时 934） | 空配装、下标 0 |
 * | 280 | `voiceVariant` | 1 | 男 1 / 女 2（`PlayerVariantID.Sets.Male`） |
 * | 281 | `voicePitchOffset` | 4 (float) | 0 |
 * | 282 | 研究进度前导 `bool` | 1 | false（游戏 `Save` 就写 false，读侧忽略） |
 * | 283 | `team` | 1 | 0（无队伍） |
 * | 300 | 退款队列条数 | 4 (int32) | 0（空队列） |
 * | 310 | 一次性对话条数 | 4 (int32) | 0 |
 * | 322 | 装备 / 染料 / 配装的 `favorited` | 120 | 0（未收藏） |
 * | 324 | 预留字节 | 1 | 0 |
 *
 * 事实来源：本机反编译源码 1.4.4.9 与 1.4.5.x 的 `Player.Deserialize` / `Serialize`、
 * `EquipmentLoadout.Deserialize`、`ItemsSacrificedUnlocksTracker.Load`（282 的门槛就在这里）、
 * `PlayerVariantID`；325 / 326 的结构由真实存档「写回后逐字节不变」反证（见 `localSaves.test.ts`）。
 *
 * **只做升级**：反方向要删字段（收藏位、退款队列、一次性对话…），必然丢数据，
 * 而且删除位置依赖变长段的真实内容，风险与收益不匹配 —— 显式拒绝，不静默毁档。
 */
import { aes128CbcEncrypt, PLR_AES_KEY } from './aes'
import { decryptPlr, isSameReleaseLayout, PLR_MAX_RELEASE, type PlrTrack } from './plr'

/**
 * 能双向转换的最低版本：1.4.0.1（release 220）。
 * 更早的版本要整段增删容器（虚空袋 / 熔炉 / 隐藏信息位 / 增益位），还没做 —— 显式拒绝。
 */
export const PLR_CONVERT_MIN_RELEASE = 220

/** 不能转换的原因（UI 用来给出具体文案，不抛裸字符串）。 */
export type PlrConvertProblem =
  | 'sameLayout'
  | 'sourceTooOld'
  | 'targetTooOld'
  | 'tooNew'
  | 'tailUnreadable'
  /** 退款队列非空：条目的字节长度在 1.4.5.8 里无法确认（手头源码只到 1.4.5.6），不猜。 */
  | 'refundsPresent'

/** 这些玩家变体是男性（`PlayerVariantID.Sets.Male = 0,1,2,3,8,10`）。 */
const MALE_VARIANTS = new Set([0, 1, 2, 3, 8, 10])

/**
 * 一次插入：`at` 是**原始明文**里的位置，`bytes` 插在它前面。
 * `order` 决定同一个位置上的先后（按文件里的真实顺序，不按门槛大小）：
 * 例如 `ateArtisanBread`(256) → 预留位(324) → 药剂位(260) 是三段连在一起的。
 */
interface Insertion {
  at: number
  bytes: Uint8Array
  order: number
}

const u8 = (value: number) => Uint8Array.of(value & 0xff)
const i32 = (value: number) => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setInt32(0, value, true)
  return out
}
const f32 = (value: number) => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setFloat32(0, value, true)
  return out
}

/**
 * 这份存档能不能转换成 `to`（`from`/`to` 都是存档版本号 `release`，双向）。
 *
 * 返回 `null` = 可以；否则是拒绝的理由。UI 与校验层共用这一份判断，避免两处口径不一致。
 */
export function checkPlrConvert(
  from: number,
  to: number,
  track?: Pick<PlrTrack, 'tailUnparsed' | 'anchors'>,
): PlrConvertProblem | null {
  if (to === from) return 'sameLayout'
  // 同一布局段内只是改数字，用不着转换。
  if (isSameReleaseLayout(from, to)) return 'sameLayout'
  if (to > PLR_MAX_RELEASE) return 'tooNew'
  if (from < PLR_CONVERT_MIN_RELEASE) return 'sourceTooOld'
  if (to < PLR_CONVERT_MIN_RELEASE) return 'targetTooOld'
  if (track && track.tailUnparsed) return 'tailUnreadable'
  if (track && (track.anchors?.tailStart == null || track.anchors?.researchStart == null)) {
    return 'tailUnreadable'
  }
  // 降级要删掉退款队列：条目长度不确定时不猜（升级方向只需要写「空队列」，不受影响）。
  if (track && to < 300 && (track.anchors?.refundCount ?? 0) > 0) return 'refundsPresent'
  return null
}

/**
 * 把 `data` 从它自己的版本升级到 `to`，返回**新的** `.plr` 字节（不改动入参）。
 *
 * `track` 必须来自同一份字节的 `parsePlr(data, track)`：所有插入点都从偏移表来，不猜位置。
 */
export function upgradePlr(
  data: ArrayBuffer | Uint8Array,
  track: PlrTrack,
  to: number,
): Uint8Array {
  const raw = data instanceof Uint8Array ? data : new Uint8Array(data)
  const plain = decryptPlr(raw)
  const from = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getInt32(0, true)
  const problem = checkPlrConvert(from, to, track)
  if (problem) throw new Error(`不能升级这个存档：${problem}（${from} → ${to}）`)

  const insertions: Insertion[] = []
  /** 只在「源没有、目标有」时插入。 */
  const want = (gate: number) => from < gate && to >= gate
  const add = (gate: number, at: number | undefined, bytes: Uint8Array, order: number, name: string) => {
    if (!want(gate)) return
    if (at == null) throw new Error(`存档缺少升级锚点：${name}`)
    insertions.push({ at, bytes, order })
  }

  // 头部：队伍（≥283），紧跟 hairDye 之后（hideVisibleAccessory 之前）
  add(283, track.anchors.afterHairDye, u8(0), 10, '队伍')

  // 永久增强区，文件里的真实顺序：生态火把(229) → 工匠面包(256) → 预留位(324) → 药剂位(260)。
  // 源已有的段要把游标推过它；插入的段按 `order` 落在同一位置的前面/后面。
  const afterExtra = track.boosts.extraAccessory
  if (afterExtra != null) {
    let cursor = afterExtra + 1
    if (from >= 229) cursor += 2
    add(229, cursor, Uint8Array.of(0, 0), 10, '生态火把解锁位')
    if (from >= 256) cursor += 1
    add(256, cursor, u8(0), 20, '工匠面包')
    if (from >= 324) cursor += 1
    add(324, cursor, u8(0), 30, '预留位')
    if (from >= 260) cursor += 6
    add(260, cursor, new Uint8Array(6), 40, '药剂位')
  }

  // 死亡次数（≥254）：紧跟税钱之后
  add(254, track.anchors.afterTaxMoney, new Uint8Array(8), 10, '死亡次数')

  // 收藏位（≥322）：装备 20 / 染料 10 / 配装 3×(20+10)，插在每个 prefix 之后。
  // 源版本 <262 时 `track.loadouts` 是空的 —— 那种情况配装是**整段新插入**的，
  // 收藏位已经在 `emptyLoadouts()` 里一起生成了。
  if (want(322)) {
    const slots = [
      ...(track.equipment.armor ?? []),
      ...(track.equipment.dye ?? []),
      ...track.loadouts.flatMap((loadout) => [...loadout.armor, ...loadout.dye]),
    ]
    if (slots.length === 0) throw new Error('存档缺少装备偏移表，无法升级收藏位')
    for (const slot of slots) insertions.push({ at: slot.prefix + 1, bytes: u8(0), order: 10 })
  }
  // 虚空袋 40 格的收藏位（≥255）
  if (want(255)) {
    const vault = track.storage.voidVault ?? []
    if (vault.length === 0) throw new Error('存档缺少虚空袋偏移表，无法升级收藏位')
    for (const slot of vault) insertions.push({ at: slot.prefix + 1, bytes: u8(0), order: 10 })
  }

  // BUFF 容量 22 → 44（≥252）：游戏写端固定写满，追加 22 个空位即可
  add(252, track.anchors.buffsEnd, new Uint8Array(22 * 8), 10, 'BUFF 容量')
  // 建造者状态多一格（≥230）
  add(230, track.anchors.builderAccEnd, new Uint8Array(4), 10, '建造者状态')
  // 研究进度前导 bool（≥282）
  add(282, track.anchors.researchStart, u8(0), 10, '研究进度前导位')

  // 变长尾段：矿车升级包(253) → 三套配装(262) → 声音(280) / 音调(281) / 退款队列(300) / 一次性对话(310)
  const tail = track.anchors.tailStart
  if (tail != null) {
    let cursor = from >= 253 ? tail + 1 : tail
    add(253, tail, u8(0), 10, '矿车升级包')
    if (from >= 262) cursor = track.anchors.loadoutsEnd ?? tail
    else add(262, cursor, emptyLoadouts(to >= 322), 20, '三套配装')

    const skinVariant = track.anchors.skinVariant == null ? -1 : plain[track.anchors.skinVariant]
    const voice = MALE_VARIANTS.has(skinVariant) ? 1 : 2
    if (from >= 280) cursor += 1
    add(280, cursor, u8(voice), 30, '声音变体')
    if (from >= 281) cursor += 4
    add(281, cursor, f32(0), 31, '音调')
    // 退款队列是变长的、本工具不读：源里有 300 却没有 310 时无法定位一次性对话段，只能拒绝。
    // 真实游戏版本不存在这种 release（1.4.5 之前没有 300，1.4.5.x 都已过 310）。
    if (from >= 300 && from < 310 && to >= 310) {
      throw new Error('无法升级这个存档：源版本含退款队列但不含一次性对话段')
    }
    add(300, cursor, i32(0), 32, '退款队列')
    add(310, cursor, i32(0), 33, '一次性对话')
  }

  insertions.sort((a, b) => a.at - b.at || a.order - b.order)
  const total = insertions.reduce((n, ins) => n + ins.bytes.length, 0)
  const out = new Uint8Array(plain.length + total)
  let src = 0
  let dst = 0
  for (const ins of insertions) {
    if (ins.at < src) throw new Error('升级插入点顺序异常')
    out.set(plain.subarray(src, ins.at), dst)
    dst += ins.at - src
    src = ins.at
    out.set(ins.bytes, dst)
    dst += ins.bytes.length
  }
  out.set(plain.subarray(src), dst)

  // 版本号本身也是升级的一部分（写回新版本号，否则游戏仍按旧布局读）。
  new DataView(out.buffer).setInt32(0, to, true)
  return aes128CbcEncrypt(PLR_AES_KEY, PLR_AES_KEY, padToBlock(out))
}

/**
 * 把 `data` 降到 `to`（更低的版本）：**删掉**目标版本没有的字段。
 *
 * 与升级对称 —— 删除位置同样全部来自 `track` 的偏移表，不猜。被删掉的都是「更晚版本才有的
 * 字段」，所以丢的是那些内容本身（收藏位 / 配装 / 退款队列 / 一次性对话 / 声音…），
 * 更早版本就存在的字段一字节不动。
 *
 * 依据：`Player.Deserialize` 的各门槛与 1.4.5.x / 1.4.4.9 源码；
 * 322/324 的字段长度由真实 325/326 存档的步长反证（装备 6 字节 / 配装物品 10 字节）。
 */
export function downgradePlr(
  data: ArrayBuffer | Uint8Array,
  track: PlrTrack,
  to: number,
): Uint8Array {
  const raw = data instanceof Uint8Array ? data : new Uint8Array(data)
  const plain = decryptPlr(raw)
  const from = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getInt32(0, true)
  const problem = checkPlrConvert(from, to, track)
  if (problem) throw new Error(`不能转换这个存档：${problem}（${from} → ${to}）`)
  if (to >= from) throw new Error('downgradePlr 只处理降到更低版本的情况')

  /** 需要删掉的字节区间（源明文坐标，闭开区间）。 */
  const cuts: [number, number][] = []
  /** 只在跨这个门槛（源有、目标没有）时删。 */
  const want = (gate: number) => from >= gate && to < gate
  const cut = (gate: number, start: number | undefined, len: number, name: string) => {
    if (!want(gate)) return
    if (start == null) throw new Error(`存档缺少降级锚点：${name}`)
    cuts.push([start, start + len])
  }
  const anchors = track.anchors

  // 头部：队伍（283）
  cut(283, anchors.afterHairDye, 1, '队伍')
  // 永久增强区（文件顺序：生态火把 → 工匠面包 → 预留位 → 药剂位）
  const extra = track.boosts.extraAccessory
  const torches = track.boosts.usingBiomeTorches
  const ate = track.boosts.ateArtisanBread
  cut(229, extra == null ? undefined : extra + 1, 2, '生态火把解锁位')
  cut(256, torches == null ? undefined : torches + 1, 1, '工匠面包')
  cut(324, ate == null ? undefined : ate + 1, 1, '预留位')
  // 药剂位在预留位之后（≥324 时），否则紧跟工匠面包
  const crystalsAt = ate == null ? undefined : ate + 1 + (from >= 324 ? 1 : 0)
  cut(260, crystalsAt, 6, '药剂位')
  // 死亡次数（254）
  cut(254, anchors.afterTaxMoney, 8, '死亡次数')
  // 收藏位（322）：装备 20 / 染料 10 / 配装 3×(20+10)，每格 1 字节
  if (want(322)) {
    const slots = [
      ...(track.equipment.armor ?? []),
      ...(track.equipment.dye ?? []),
      ...track.loadouts.flatMap((loadout) => [...loadout.armor, ...loadout.dye]),
    ]
    if (slots.length === 0) throw new Error('存档缺少装备偏移表，无法降级收藏位')
    for (const slot of slots) cuts.push([slot.prefix + 1, slot.prefix + 2])
  }
  // 虚空袋收藏位（255）
  if (want(255)) {
    const vault = track.storage.voidVault ?? []
    if (vault.length === 0) throw new Error('存档缺少虚空袋偏移表，无法降级收藏位')
    for (const slot of vault) cuts.push([slot.prefix + 1, slot.prefix + 2])
  }
  // BUFF 容量 44 → 22（252）：删最后 22 个空位
  cut(252, anchors.buffsEnd == null ? undefined : anchors.buffsEnd - 22 * 8, 22 * 8, 'BUFF 容量')
  // 建造者状态（230）：删第 12 格
  cut(230, anchors.builderAccEnd == null ? undefined : anchors.builderAccEnd - 4, 4, '建造者状态')
  // 研究进度前导 bool（282）
  cut(282, anchors.researchStart == null ? undefined : anchors.researchStart - 1, 1, '研究进度前导位')
  // 尾段（从后往前）：一次性对话(310) → 退款队列(300) → 音调(281) → 声音(280) → 配装(262) → 矿车包(253)
  const tailEnd = anchors.tailEnd
  cut(310, anchors.dialoguesAt, (tailEnd ?? 0) - (anchors.dialoguesAt ?? 0), '一次性对话')
  const refundsEnd = anchors.dialoguesAt ?? tailEnd
  if (want(300)) {
    if (anchors.refundsAt == null || refundsEnd == null) throw new Error('存档缺少降级锚点：退款队列')
    cuts.push([anchors.refundsAt, refundsEnd])
  }
  cut(281, anchors.pitchAt, 4, '音调')
  cut(280, anchors.voiceAt, 1, '声音变体')
  if (want(262)) {
    const start = anchors.tailStart == null ? undefined : anchors.tailStart + (from >= 253 ? 1 : 0)
    if (start == null || anchors.loadoutsEnd == null) throw new Error('存档缺少降级锚点：三套配装')
    cuts.push([start, anchors.loadoutsEnd])
  }
  cut(253, anchors.tailStart, 1, '矿车升级包')

  // 合并区间后一次性拷贝（区间之间不会重叠，除了同位置相邻的几段，合并更稳）
  cuts.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of cuts) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  const total = merged.reduce((n, [a, b]) => n + (b - a), 0)
  const out = new Uint8Array(plain.length - total)
  let src = 0
  let dst = 0
  for (const [start, end] of merged) {
    if (start < src || end > plain.length) throw new Error('降级删除区间异常')
    out.set(plain.subarray(src, start), dst)
    dst += start - src
    src = end
  }
  out.set(plain.subarray(src), dst)

  new DataView(out.buffer).setInt32(0, to, true)
  return aes128CbcEncrypt(PLR_AES_KEY, PLR_AES_KEY, padToBlock(out))
}

/**
 * 双向入口：目标版本更高走 `upgradePlr`（插入），更低走 `downgradePlr`（删除）。
 * 同一布局段内只需要改版本号，由调用方直接打补丁（不经过这里）。
 */
export function convertPlr(
  data: ArrayBuffer | Uint8Array,
  track: PlrTrack,
  to: number,
): Uint8Array {
  const raw = data instanceof Uint8Array ? data : new Uint8Array(data)
  const plain = decryptPlr(raw)
  const from = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getInt32(0, true)
  return to >= from ? upgradePlr(raw, track, to) : downgradePlr(raw, track, to)
}

/**
 * 三套空配装（≥262 新增的整段）：`CurrentLoadoutIndex` int32 + 3 × (20 装备 + 10 染料 + 10 隐藏位)。
 * 目标版本 ≥322 时每个物品还多一个 `favorited` 字节。
 */
function emptyLoadouts(withFavorited: boolean): Uint8Array {
  const item = withFavorited ? 10 : 9
  const perLoadout = (20 + 10) * item + 10
  const out = new Uint8Array(4 + 3 * perLoadout)
  return out // 全 0：下标 0、空格子（id/stack/prefix/fav 都是 0）、没有隐藏位
}

/**
 * 补位到 16 字节整数倍（游戏写端用 PKCS7，读端 `PaddingMode.None` 且读到最后一个字段就停，
 * 尾部补位块从不参与解析）。插入字段后长度不再对齐，必须重新补一次。
 */
function padToBlock(plain: Uint8Array): Uint8Array {
  const pad = (16 - (plain.length % 16)) % 16
  if (pad === 0) return plain
  const out = new Uint8Array(plain.length + pad)
  out.set(plain)
  out.fill(pad, plain.length)
  return out
}
