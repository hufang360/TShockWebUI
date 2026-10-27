/**
 * 本地 `.wld` 世界存档解析（**纯浏览器端**，文件不上传服务器）。
 *
 * 事实来源（反编译源码 Terraria 1.4.5.8）：
 * - 文件头：`Terraria.IO/WorldFile.cs` 的 `LoadFileFormatHeader` +
 *   `Terraria.IO/FileMetadata.cs` 的 `FileMetadata.Read`（7 字节魔数 `relogic` + 文件类型、
 *   `Revision`、收藏位）。**段指针记录的是「各段结束位置」**：`pointers[1]` 即图格段起点。
 * - 头部字段顺序与版本门槛：`WorldFile.LoadHeader`（世界选择界面的元数据也走这一串字段）。
 * - 图格流：`WorldFile.LoadWorldTiles` / `MapHelper.DecompressTileData`（RLE 同列向下重复）。
 * - 创建 / 最后游玩时间：`DateTime.ToBinary()`（100ns ticks，高 2 位是 Kind）。
 *
 * 版本支持：**140 … 326**（1.2.4 ~ 1.4.5.8）。更旧的是 V1 格式（没有 `relogic` 文件头、
 * 字段完全不同），明确拒绝并提示在游戏里重新保存。
 */
import { ByteReader, dotnetBinaryToIso, SaveFormatError } from './bytes'

const MIN_RELEASE = 140
const MAX_RELEASE = 326
const MAX_SIDE = 32768
const FILE_TYPE_WORLD = 2 // FileType：None=0 / Map=1 / World=2 / Player=3
const MAGIC = 'relogic'

/** 图格坐标（`-1,-1` 表示世界没有该地点，如空岛没有地牢）。 */
export interface WorldPoint {
  x: number
  y: number
}

/** 世界基本信息（「查看世界」页面展示的全部字段）。 */
export interface WorldInfo {
  /** 文件版本（对应游戏 1.4.x 存档版本号）。 */
  release: number
  /** 文件修订号（每次保存 +1）。 */
  revision: number
  favorite: boolean
  name: string
  seed: string
  worldGenVersion: number
  /** 世界唯一 ID（GUID）。 */
  guid: string
  worldId: number
  width: number
  height: number
  /** 0 普通 / 1 专家 / 2 大师 / 3 旅途。 */
  gameMode: number
  /** 特殊种子标记：drunk / worthy / anniversary / dontStarve / notTheBees / remix / noTraps / zenith / skyblock。 */
  specialSeeds: string[]
  /** corruption / crimson。 */
  evil: 'corruption' | 'crimson'
  hardmode: boolean
  /** 已击败的 Boss / 入侵（`downed*` 字段名转驼峰，如 `eyeOfCthulhu`）。 */
  bossesDowned: string[]
  spawn: WorldPoint
  dungeon: WorldPoint
  /** 当日时间（0–54000，4:30 起算）；只用于编辑态回填。 */
  time: number
  dayTime: boolean
  /** 月相 0–8。 */
  moonPhase: number
  bloodMoon: boolean
  eclipse: boolean
  groundLevel: number
  rockLevel: number
  /** ISO 时间（UTC）；存档没记录时为 null。 */
  createdAt: string | null
  lastPlayed: string | null
}

/** 一个可编辑字符串在文件里的位置：`pos` = 7 位长度前缀起始（绝对偏移），`size` = 含前缀的总字节数。 */
export interface WorldTrackString {
  pos: number
  size: number
}

/**
 * 可编辑字段的**绝对字节偏移**表（由 `parseWorld(data, track)` 记录）。
 *
 * `.wld` 没有加密，但**头部段长度一变，后面所有段都要平移、指针表要重写**，
 * 所以除了字段偏移，还要记下段指针表与 footer 的位置（见 `docs/计划-wld编辑.md` §2/§3）。
 */
export interface WorldTrack {
  /** 存档版本号（箱子段 `<294` 是共享容量、≥294 是每箱自带，重建时要按它选格式）。 */
  release: number
  /** 段数（= 指针个数）。 */
  sections: number
  /** 指针表起始（绝对偏移，指向第 0 个指针）。 */
  pointersAt: number
  /** 各段**结束**位置（绝对偏移，来自文件里的指针表）。 */
  pointers: number[]
  /** `FileMetadata.Revision` 的偏移（保存时 +1，与游戏一致）。 */
  revisionAt: number
  /** 头部段开始（= pointers[0]）与结束（= pointers[1]）。 */
  headerAt: number
  headerEnd: number
  /** footer 起始（= 最后一段结束位置）。 */
  footerAt: number
  worldId: number
  name: WorldTrackString
  /** 种子文本（release ≥ 180 才是字符串；179 是 int32，记不了就不给）。 */
  seed?: WorldTrackString
  /** 难度：>=209 是 int32，更早是 bool。 */
  gameMode?: number
  gameModeIsInt?: boolean
  spawn?: number
  time?: number
  dayTime?: number
  moonPhase?: number
  bloodMoon?: number
  eclipse?: number
  hardmode?: number
  /** Boss / 事件位（键与 `WorldInfo.bossesDowned` 一致）。 */
  bosses: Partial<Record<string, number>>
}

/** 解析结果：`info` 给页面展示，`tilesAt` / `frameImportant` 给缩略图渲染。 */
export interface ParsedWorld {
  info: WorldInfo
  /** 图格段起点（= 头部段结束位置）。 */
  tilesAt: number
  /** 图格是否「帧化」（带 UV 坐标）——决定图格条目里要不要跳过 4 字节。 */
  frameImportant: boolean[]
}

/** 把 16 字节 GUID 格式化（前三段小端，同 .NET `Guid.ToByteArray` 的顺序）。 */
function formatGuid(b: Uint8Array): string {
  const h = (v: number) => v.toString(16).padStart(2, '0')
  return (
    `${h(b[3])}${h(b[2])}${h(b[1])}${h(b[0])}-${h(b[5])}${h(b[4])}-${h(b[7])}${h(b[6])}-` +
    `${h(b[8])}${h(b[9])}-${h(b[10])}${h(b[11])}${h(b[12])}${h(b[13])}${h(b[14])}${h(b[15])}`
  )
}

/** 文件头 / 头部段的段指针说明见 `footerStartOf`。 */
function bad(message: string): SaveFormatError {
  return new SaveFormatError(`不是有效的 Terraria 世界存档: ${message}`)
}

/**
 * footer 起点 = 最后一个**有效**的段结束位置。
 *
 * 为什么不直接取 `pointers[sections - 1]`：老存档（release < 210）没有 bestiary / 创造之力段，
 * 但指针表长度是按新版固定写死的，多出来的槽位是 **0**（游戏读取端按版本号决定检查哪些槽，
 * 这些槽根本不看；footer 是**顺序读**的，不靠指针定位）。
 * 实测例：1.3.5.3（release 194）的世界 `Double Cross -zh.wld` 是 10 个指针，最后一个为 0。
 *
 * 顺带校验指针单调性：不单调说明头部损坏，宁可报错也不要「猜」一个位置去写（写错就毁档）。
 */
function footerStartOf(pointers: readonly number[], headerEnd: number, length: number): number {
  let at = headerEnd
  for (let i = 2; i < pointers.length; i++) {
    const p = pointers[i]
    if (p === 0) continue
    if (p < at) throw bad(`段指针顺序异常（第 ${i} 段：${p}）`)
    at = p
  }
  if (at <= headerEnd || at > length) throw bad('段指针异常：定位不到文件尾（footer）')
  return at
}

/** 解析 `.wld` 头部（第 0 / 1 段），返回世界信息 + 图格段位置。 */
export function parseWorld(data: ArrayBuffer | Uint8Array, track?: WorldTrack): ParsedWorld {
  const r = new ByteReader(data instanceof Uint8Array ? data : new Uint8Array(data))
  // 最快的拒绝：连文件头都放不下的文件不必再谈版本 / 结构。
  if (r.length < 64) throw bad('文件太小，不像是世界存档')

  const release = r.i32()
  // 先看魔数，才能区分「随便一个文件」和「真正更高版本的世界」。
  const magicOk =
    r.length >= 12 &&
    new TextDecoder().decode(r.buf.subarray(4, 11)) === MAGIC &&
    r.buf[11] === FILE_TYPE_WORLD
  if (release < MIN_RELEASE) {
    throw bad(`世界文件版本过旧（${release}，需 ${MIN_RELEASE}+）：请在游戏里打开并重新保存一次`)
  }
  if (release > MAX_RELEASE) {
    throw bad(
      magicOk
        ? `世界文件版本 ${release} 高于本工具支持的 ${MAX_RELEASE}（1.4.5.8）`
        : '不是 Terraria PC 世界存档（文件头不匹配）',
    )
  }
  if (!magicOk) throw bad('不是 Terraria PC 世界存档（文件头不匹配）')

  // 文件元数据：8 字节（7 字节魔数 + 类型）、Revision、收藏位。
  const head = r.bytes(8)
  if (new TextDecoder().decode(head.subarray(0, 7)) !== MAGIC || head[7] !== FILE_TYPE_WORLD) {
    throw bad('不是 Terraria PC 世界存档（文件头不匹配）')
  }
  const revisionAt = r.pos
  const revision = r.i32()
  const flags = r.u64()
  const favorite = (flags & 1) === 1

  // 段指针 + 图格 frame 表。
  const sections = r.i16()
  if (sections < 3 || sections > 32) throw bad(`段数异常（${sections}）`)
  const pointersAt = r.pos
  const pointers: number[] = []
  for (let i = 0; i < sections; i++) {
    const p = r.i32()
    if (p < 0 || p > r.length) throw bad(`段指针越界（第 ${i} 段：${p}）`)
    pointers.push(p)
  }
  const frameImportant = r.bits()
  if (r.pos !== pointers[0]) {
    throw bad(`文件头长度与段指针不一致（${r.pos} ≠ ${pointers[0]}）`)
  }

  const info: WorldInfo = {
    release,
    revision,
    favorite,
    name: '',
    seed: '',
    worldGenVersion: 0,
    guid: '',
    worldId: 0,
    width: 0,
    height: 0,
    gameMode: 0,
    specialSeeds: [],
    evil: 'corruption',
    hardmode: false,
    bossesDowned: [],
    spawn: { x: 0, y: 0 },
    dungeon: { x: 0, y: 0 },
    time: 0,
    dayTime: false,
    moonPhase: 0,
    bloodMoon: false,
    eclipse: false,
    groundLevel: 0,
    rockLevel: 0,
    createdAt: null,
    lastPlayed: null,
  }

  // 子表在这里初始化（与 `parsePlr` 一致）：调用方传 `{}` 就能用，不必知道内部结构。
  if (track) track.bosses = {}
  readHeaderFlags(r, info, track)

  if (r.pos !== pointers[1]) {
    throw bad(`头部字段长度与段指针不一致（${r.pos} ≠ ${pointers[1]}）`)
  }
  validate(info)
  if (track) {
    track.release = release
    track.sections = sections
    track.pointersAt = pointersAt
    track.pointers = pointers
    track.revisionAt = revisionAt
    track.headerAt = pointers[0] ?? 0
    track.headerEnd = pointers[1] ?? 0
    // 老存档（release < 210）没有 bestiary / 创造之力段，但指针表长度是按新版固定写死的，
    // 多出来的槽位写 **0**（游戏读取端按版本号决定要不要检查这些槽，根本不看）。
    // 所以 footer 起点 = 最后一个**有效**（> 0）的段结束位置，不能直接取 `pointers[sections-1]`。
    track.footerAt = footerStartOf(pointers, track.headerEnd, r.length)
    track.worldId = info.worldId
  }
  return { info, tilesAt: pointers[1], frameImportant }
}

/** 读头部字段（顺序逐条对照 `WorldFile.LoadHeader`；只支持 140+，低门槛的门槛恒成立）。 */
function readHeaderFlags(r: ByteReader, w: WorldInfo, track?: WorldTrack): void {
  /** 读一个 .NET 字符串；给了 track 就顺手记下它在文件里的位置与总字节数。 */
  const str = (): { value: string; span: WorldTrackString } => {
    const pos = r.pos
    const value = r.str()
    return { value, span: { pos, size: r.pos - pos } }
  }
  const name = str()
  w.name = name.value
  if (track) track.name = name.span

  if (w.release >= 179) {
    if (w.release === 179) {
      w.seed = String(r.i32()) // 179 的种子是 int32（不是字符串，不给编辑）
    } else {
      const seed = str()
      w.seed = seed.value
      if (track) track.seed = seed.span
    }
    w.worldGenVersion = r.u64()
  }
  if (w.release >= 181) w.guid = formatGuid(r.bytes(16))
  w.worldId = r.i32()
  r.skip(4 * 4) // leftWorld / rightWorld / topWorld / bottomWorld
  w.height = r.i32()
  w.width = r.i32()
  if (w.width <= 0 || w.height <= 0 || w.width > MAX_SIDE || w.height > MAX_SIDE) {
    throw bad(`世界尺寸异常（${w.width} × ${w.height}）`)
  }

  readDifficulty(r, w, track)

  // 创建 / 最后游玩时间（DateTime.ToBinary）。
  if (w.release >= 141) w.createdAt = dotnetBinaryToIso(r.i64b())
  if (w.release >= 284) w.lastPlayed = dotnetBinaryToIso(r.i64b())

  // moonType + 背景树 7 + 洞穴背景 8 + 冰/丛林/地狱背景 2（不展示，只消费）。
  r.skip(1 + 7 * 4 + 8 * 4 + 2 * 4)

  if (track) track.spawn = r.pos
  w.spawn = { x: r.i32(), y: r.i32() }
  w.groundLevel = r.f64()
  w.rockLevel = r.f64()
  // time / dayTime / moonPhase / bloodMoon / eclipse：编辑态要回填，所以始终读进来。
  if (track) track.time = r.pos
  w.time = r.f64()
  if (track) track.dayTime = r.pos
  w.dayTime = r.boolean()
  if (track) track.moonPhase = r.pos
  w.moonPhase = r.i32()
  if (track) track.bloodMoon = r.pos
  w.bloodMoon = r.boolean()
  if (track) track.eclipse = r.pos
  w.eclipse = r.boolean()
  w.dungeon = { x: r.i32(), y: r.i32() }
  w.evil = r.boolean() ? 'crimson' : 'corruption'

  readProgress(r, w, track)
}

/** 难度 + 特殊种子（游戏格式 209 起统一为 int32 GameMode）。 */
function readDifficulty(r: ByteReader, w: WorldInfo, track?: WorldTrack): void {
  if (w.release < 209) {
    if (track) {
      track.gameMode = r.pos
      track.gameModeIsInt = false
    }
    w.gameMode = r.boolean() ? 1 : 0
    return
  }
  if (track) {
    track.gameMode = r.pos
    track.gameModeIsInt = true
  }
  w.gameMode = r.i32()
  if (w.release < 222) return
  const seeds: Array<[string, number]> = [
    ['drunk', 222],
    ['worthy', 227],
    ['anniversary', 238],
    ['dontStarve', 239],
    ['notTheBees', 241],
    ['remix', 249],
    ['noTraps', 266],
  ]
  for (const [key, from] of seeds) {
    if (w.release >= from && r.boolean()) w.specialSeeds.push(key)
  }
  // 天顶世界：267 起单独存一位，之前由「醉汉 + 颠倒」推导。
  let zenith: boolean
  if (w.release >= 267) {
    zenith = r.boolean()
  } else {
    zenith = w.specialSeeds.includes('drunk') && w.specialSeeds.includes('remix')
  }
  if (zenith) w.specialSeeds.push('zenith')
  if (w.release >= 302 && r.boolean()) w.specialSeeds.push('skyblock')
}

/**
 * 可编辑的 Boss / 事件位，**顺序与 `WorldFile.LoadHeader` 的写序一致**（编辑面板按这个顺序渲染）。
 *
 * 只收录「玩家在游戏里能看到」的那些；万圣节/圣诞节 Boss、四柱、末日事件等内部位不开放编辑。
 */
export const WORLD_BOSS_KEYS = [
  'eyeOfCthulhu',
  'evilBoss',
  'skeletron',
  'queenBee',
  'destroyer',
  'twins',
  'skeletronPrime',
  'anyMech',
  'plantera',
  'golem',
  'slimeKing',
  'goblins',
  'frostLegion',
  'pirates',
  'dukeFishron',
  'martians',
  'lunaticCultist',
  'moonLord',
] as const

/** 读布尔位（版本 < from 时不消费）。 */
function flag(r: ByteReader, release: number, from: number): boolean {
  return release >= from ? r.boolean() : false
}

/** Boss / 事件进度 + 头部剩余字段（顺序同 `WorldFile.LoadHeader`）。 */
function readProgress(r: ByteReader, w: WorldInfo, track?: WorldTrack): void {
  const release = w.release
  const boss = (key: string) => {
    if (track) track.bosses[key] = r.pos
    if (r.boolean()) w.bossesDowned.push(key)
  }
  const skipFlag = () => {
    r.boolean()
  }

  for (const key of [
    'eyeOfCthulhu',
    'evilBoss', // 世界吞噬者 / 克苏鲁之脑（同一字段）
    'skeletron',
    'queenBee',
    'destroyer',
    'twins',
    'skeletronPrime',
    'anyMech',
    'plantera',
    'golem',
    'slimeKing',
  ]) {
    boss(key)
  }
  // savedGoblin / savedWizard / savedMech / downedGoblins / downedClown / downedFrost / downedPirates。
  for (const key of ['', '', '', 'goblins', '', 'frostLegion', 'pirates']) {
    if (key === '') skipFlag()
    else boss(key)
  }
  // shadowOrbSmashed / spawnMeteor / shadowOrbCount / altarCount / hardMode。
  r.skip(2 + 1 + 4)
  if (track) track.hardmode = r.pos
  w.hardmode = r.boolean()
  flag(r, release, 257) // afterPartyOfDoom
  // invasionDelay / invasionSize / invasionType / invasionX / slimeRainTime / sundialCooldown。
  r.skip(4 * 3 + 8 + 8 + 1)
  // raining / rainTime / maxRain / 矿石梯队 3 / 背景 8 / cloudBgActive / numClouds / windSpeed。
  r.skip(1 + 4 + 4 + 4 * 3 + 8 + 4 + 2 + 4)

  // 渔夫名单（int32 数量 + 名字串）。
  const anglers = r.i32()
  if (anglers < 0 || anglers > 1000) throw bad('渔夫名单长度异常')
  for (let i = 0; i < anglers; i++) r.str()
  // savedAngler / anglerQuest / savedStylist / savedTaxCollector /（>=201）savedGolfer /
  // invasionSizeStart / cultistDelay。
  r.skip(1 + 4 + 1 + 1)
  flag(r, release, 201) // savedGolfer
  r.skip(4 + 4)

  // 击杀横幅表（BannerSystem.Load）。
  const banners = r.i16()
  if (banners < 0) throw bad('击杀横幅表异常')
  r.skip(banners * 4)
  if (release >= 289) {
    const claimable = r.i16()
    if (claimable < 0) throw bad('可领取横幅表异常')
    r.skip(claimable * 2)
  }

  // fastForwardTimeToDawn / fishron / martians / ancientCultist / moonlord。
  skipFlag()
  for (const key of ['dukeFishron', 'martians', 'lunaticCultist', 'moonLord']) boss(key)
  // 万圣节 / 圣诞节事件 Boss（5 位）。
  for (let i = 0; i < 5; i++) skipFlag()
  // 四柱已击败 4 + 四柱激活 4 + 末日事件 1。
  for (let i = 0; i < 9; i++) skipFlag()

  consumeTail(r, release)
}

/** 消费头部收尾字段（不展示）：结束位置必须正好等于段指针，这本身就是对齐校验。 */
function consumeTail(r: ByteReader, release: number): void {
  const skip = (from: number, n: number) => {
    if (release >= from) r.skip(n)
  }
  const list = (from: number) => {
    if (release < from) return
    const n = r.i32()
    if (n < 0 || n > 4096) throw bad('头部列表长度异常')
    r.skip(n * 4)
  }

  skip(170, 2 + 4) // 派对 manual / genuine / cooldown
  list(170) // 正在庆祝的 NPC
  skip(174, 1 + 4 + 4 + 4) // 沙尘暴
  skip(178, 4) // 酒馆老板 + DD2 三层
  skip(195, 1) // MushroomBg
  skip(215, 1) // UnderworldBg
  skip(196, 3) // BgTree2/3/4
  skip(204, 1) // 战斗手册
  skip(207, 4 + 3) // 灯笼夜
  if (release >= 211) {
    // 树顶变化：只读 min(数量, 13) 个。
    let n = r.i32()
    if (n < 0 || n > 4096) throw bad('树顶样式长度异常')
    if (n > 13) n = 13
    r.skip(n * 4)
  }
  skip(212, 2) // 强制万圣节 / 圣诞节
  skip(216, 4 * 4) // 铜/铁/银/金梯队
  skip(217, 3) // 猫 / 狗 / 兔
  skip(223, 2) // 光之女皇 / 史莱姆皇后
  skip(240, 1) // 独眼巨鹿
  skip(250, 1) // 蓝史莱姆
  skip(251, 8) // 8 个 NPC 解锁
  skip(259, 1) // 战斗手册 2
  skip(260, 1) // 商贩背包
  skip(261, 7) // 7 种史莱姆
  skip(264, 1 + 1) // 日晷 + 月晷冷却
  skip(287, 2) // 永久万圣节 / 圣诞节
  skip(288, 1) // 吸血鬼种子
  skip(296, 1) // 感染种子
  skip(291, 4 + 4) // 流星雨 / 金币雨
  if (release >= 297) {
    r.skip(1) // 团队出生点种子
    const n = r.u8()
    r.skip(n * 4) // 每个出生点 int16 × 2
  }
  skip(304, 1) // 双地牢种子
  skip(323, 2) // 更多闪电 / 无闪电
  if (release >= 299 && release < 313) r.skip(4) // 已废弃字段
  if (release >= 299) r.str() // WorldManifestData
}

/** 取值范围校验：解析错位时这些值几乎必然离谱。 */
function validate(w: WorldInfo): void {
  const inWorld = (p: WorldPoint) => p.x >= 0 && p.x < w.width && p.y >= 0 && p.y < w.height
  if (!inWorld(w.spawn)) {
    throw bad(`出生点越界（${w.spawn.x},${w.spawn.y} / ${w.width}×${w.height}）`)
  }
  // 地牢允许 (-1,-1)（空岛 / 部分自定义世界没有地牢）。
  if ((w.dungeon.x >= 0 || w.dungeon.y >= 0) && !inWorld(w.dungeon)) {
    throw bad(`地牢坐标越界（${w.dungeon.x},${w.dungeon.y} / ${w.width}×${w.height}）`)
  }
  if (w.groundLevel < 0 || w.groundLevel > w.height) throw bad(`地表深度异常（${w.groundLevel}）`)
  if (w.rockLevel < 0 || w.rockLevel > w.height) throw bad(`岩石层深度异常（${w.rockLevel}）`)
  if (w.gameMode < 0 || w.gameMode > 3) throw bad(`难度取值异常（${w.gameMode}）`)
}
