/**
 * 测试用的合成世界存档（`.wld`）构造器：按游戏 `WorldFile.SaveWorld` 的写序生成 release 326 的
 * 一份最小世界（11 段，图格段只有我们关心的图格）。
 *
 * 只给单测用：让解析器在 CI 里也能被逐字段验证（真实世界文件太大，不入库）。
 * 字段顺序与 `web/src/lib/save/worldFile.ts` 的读取顺序一一对应。
 */

export interface TileSpec {
  /** 图格 ID（-1 = 空气）。 */
  typ: number
  /** 墙 ID（0 = 无）。 */
  wall?: number
  /** 液体类型（0 无 / 1 水 / 2 岩浆 / 3 蜂蜜 / 4 微光）。 */
  liquid?: number
  /** 液体量（0..255）。 */
  liquidAmount?: number
  /** 同列向下 RLE 重复次数。 */
  repeat?: number
}

export interface WorldSpec {
  width: number
  height: number
  tiles: (x: number, y: number) => TileSpec
  name?: string
  seed?: string
  release?: number
  /** 地表 / 岩石层深度（默认按高度比例，方便缩略图分区测试）。 */
  groundLevel?: number
  rockLevel?: number
}

class Writer {
  private bytes: number[] = []

  get length(): number {
    return this.bytes.length
  }

  u8(v: number) {
    this.bytes.push(v & 0xff)
  }

  bool(v: boolean) {
    this.u8(v ? 1 : 0)
  }

  i16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff)
  }

  u16(v: number) {
    this.i16(v)
  }

  i32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setInt32(0, v, true)
    this.bytes.push(...b)
  }

  u32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v, true)
    this.bytes.push(...b)
  }

  u64(v: bigint) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigUint64(0, v, true)
    this.bytes.push(...b)
  }

  f32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setFloat32(0, v, true)
    this.bytes.push(...b)
  }

  f64(v: number) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v, true)
    this.bytes.push(...b)
  }

  raw(v: ArrayLike<number>) {
    for (let i = 0; i < v.length; i++) this.bytes.push(v[i] & 0xff)
  }

  /** .NET `BinaryWriter.Write(string)`：7 位变长长度 + UTF-8。 */
  str(s: string) {
    const utf8 = new TextEncoder().encode(s)
    let n = utf8.length
    for (;;) {
      const b = n & 0x7f
      n >>= 7
      if (n > 0) this.u8(b | 0x80)
      else {
        this.u8(b)
        break
      }
    }
    this.raw(utf8)
  }

  patchU32(offset: number, v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v, true)
    for (let i = 0; i < 4; i++) this.bytes[offset + i] = b[i]
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

/** `DateTime.ToBinary()`（UTC Kind）：100ns ticks，高 2 位 = 1。 */
export function dotnetTicks(iso: string): bigint {
  const ms = new Date(iso).getTime()
  const epochTicks = 621355968000000000n
  return BigInt(ms) * 10000n + epochTicks + (1n << 62n)
}

/** 生成一份合成世界存档（release 326）。 */
export function buildWorld(spec: WorldSpec): Uint8Array {
  const {
    width,
    height,
    tiles,
    name = '合成世界',
    seed = 'seed-42',
    release = 326,
    groundLevel = Math.round(height * 0.3),
    rockLevel = Math.round(height * 0.6),
  } = spec
  const sections = 11
  const w = new Writer()

  w.i32(release)
  // 文件元数据：7 字节魔数 + 文件类型（World = 2）、Revision、收藏位。
  w.raw(new TextEncoder().encode('relogic'))
  w.u8(2)
  w.u32(7)
  w.u64(1n) // IsFavorite

  w.i16(sections)
  const pointerPos = w.length
  for (let i = 0; i < sections; i++) w.i32(0)
  // 图格 frame 表：图格 0 不帧化，图格 1 帧化（带 UV）。
  w.i16(2)
  w.u8(0b10)

  // ---- 第 1 段：头部字段 ----
  const section1 = w.length
  w.str(name)
  w.str(seed)
  w.u64(1400159338497n) // WorldGen
  w.raw([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) // GUID
  w.i32(4242) // WorldId
  for (let i = 0; i < 4; i++) w.i32(0) // left/right/top/bottom
  w.i32(height)
  w.i32(width)
  w.i32(1) // GameMode：专家
  w.bool(true) // drunk
  w.bool(false) // worthy
  w.bool(false) // anniversary
  w.bool(false) // dontStarve
  w.bool(false) // notTheBees
  w.bool(false) // remix
  w.bool(false) // noTraps
  w.bool(false) // zenith
  w.bool(false) // skyblock

  w.u64(dotnetTicks('2024-05-06T07:08:09Z'))
  w.u64(dotnetTicks('2025-01-02T03:04:05Z'))

  w.u8(0) // MoonType
  for (let i = 0; i < 7; i++) w.i32(0) // TreeX ×3 + TreeStyle ×4
  for (let i = 0; i < 8; i++) w.i32(0) // CaveBack ×3 + CaveBackStyle ×4 + IceBackStyle
  for (let i = 0; i < 2; i++) w.i32(0) // JungleBackStyle + HellBackStyle
  // 出生点 / 地牢按尺寸取合理值（小世界也不会越界，校验才不会被无关字段挡住）。
  w.i32(Math.floor(width * 0.6)) // SpawnX
  w.i32(Math.floor(height * 0.1)) // SpawnY
  w.f64(groundLevel)
  w.f64(rockLevel)
  w.f64(0) // Time
  w.bool(true) // DayTime
  w.i32(0) // MoonPhase
  w.bool(false) // BloodMoon
  w.bool(false) // IsEclipse
  w.i32(Math.max(0, width - 40)) // DungeonX
  w.i32(Math.min(70, height - 1)) // DungeonY
  w.bool(true) // IsCrimson
  // 11 个 Boss 位：只击败克苏鲁之眼 / 毁灭者 / 任意机械。
  // 克苏鲁之眼 / 邪恶 Boss（世界吞噬者或克苏鲁之脑）/ 毁灭者 / 任意机械。
  for (const on of [true, true, false, false, true, false, false, true, false, false, false]) w.bool(on)
  for (let i = 0; i < 7; i++) w.bool(false) // savedGoblin/wizard/mech + goblins/clown/frost/pirates
  w.bool(false) // shadowOrbSmashed
  w.bool(false) // spawnMeteor
  w.u8(0) // shadowOrbCount
  w.i32(3) // altarCount
  w.bool(true) // IsHardMode
  w.bool(false) // partyOfDoom
  w.i32(0) // invasionDelay
  w.i32(0) // invasionSize
  w.i32(0) // invasionType
  w.f64(-1) // invasionX
  w.f64(0) // slimeRainTime
  w.u8(0) // sundialCooldown
  w.bool(false) // IsRaining
  w.i32(0) // TempRainTime
  w.f32(0) // TempMaxRain
  for (let i = 0; i < 3; i++) w.i32(0) // 矿石梯队
  for (let i = 0; i < 8; i++) w.u8(0) // 背景样式
  w.i32(0) // cloudBgActive
  w.i16(0) // numClouds
  w.f32(0) // windSpeedSet
  w.i32(0) // anglers
  w.bool(false) // savedAngler
  w.i32(0) // anglerQuest
  w.bool(false) // savedStylist
  w.bool(false) // savedTaxCollector
  w.bool(false) // savedGolfer
  w.i32(0) // invasionSizeStart
  w.i32(0) // cultistDelay
  w.i16(0) // 击杀横幅
  w.i16(0) // 可领取横幅
  w.bool(false) // fastForwardTime
  w.bool(true) // dukeFishron
  w.bool(false) // martians
  w.bool(false) // lunaticCultist
  w.bool(true) // moonLord
  for (let i = 0; i < 5; i++) w.bool(false) // 万圣节 / 圣诞节 Boss
  for (let i = 0; i < 9; i++) w.bool(false) // 四柱已击败 / 激活 / 末日

  // ---- 头部收尾字段 ----
  w.bool(false) // 派对 manual
  w.bool(false) // 派对 genuine
  w.i32(0) // 派对冷却
  w.i32(0) // 正在庆祝的 NPC 数量
  w.bool(false) // 沙尘暴
  w.i32(0)
  w.f32(0)
  w.f32(0)
  for (let i = 0; i < 4; i++) w.bool(false) // 酒馆老板 + DD2 三层
  w.u8(0) // MushroomBg
  w.u8(0) // UnderworldBg
  w.u8(0) // BgTree2
  w.u8(0) // BgTree3
  w.u8(0) // BgTree4
  w.bool(false) // 战斗手册
  w.i32(0) // 灯笼夜冷却
  w.bool(false)
  w.bool(false)
  w.bool(false)
  w.i32(13) // 树顶样式数量
  for (let i = 0; i < 13; i++) w.i32(0)
  w.bool(false) // 强制万圣节
  w.bool(false) // 强制圣诞节
  for (let i = 0; i < 4; i++) w.i32(0) // 铜/铁/银/金梯队
  for (let i = 0; i < 3; i++) w.bool(false) // 猫 / 狗 / 兔
  w.bool(false) // 光之女皇
  w.bool(false) // 史莱姆皇后
  w.bool(false) // 独眼巨鹿
  w.bool(false) // 蓝史莱姆
  for (let i = 0; i < 8; i++) w.bool(false) // 8 个 NPC 解锁
  w.bool(false) // 战斗手册 2
  w.bool(false) // 商贩背包
  for (let i = 0; i < 7; i++) w.bool(false) // 7 种史莱姆
  w.bool(false) // 日晷
  w.u8(0) // 月晷冷却
  w.bool(false) // 永久万圣节
  w.bool(false) // 永久圣诞节
  w.bool(false) // 吸血鬼种子
  w.bool(false) // 感染种子
  w.i32(0) // 流星雨
  w.i32(0) // 金币雨
  w.bool(false) // 团队出生点种子
  w.u8(0) // 团队出生点数量
  w.bool(false) // 双地牢种子
  w.bool(false) // 更多闪电
  w.bool(false) // 无闪电
  w.str('') // WorldManifestData

  const section2 = w.length

  // ---- 第 2 段：图格 ----
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const t = tiles(x, y)
      writeTile(w, t)
      y += t.repeat ?? 0
    }
  }
  const end = w.length

  // 回填段指针：0 = 文件头结束、1 = 头部结束（= 图格段起点）、2 起指向末尾（本解析器不读）。
  const pointers = [section1, section2, section2, ...new Array(sections - 3).fill(end)]
  for (let i = 0; i < sections; i++) w.patchU32(pointerPos + i * 4, pointers[i])

  return w.toBytes()
}

function writeTile(w: Writer, s: TileSpec) {
  const typ = s.typ
  const wall = s.wall ?? 0
  const liquid = s.liquid ?? 0
  const repeat = s.repeat ?? 0
  // RLE 计数宽度：0 无 / 1 字节 / 2 int16（> 255 时必须用 int16）。
  const rleKind = repeat > 255 ? 2 : repeat > 0 ? 1 : 0
  let h1 = 0
  if (typ >= 0) h1 |= 0x02
  if (typ > 255) h1 |= 0x20
  if (wall > 0) h1 |= 0x04
  if (liquid > 0) h1 |= (liquid & 0x03) << 3
  h1 |= (rleKind & 0x03) << 6

  w.u8(h1)
  if (typ >= 0) {
    if (typ > 255) {
      w.u8(typ & 0xff)
      w.u8((typ >> 8) & 0xff)
    } else {
      w.u8(typ)
    }
    if (typ === 1) {
      // 图格 1 在 frame 表里标为「帧化」→ 带 U、V.
      w.i16(0)
      w.i16(0)
    }
  }
  if (wall > 0) w.u8(wall)
  if (liquid > 0) w.u8(s.liquidAmount ?? 255)
  if (rleKind === 1) w.u8(repeat)
  else if (rleKind === 2) w.i16(repeat)
}
