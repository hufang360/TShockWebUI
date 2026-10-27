/**
 * 本地 `.plr` 角色存档解析（**纯浏览器端**，不上传服务器）。
 *
 * 事实来源（反编译源码 Terraria 1.4.5.8）：
 * - 加密：`Terraria/Player.cs` 的 `LoadPlayer` —— AES-128-CBC（`PaddingMode.None`），
 *   key 与 IV 均为 `ENCRYPTION_KEY`（`"h3y_gUyZ"` 的 UTF-16LE 字节）。
 * - 字段顺序：`Terraria/Player.cs` 的 `Deserialize`（release 门槛逐条对照）。
 * - 文件头：`Terraria.IO/FileMetadata`（release >= 135 时 20 字节：8 魔数+类型、revision、收藏位）。
 * - 颜色：`Terraria/Utils.cs` 的 `ReadRGB`（R、G、B 各一字节）。
 *
 * 只解析到「游戏时间 / Golf 分数」为止（见 `parsePlr` 末尾的说明），够展示外观 / 属性 / 背包 / 装备 / 银行 / BUFF；
 * 之后的**研究进度、临时槽、旅途创意能力、配装、声音、退款队列**未读（见 `docs/TODO.md`）。
 */
import type { PlayerItem, PlayerLook } from '@/lib/tshock'
import { aes128CbcDecrypt, PLR_AES_KEY } from './aes'
import { ByteReader, dotnetBinaryToIso, SaveFormatError } from './bytes'
import { playerGameVersion } from './playerVersions'

const FILE_MAGIC = 'relogic' // 文件头低 7 字节（`FileMetadata.Read` 的魔数）
const FILE_TYPE_PLAYER = 3
const MAX_RELEASE = 326 // Main.curRelease（1.4.5.8）
const MIN_RELEASE = 135 // 有 FileMetadata 的最早版本
const MAX_ITEM_ID = 10000 // 宽松上界：超过按空槽处理

interface Item {
  id: number
  stack: number
  prefix: number
  favorited: boolean
}

/** 可编辑的永久增强布尔字段（与 `lib/playerBoosts.ts` 的 `PlayerLook` 字段同名）。 */
export type PlrBoostField =
  | 'extraAccessory'
  | 'unlockedBiomeTorches'
  /** 生态火把是否启用（勾「火把神徽章」时一起写）。 */
  | 'usingBiomeTorches'
  | 'ateArtisanBread'
  | 'usedAegisCrystal'
  | 'usedAegisFruit'
  | 'usedArcaneCrystal'
  | 'usedGalaxyPearl'
  | 'usedGummyWorm'
  | 'usedAmbrosia'

/** 随身仓储容器（物品结构同背包：`id + stack + prefix(+收藏位)`）。 */
export type PlrStorageContainer = 'piggyBank' | 'safe' | 'forge' | 'voidVault'

/** 装备区容器（`.plr` 里这几组的物品只存 `id + prefix(+收藏位)`，没有 stack）。 */
export type PlrEquipContainer = 'armor' | 'dye' | 'miscEquips' | 'miscDyes'

/** 装备类槽位的字节偏移（`id` 是 int32，`prefix` 是紧随其后的 u8）。 */
export interface PlrEquipOffsets {
  id: number
  prefix: number
}

/** 背包槽位里可编辑字段的字节偏移。 */
export interface PlrSlotOffsets {
  /** int32 物品 id（0 = 空）。 */
  id: number
  /** int32 数量。 */
  stack: number
  /** u8 词缀 id（0 = 无）。 */
  prefix: number
}

/**
 * 可编辑字段的字节偏移表（由 `parsePlr` 记录）。
 *
 * 编辑采用「就地打补丁 + 重新加密」：只改这些偏移上的定长字段，
 * 其余字节（研究进度 / 配装 / 银行 / 退款队列…）原样保留，文件长度也不变。
 */
export interface PlrTrack {
  /** 文件头的存档版本号（永远在 0）。 */
  release: number
  difficulty?: number
  statLife?: number
  statLifeMax?: number
  statMana?: number
  statManaMax?: number
  anglerQuests?: number
  golferScore?: number
  /** 永久增强布尔位（各 1 字节）。 */
  boosts: Partial<Record<PlrBoostField, number>>
  /** 矿车升级包的位图字节（≥253）：bit0 已解锁 / bit1 已启用。 */
  superCartBits?: number
  /**
   * 尾部的变长结构（研究进度之后）**没能读出来**：`superCartBits` 等偏移全部缺席。
   * 组件要求定长字段之前的部分不受影响，属性和背包照常可看可改。
   */
  tailUnparsed?: boolean
  /** 背包 58 格（下标 = .plr 的 inventory 下标）。 */
  inventory: PlrSlotOffsets[]
  /** 装备 / 染料 / 杂项（每组的偏移表按下标）。 */
  equipment: Partial<Record<PlrEquipContainer, PlrEquipOffsets[]>>
  /** 随身仓储：猪猪 / 保险箱 / 熔炉 / 虚空袋（各 40 格）。 */
  storage: Partial<Record<PlrStorageContainer, PlrSlotOffsets[]>>
  /** 三套配装：每套 20 装备（前 10 装备 / 后 10 时装）+ 10 染料，物品结构同背包。 */
  loadouts: { armor: PlrSlotOffsets[]; dye: PlrSlotOffsets[] }[]
}

/** 一个“当前生效”的 BUFF（`buffTime` 单位是 tick，60 tick = 1 秒）。 */
export interface PlrBuff {
  type: number
  ticks: number
}

/** 一套配装（1.4.3 起，≥262）：20 装备（前 10 装备 / 后 10 时装）+ 10 染料 + 10 隐藏位。 */
export interface PlrLoadout {
  armor: Item[]
  dye: Item[]
  /** 该配装下「隐藏」的 10 个装备位（游戏里的眼睛图标）。 */
  hide: boolean[]
}

/** 该角色在某个世界里的重生点（`spX/spY/spI/spN`，按世界名 + worldID 区分）。 */
export interface PlrSpawn {
  x: number
  y: number
  worldId: number
  world: string
}

/** 解析结果（与后端 `plr.Player` 对齐，便于映射成 `PlayerLook`）。 */
export interface PlrPlayer {
  release: number
  name: string
  difficulty: number
  /** 游戏时长（.NET TimeSpan 的 tick，10^7 = 1 秒；release < 138 时为 0）。 */
  playTimeTicks: number
  /** 已研究的物品种类数（研究进度段的条数，≥218；尾部读不出来时不给）。 */
  researchedCount?: number
  /**
   * 研究进度明细（≥218）：`persistentId` 是物品的内部键名（如 `LifeCrystal`，
   * 与 `data/items.json` 的 `key` 完全一致，所以前端不用额外数据表就能对回物品）。
   */
  research?: { persistentId: string; count: number }[]
  /** 当前使用的配装下标（≥262；读不到时为 0）。 */
  currentLoadoutIndex: number
  /** 三套配装（≥262；尾部读不出来时为空数组）。 */
  loadouts: PlrLoadout[]
  hair: number
  hairDye: number
  skinVariant: number
  statLife: number
  statLifeMax: number
  statMana: number
  statManaMax: number
  extraAccessory: boolean
  unlockedBiomeTorches: boolean
  usingBiomeTorches: boolean
  ateArtisanBread: boolean
  usedAegisCrystal: boolean
  usedAegisFruit: boolean
  usedArcaneCrystal: boolean
  usedGalaxyPearl: boolean
  usedGummyWorm: boolean
  usedAmbrosia: boolean
  hairColor: [number, number, number]
  skinColor: [number, number, number]
  eyeColor: [number, number, number]
  shirtColor: [number, number, number]
  underShirtColor: [number, number, number]
  pantsColor: [number, number, number]
  shoeColor: [number, number, number]
  /** 税收金币（release >= 128）。 */
  taxMoney: number
  /** PVE / PVP 死亡次数（release >= 254；更早的存档为 0）。 */
  deathsPve: number
  deathsPvp: number
  buffs: PlrBuff[]
  spawns: PlrSpawn[]
  /** 渔夫任务完成次数（release >= 98）。 */
  anglerQuests: number
  /** Golf 累计分数（release >= 206）。 */
  golferScore: number
  /** 最后一次保存时间（`DateTime.ToBinary()`，0 = 未知）。 */
  lastSavedTicks: bigint
  /** 矿车升级包（≥253）：已解锁 / 已启用。 */
  unlockedSuperCart: boolean
  enabledSuperCart: boolean
  armor: Item[]
  dye: Item[]
  inventory: Item[]
  miscEquips: Item[]
  miscDyes: Item[]
  piggyBank: Item[]
  safe: Item[]
  forge: Item[]
  voidVault: Item[]
}

/** 一个各字段都为空的解析结果（`parsePlr` 的起点；测试里也用它拼 fixture）。 */
export function emptyPlrPlayer(): PlrPlayer {
  return {
    release: 0,
    name: '',
    difficulty: 0,
    playTimeTicks: 0,
    currentLoadoutIndex: 0,
    loadouts: [],
    hair: 0,
    hairDye: 0,
    skinVariant: 0,
    statLife: 0,
    statLifeMax: 0,
    statMana: 0,
    statManaMax: 0,
    extraAccessory: false,
    unlockedBiomeTorches: false,
    usingBiomeTorches: false,
    ateArtisanBread: false,
    usedAegisCrystal: false,
    usedAegisFruit: false,
    usedArcaneCrystal: false,
    usedGalaxyPearl: false,
    usedGummyWorm: false,
    usedAmbrosia: false,
    taxMoney: 0,
    deathsPve: 0,
    deathsPvp: 0,
    buffs: [],
    spawns: [],
    anglerQuests: 0,
    golferScore: 0,
    lastSavedTicks: 0n,
    unlockedSuperCart: false,
    enabledSuperCart: false,
    hairColor: [0, 0, 0],
    skinColor: [0, 0, 0],
    eyeColor: [0, 0, 0],
    shirtColor: [0, 0, 0],
    underShirtColor: [0, 0, 0],
    pantsColor: [0, 0, 0],
    shoeColor: [0, 0, 0],
    armor: [],
    dye: [],
    inventory: [],
    miscEquips: [],
    miscDyes: [],
    piggyBank: [],
    safe: [],
    forge: [],
    voidVault: [],
  }
}

function emptyItem(): Item {
  return { id: 0, stack: 0, prefix: 0, favorited: false }
}

function normalize(it: Item): Item {
  if (it.id <= 0 || it.id >= MAX_ITEM_ID) return emptyItem()
  return { ...it, stack: it.stack <= 0 ? 1 : it.stack }
}

/** 读「id + stack + prefix（+ favorited）」。 */
function readItemWithStack(r: ByteReader, favorited: boolean): Item {
  const it = { id: r.i32(), stack: r.i32(), prefix: r.u8(), favorited: false }
  if (favorited) it.favorited = r.boolean()
  return normalize(it)
}

/** 读「id + prefix（+ favorited）」（装备 / 染料）。 */
function readItemEquip(r: ByteReader, favorited: boolean): Item {
  const it = { id: r.i32(), stack: 0, prefix: r.u8(), favorited: false }
  if (favorited) it.favorited = r.boolean()
  return normalize(it)
}

function bytesToPayload(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

/** 解密 `.plr`（失败抛 `SaveFormatError`）。 */
export function decryptPlr(data: ArrayBuffer | Uint8Array): Uint8Array {
  const raw = bytesToPayload(data)
  if (raw.length === 0 || raw.length % 16 !== 0) {
    throw new SaveFormatError('不是有效的角色存档：文件长度不是 16 的整数倍')
  }
  try {
    return aes128CbcDecrypt(PLR_AES_KEY, PLR_AES_KEY, raw)
  } catch {
    throw new SaveFormatError('角色存档解密失败：不是有效的 .plr 文件')
  }
}

/**
 * `Player.Deserialize` 里所有 `release >= N` / `release < N` 的门槛（1.4.5.8，去重升序）。
 *
 * 用途：判断两个存档版本号「字段布局是否完全相同」。**同段内改版本号是安全的**（读出来的字段一样），
 * 跨段改就必然读偏 —— 那种「升降级」要重写整份存档，不属于本工具范围。
 */
export const PLAYER_RELEASE_GATES: readonly number[] = [
  6, 10, 11, 15, 16, 17, 20, 36, 38, 47, 58, 74, 81, 82, 83, 98, 107, 114, 115, 117, 119, 124, 125,
  128, 136, 138, 161, 162, 164, 167, 181, 182, 197, 198, 199, 200, 202, 206, 210, 214, 218, 220, 229,
  230, 249, 252, 253, 254, 255, 256, 260, 262, 280, 281, 283, 300, 310, 322, 324,
]

/** 某个 release 所在的「同布局段」：`[lo, hi]`（含两端）。 */
export function releaseSegment(release: number): { lo: number; hi: number } {
  const lo = PLAYER_RELEASE_GATES.filter((g) => g <= release).pop() ?? 0
  const hi = (PLAYER_RELEASE_GATES.find((g) => g > release) ?? Number.MAX_SAFE_INTEGER) - 1
  return { lo, hi }
}

/** 两个 release 的字段布局是否相同（同段 ⟹ 只改数字不会读偏）。 */
export function isSameReleaseLayout(a: number, b: number): boolean {
  const sa = releaseSegment(a)
  return b >= sa.lo && b <= sa.hi
}

/**
 * 解析本地 `.plr` 二进制。
 *
 * @param track 传入一个空对象可以顺带拿到**可编辑字段的字节偏移**（见 `PlrTrack`），
 *              编辑保存时用它就地打补丁，不需要重写整个序列化器。
 */
export function parsePlr(data: ArrayBuffer | Uint8Array, track?: PlrTrack): PlrPlayer {
  const r = new ByteReader(decryptPlr(data))
  const at = (key: keyof Omit<PlrTrack, 'boosts' | 'inventory'>, pos: number) => {
    if (track) (track as unknown as Record<string, number>)[key] = pos
  }
  const boostAt = (key: PlrBoostField, pos: number) => {
    if (track) track.boosts[key] = pos
  }
  if (track) {
    track.release = 0
    track.boosts = {}
    track.inventory = []
    track.equipment = {}
    track.storage = {}
    track.loadouts = []
  }
  const release = r.i32()
  if (release < MIN_RELEASE || release > MAX_RELEASE) {
    throw new SaveFormatError(`不支持的角色存档版本 ${release}（支持 ${MIN_RELEASE}–${MAX_RELEASE}）`)
  }
  // FileMetadata：8 字节（7 字节魔数 + 类型）、u32 revision、u64 收藏位。
  const magic = r.bytes(8)
  if (new TextDecoder().decode(magic.subarray(0, 7)) !== FILE_MAGIC) {
    throw new SaveFormatError('存档文件头不匹配：不是 Terraria 角色存档')
  }
  if (magic[7] !== FILE_TYPE_PLAYER) throw new SaveFormatError('存档文件类型不是角色')
  r.skip(4 + 8)

  const p: PlrPlayer = {
    ...emptyPlrPlayer(),
    release,
    name: r.str(),
  }

  if (release >= 17) {
    at('difficulty', r.pos)
    p.difficulty = r.u8()
  }
  if (release >= 138) p.playTimeTicks = r.i64() // 游玩时长（TimeSpan tick）
  p.hair = r.i32()
  if (p.hair >= 228) p.hair = 0
  if (release >= 82) p.hairDye = r.u8()
  if (release >= 283) r.skip(1) // team
  if (release >= 124) r.skip(2) // 隐藏装备位（12 位）
  else if (release >= 83) r.skip(1)
  if (release >= 119) r.skip(1) // hideMisc
  if (release >= 107) p.skinVariant = r.u8()

  at('statLife', r.pos)
  p.statLife = r.i32()
  at('statLifeMax', r.pos)
  p.statLifeMax = Math.min(r.i32(), 500)
  at('statMana', r.pos)
  p.statMana = r.i32()
  at('statManaMax', r.pos)
  p.statManaMax = Math.min(r.i32(), 200)

  if (release >= 125) {
    boostAt('extraAccessory', r.pos)
    p.extraAccessory = r.boolean()
  }
  if (release >= 229) {
    boostAt('unlockedBiomeTorches', r.pos)
    p.unlockedBiomeTorches = r.boolean()
    boostAt('usingBiomeTorches', r.pos)
    p.usingBiomeTorches = r.boolean()
    if (release >= 256) {
      boostAt('ateArtisanBread', r.pos)
      p.ateArtisanBread = r.boolean()
    }
    if (release >= 324) r.skip(1) // 预留位
    if (release >= 260) {
      const keys: PlrBoostField[] = [
        'usedAegisCrystal',
        'usedAegisFruit',
        'usedArcaneCrystal',
        'usedGalaxyPearl',
        'usedGummyWorm',
        'usedAmbrosia',
      ]
      for (const key of keys) {
        boostAt(key, r.pos)
        ;(p[key] as boolean) = r.boolean()
      }
    }
  }
  if (release >= 182) r.skip(1) // downedDD2EventAnyDifficulty
  if (release >= 128) p.taxMoney = r.i32()
  if (release >= 254) {
    p.deathsPve = r.i32()
    p.deathsPvp = r.i32()
  }

  p.hairColor = r.rgb()
  p.skinColor = r.rgb()
  p.eyeColor = r.rgb()
  p.shirtColor = r.rgb()
  p.underShirtColor = r.rgb()
  p.pantsColor = r.rgb()
  p.shoeColor = r.rgb()

  // 装备：20 个槽（1.4.4 起带收藏位）。
  const armorFav = release >= 322
  const equipAt = (container: PlrEquipContainer) => {
    if (!track) return
    const list = (track.equipment[container] ??= [])
    list.push({ id: r.pos, prefix: r.pos + 4 })
  }
  for (let i = 0; i < 20; i++) {
    equipAt('armor')
    p.armor.push(readItemEquip(r, armorFav))
  }
  if (release >= 47) {
    const count = release >= 124 ? 10 : release >= 81 ? 8 : 3
    for (let i = 0; i < count; i++) {
      equipAt('dye')
      p.dye.push(readItemEquip(r, armorFav))
    }
  }
  // 背包：58 格（1.3.0.1 起带收藏位）。偏移表按槽位记 id / stack / prefix 三个位置。
  const invFav = release >= 114
  for (let i = 0; i < 58; i++) {
    const idPos = r.pos
    const stackPos = idPos + 4
    const prefixPos = stackPos + 4
    if (track) track.inventory.push({ id: idPos, stack: stackPos, prefix: prefixPos })
    p.inventory.push(readItemWithStack(r, invFav))
  }
  if (release >= 117) {
    // 注意顺序：杂项装备与杂项染料是**交替**写的（mE0, mD0, mE1, mD1 …）
    for (let i = 0; i < 5; i++) {
      equipAt('miscEquips')
      p.miscEquips.push(readItemEquip(r, false))
      equipAt('miscDyes')
      p.miscDyes.push(readItemEquip(r, false))
    }
  }
  /** 读一个「仓储」格并记录偏移（结构同背包：id int32 + stack int32 + prefix u8）。 */
  const readStorage = (container: PlrStorageContainer, favorited: boolean) => {
    const idPos = r.pos
    if (track) (track.storage[container] ??= []).push({ id: idPos, stack: idPos + 4, prefix: idPos + 8 })
    return readItemWithStack(r, favorited)
  }
  for (let i = 0; i < 40; i++) p.piggyBank.push(readStorage('piggyBank', false))
  for (let i = 0; i < 40; i++) p.safe.push(readStorage('safe', false))
  if (release >= 182) for (let i = 0; i < 40; i++) p.forge.push(readStorage('forge', false))
  if (release >= 198) for (let i = 0; i < 40; i++) p.voidVault.push(readStorage('voidVault', release >= 255))
  if (release >= 199) r.skip(1) // voidVaultInfo（虚空袋解锁位）

  // 当前 BUFF：固定读「非零 BUFF 的数量」（读到 0 就丢弃并减少目标个数），与 `Deserialize` 的循环一致。
  if (release >= 11) {
    let want = release >= 252 ? 44 : release >= 74 ? 22 : 10
    for (let i = 0; i < want; i++) {
      const type = r.i32()
      const ticks = r.i32()
      if (type === 0) {
        i--
        want--
        continue
      }
      p.buffs.push({ type, ticks })
    }
  }

  // 重生点：按世界分开存（`spX == -1` 表示列表结束）。
  for (let i = 0; i < 200; i++) {
    const x = r.i32()
    if (x === -1) break
    p.spawns.push({ x, y: r.i32(), worldId: r.i32(), world: r.str() })
  }

  if (release >= 16) r.skip(1) // hbLocked（生命条锁定）
  if (release >= 115) r.skip(13) // hideInfo[13]（「帮助」里的信息开关）
  if (release >= 98) {
    at('anglerQuests', r.pos)
    p.anglerQuests = r.i32()
  }
  if (release >= 162) r.skip(4 * 4) // DpadRadial.Bindings[4]
  if (release >= 164) {
    const count = release >= 230 ? 12 : release >= 197 ? 11 : release >= 167 ? 10 : 8
    r.skip(count * 4) // builderAccStatus
  }
  if (release >= 181) r.skip(4) // bartenderQuestLog
  if (release >= 200) {
    const dead = r.boolean()
    if (dead) r.skip(4) // respawnTimer（只在死亡时写）
  }
  if (release >= 202) p.lastSavedTicks = r.i64b()
  if (release >= 206) {
    at('golferScore', r.pos)
    p.golferScore = r.i32()
  }

  // ── 之后是变长结构，为了读到「矿车升级包」的位图而跳过 ────────────────────
  // 读不动就停在这里（不抛错）：定长字段与背包已经全部读完，属性/背包照常可看可改；
  // 只把尾部相关的偏移留空（编辑器会把那几项标成不可改）。真实存档里见过没有
  // 前导 `bool` 的变体（第三方服务器改过的存档），硬报错会让整份存档打不开。
  // 原则不变：**读不出位置就不记偏移**，绝不猜（猜错写回去就是毁档）。
  try {
    readPlrTail(r, p, track, release)
  } catch {
    if (track) track.tailUnparsed = true
  }
  return p
}

/** 研究进度 → 4 个临时槽 → 旅途创意能力 → 矿车升级包位图（只为记录后者的偏移）。 */
function readPlrTail(r: ByteReader, p: PlrPlayer, track: PlrTrack | undefined, release: number): void {
  // 研究进度（`ItemsSacrificedUnlocksTracker`）：[bool 若 ≥282] + int32 条数 + 条数 ×(string + int32)。
  if (release >= 218) {
    if (release >= 282) r.skip(1)
    const count = r.i32()
    if (count < 0 || count > 20000) throw new SaveFormatError('存档数据不完整（研究进度条数异常）')
    p.researchedCount = count // 只用于展示「已研究 N 种」；后面几步失败也不影响这个数
    p.research = []
    for (let i = 0; i < count; i++) {
      p.research.push({ persistentId: r.str(), count: r.i32() })
    }
  }
  // 4 个临时槽：bit 位图 + 每个置位一个 Item（`Item.DeserializeFrom` = int32 id + int32 stack + u8 prefix）。
  if (release >= 214) {
    const bits = r.u8()
    let n = 0
    for (let b = 0; b < 4; b++) if (bits & (1 << b)) n++
    r.skip(n * 9)
  }
  // 旅途创意能力：`while (bool) { ushort id; payload }`；全游戏只有 3 个持久能力有 payload。
  if (release >= 220) {
    for (let guard = 0; r.boolean(); guard++) {
      if (guard > 64) throw new SaveFormatError('存档数据不完整（创意能力段异常）')
      const id = r.u16()
      if (id === 5 || id === 11) r.skip(1) // Godmode / FarPlacementRange：bool
      else if (id === 14) r.skip(4) // SpawnRateSlider：float
      else break // 未知 id：游戏自己也会 break，再往后位置就不可信了
    }
  }
  if (release >= 253) {
    if (track) track.superCartBits = r.pos
    const bits = r.u8()
    p.unlockedSuperCart = (bits & 1) !== 0
    p.enabledSuperCart = (bits & 2) !== 0
  }
  // 三套配装（≥262）：int32 当前下标 + 3 × (20 装备 + 10 染料 + 10 隐藏位)；
  // 配装里的物品是完整的 `Item.Serialize`（id + stack + prefix），收藏位只在 ≥322 才写。
  if (release >= 262) {
    const index = r.i32()
    p.currentLoadoutIndex = index >= 0 && index <= 2 ? index : 0
    const fav = release >= 322
    for (let i = 0; i < 3; i++) {
      const armorOffsets: PlrSlotOffsets[] = []
      const armor: Item[] = []
      for (let k = 0; k < 20; k++) {
        const idPos = r.pos
        if (track) armorOffsets.push({ id: idPos, stack: idPos + 4, prefix: idPos + 8 })
        armor.push(readItemWithStack(r, fav))
      }
      const dyeOffsets: PlrSlotOffsets[] = []
      const dye: Item[] = []
      for (let k = 0; k < 10; k++) {
        const idPos = r.pos
        if (track) dyeOffsets.push({ id: idPos, stack: idPos + 4, prefix: idPos + 8 })
        dye.push(readItemWithStack(r, fav))
      }
      const hide: boolean[] = []
      for (let k = 0; k < 10; k++) hide.push(r.boolean())
      if (track) track.loadouts.push({ armor: armorOffsets, dye: dyeOffsets })
      p.loadouts.push({ armor, dye, hide })
    }
  }
  // 再往后还有三套配装（Loadouts）、声音变体、退款队列、一次性对话 —— 本功能不展示也不编辑，故不读。
}

/**
 * 按 TShock `NetItem` 的槽位（0..349）铺成 350 格。
 *
 * 顺序见 `web/src/lib/playerSlots.ts`：背包 0–57 / 装备 59–78 / 染料 79–88 /
 * 杂项装备 89–93 / 杂项染料 94–98 / 猪猪 99–138 / 保险箱 139–178 / 垃圾桶 179（.plr 不存）/
 * 熔炉 180–219 / 虚空袋 220–259 / 三套配装 260–349（.plr 不读 → 空）。
 */
export function plrSlots(p: PlrPlayer): PlayerItem[] {
  const slots: PlayerItem[] = Array.from({ length: 350 }, (_, slot) => ({
    slot,
    id: 0,
    stack: 0,
    prefix: 0,
    favorited: false,
  }))
  // 与 Go 版 `Player.Slots()` 一致：原样搬运 id / stack / prefix / 收藏位
  // （装备类槽位的 stack 在 .plr 里本来就是 0）。
  const put = (start: number, items: Item[]) => {
    items.forEach((it, i) => {
      slots[start + i] = {
        slot: start + i,
        id: it.id,
        stack: it.stack,
        prefix: it.prefix,
        favorited: it.favorited,
      }
    })
  }
  put(0, p.inventory)
  put(59, p.armor)
  put(79, p.dye)
  put(89, p.miscEquips)
  put(94, p.miscDyes)
  put(99, p.piggyBank)
  put(139, p.safe)
  put(180, p.forge)
  put(220, p.voidVault)
  // 三套配装：TShock 的 260–349 与 `playerSlots.ts` 的 `loadoutColumns()` 对齐
  // （每套 30 格 = 装备 10 + 时装 10 + 染料 10）。
  p.loadouts.forEach((loadout, i) => {
    const start = 260 + i * 30
    put(start, loadout.armor.slice(0, 10))
    put(start + 10, loadout.armor.slice(10, 20))
    put(start + 20, loadout.dye)
  })
  return slots
}

/**
 * TShock / 游戏的颜色编码：int32 小端 RGBA（R=b0 G=b1 B=b2 A=b3），A 恒为 255。
 *
 * 用 `>>> 0` 保持**无符号**数值（与后端 JSON 一致）：前端 `lib/playerRender.ts`
 * 的 `decodeColor` 用 `>>>` / `&` 取分量，正负都能读，但契约上是 0..2^32-1。
 */
function encodeColor([r, g, b]: [number, number, number]): number {
  return (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0
}

/** `.plr` → 前端统一的 `PlayerLook`（与「玩家管理」的在线查看同一套渲染）。 */
export function plrToPlayerLook(p: PlrPlayer): PlayerLook {
  return {
    name: p.name,
    online: false,
    health: p.statLife,
    maxHealth: p.statLifeMax,
    mana: p.statMana,
    maxMana: p.statManaMax,
    items: plrSlots(p),
    skinVariant: p.skinVariant,
    hair: p.hair,
    hairDye: p.hairDye,
    hairColor: encodeColor(p.hairColor),
    pantsColor: encodeColor(p.pantsColor),
    shirtColor: encodeColor(p.shirtColor),
    underShirtColor: encodeColor(p.underShirtColor),
    shoeColor: encodeColor(p.shoeColor),
    skinColor: encodeColor(p.skinColor),
    eyeColor: encodeColor(p.eyeColor),
    extraSlot: p.extraAccessory,
    // 本地存档的补充信息（TShock `/pm/look` 不提供，缺省 undefined）。
    saveVersion: p.release,
    gameVersion: playerGameVersion(p.release) ?? undefined,
    difficulty: p.difficulty,
    playTimeTicks: p.playTimeTicks > 0 ? p.playTimeTicks : undefined,
    golferScore: p.golferScore,
    taxMoney: p.taxMoney,
    deathsPve: p.deathsPve,
    deathsPvp: p.deathsPvp,
    lastSaved: dotnetBinaryToIso(p.lastSavedTicks) ?? undefined,
    buffs: p.buffs,
    researchedCount: p.researchedCount,
    research: p.research,
    spawns: p.spawns.map((s) => ({ x: s.x, y: s.y, world: s.world, worldId: s.worldId })),
    // .plr 存的是「按世界分开」的重生点列表（`spX/spY/spI/spN`），这里只给当前展示用的那一对：
    // 本地单文件看不出「用户想看哪个世界」，所以保持 -1（界面隐藏），列表里交给调用方处理。
    spawnX: -1,
    spawnY: -1,
    questsCompleted: p.anglerQuests,
    usingBiomeTorches: p.usingBiomeTorches,
    happyFunTorchTime: false,
    unlockedBiomeTorches: p.unlockedBiomeTorches,
    currentLoadoutIndex: p.currentLoadoutIndex,
    ateArtisanBread: p.ateArtisanBread,
    usedAegisCrystal: p.usedAegisCrystal,
    usedAegisFruit: p.usedAegisFruit,
    usedArcaneCrystal: p.usedArcaneCrystal,
    usedGalaxyPearl: p.usedGalaxyPearl,
    usedGummyWorm: p.usedGummyWorm,
    usedAmbrosia: p.usedAmbrosia,
    unlockedSuperCart: p.unlockedSuperCart,
    enabledSuperCart: p.enabledSuperCart,
  }
}

/** 一步到位：本地 `.plr` 字节 → `PlayerLook`（解密 + 解析 + 映射）。 */
export function parsePlrFile(data: ArrayBuffer | Uint8Array): PlayerLook {
  return plrToPlayerLook(parsePlr(data))
}
