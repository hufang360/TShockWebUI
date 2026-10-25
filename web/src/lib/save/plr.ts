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
 * 只解析到「随身仓储（voidVault）」结束，够展示外观 / 属性 / 背包 / 装备 / 银行；
 * 之后的 buff、出生点、配装不读（本功能只展示）。
 */
import type { PlayerItem, PlayerLook } from '@/lib/tshock'
import { aes128CbcDecrypt, PLR_AES_KEY } from './aes'
import { ByteReader, SaveFormatError } from './bytes'

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

/** 解析结果（与后端 `plr.Player` 对齐，便于映射成 `PlayerLook`）。 */
export interface PlrPlayer {
  release: number
  name: string
  difficulty: number
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

/** 解析本地 `.plr` 二进制。 */
export function parsePlr(data: ArrayBuffer | Uint8Array): PlrPlayer {
  const r = new ByteReader(decryptPlr(data))
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
    release,
    name: r.str(),
    difficulty: 0,
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

  if (release >= 17) p.difficulty = r.u8()
  if (release >= 138) r.skip(8) // 游玩时长
  p.hair = r.i32()
  if (p.hair >= 228) p.hair = 0
  if (release >= 82) p.hairDye = r.u8()
  if (release >= 283) r.skip(1) // team
  if (release >= 124) r.skip(2) // 隐藏装备位（12 位）
  else if (release >= 83) r.skip(1)
  if (release >= 119) r.skip(1) // hideMisc
  if (release >= 107) p.skinVariant = r.u8()

  p.statLife = r.i32()
  p.statLifeMax = Math.min(r.i32(), 500)
  p.statMana = r.i32()
  p.statManaMax = Math.min(r.i32(), 200)

  if (release >= 125) p.extraAccessory = r.boolean()
  if (release >= 229) {
    p.unlockedBiomeTorches = r.boolean()
    p.usingBiomeTorches = r.boolean()
    if (release >= 256) p.ateArtisanBread = r.boolean()
    if (release >= 324) r.skip(1) // 预留位
    if (release >= 260) {
      p.usedAegisCrystal = r.boolean()
      p.usedAegisFruit = r.boolean()
      p.usedArcaneCrystal = r.boolean()
      p.usedGalaxyPearl = r.boolean()
      p.usedGummyWorm = r.boolean()
      p.usedAmbrosia = r.boolean()
    }
  }
  if (release >= 182) r.skip(1) // downedDD2EventAnyDifficulty
  if (release >= 128) r.skip(4) // taxMoney
  if (release >= 254) r.skip(8) // PVE / PVP 死亡次数

  p.hairColor = r.rgb()
  p.skinColor = r.rgb()
  p.eyeColor = r.rgb()
  p.shirtColor = r.rgb()
  p.underShirtColor = r.rgb()
  p.pantsColor = r.rgb()
  p.shoeColor = r.rgb()

  // 装备：20 个槽（1.4.4 起带收藏位）。
  const armorFav = release >= 322
  for (let i = 0; i < 20; i++) p.armor.push(readItemEquip(r, armorFav))
  if (release >= 47) {
    const dyeCount = release >= 124 ? 10 : release >= 81 ? 8 : 3
    for (let i = 0; i < dyeCount; i++) p.dye.push(readItemEquip(r, armorFav))
  }
  // 背包：58 格（1.3.0.1 起带收藏位）。
  for (let i = 0; i < 58; i++) p.inventory.push(readItemWithStack(r, release >= 114))
  if (release >= 117) {
    for (let i = 0; i < 5; i++) {
      p.miscEquips.push(readItemEquip(r, false))
      p.miscDyes.push(readItemEquip(r, false))
    }
  }
  for (let i = 0; i < 40; i++) p.piggyBank.push(readItemWithStack(r, false))
  for (let i = 0; i < 40; i++) p.safe.push(readItemWithStack(r, false))
  if (release >= 182) for (let i = 0; i < 40; i++) p.forge.push(readItemWithStack(r, false))
  if (release >= 198) for (let i = 0; i < 40; i++) p.voidVault.push(readItemWithStack(r, release >= 255))

  return p
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
    // .plr 不存出生点（游戏里存在世界侧），固定 -1 让 UI 隐藏该项。
    spawnX: -1,
    spawnY: -1,
    questsCompleted: 0,
    usingBiomeTorches: p.usingBiomeTorches,
    happyFunTorchTime: false,
    unlockedBiomeTorches: p.unlockedBiomeTorches,
    currentLoadoutIndex: 0,
    ateArtisanBread: p.ateArtisanBread,
    usedAegisCrystal: p.usedAegisCrystal,
    usedAegisFruit: p.usedAegisFruit,
    usedArcaneCrystal: p.usedArcaneCrystal,
    usedGalaxyPearl: p.usedGalaxyPearl,
    usedGummyWorm: p.usedGummyWorm,
    usedAmbrosia: p.usedAmbrosia,
    unlockedSuperCart: false,
    enabledSuperCart: false,
  }
}

/** 一步到位：本地 `.plr` 字节 → `PlayerLook`（解密 + 解析 + 映射）。 */
export function parsePlrFile(data: ArrayBuffer | Uint8Array): PlayerLook {
  return plrToPlayerLook(parsePlr(data))
}
