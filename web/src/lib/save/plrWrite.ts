/**
 * `.plr` 写回：**就地打补丁 + 原样重新加密**。
 *
 * 为什么不是「重新序列化整份存档」：`.plr` 的字段布局随 release 变化（59 个门槛），
 * 重写要把外观 / 银行 / 研究进度 / 配装 / 声音 / 退款队列全部重新序列化，任何一处写错都会毁档。
 * 而我们要改的字段都是**定长**（int32 / byte / bool），所以：
 *
 * 1. 解密 → 复制一份明文；
 * 2. 按 `PlrTrack` 记录的偏移改那几个字节（其余一字节不碰，明文长度不变）；
 * 3. 用 `PaddingMode.None` 重新加密（长度不变）。
 *
 * 于是**解密后的明文**与原文件除了被改的那几个字节一模一样，文件长度也不变
 * （注意：密文是 CBC 的，前面改一个块会让**之后所有密文块**都变——这是雪崩效应，不是内容变多）。
 * 文件尾部的补位块原样保留（读取端本来就不解析它）。
 * 依据见 `docs/技术事实.md` 与 `docs/计划-plr编辑.md` §2.1。
 */
import { aes128CbcEncrypt, PLR_AES_KEY } from './aes'
import {
  decryptPlr,
  type PlrBoostField,
  type PlrEquipContainer,
  type PlrStorageContainer,
  type PlrTrack,
} from './plr'

/** 一个背包槽位的目标状态（`id = 0` 表示清空）。 */
export interface PlrItemEdit {
  id: number
  stack: number
  prefix: number
}

/** 用户想做的一组改动：只放**要改**的字段，没给的保持原样。 */
export interface PlrEdits {
  release?: number
  difficulty?: number
  statLife?: number
  statLifeMax?: number
  statMana?: number
  statManaMax?: number
  anglerQuests?: number
  golferScore?: number
  boosts?: Partial<Record<PlrBoostField, boolean>>
  /** 矿车升级包两位（≥253 才存在）。 */
  superCart?: { unlocked: boolean; enabled: boolean }
  /** 背包槽位（键 = `.plr` 的 inventory 下标，0–57）。 */
  inventory?: Record<number, PlrItemEdit>
  /**
   * 装备区槽位（键 = 该容器里的下标）。这几组在文件里**只存 id + prefix**（没有 stack），
   * 所以 `stack` 会被忽略（编辑器那边也会把数量输入禁掉）。
   */
  equipment?: Partial<Record<PlrEquipContainer, Record<number, PlrItemEdit>>>
  /** 随身仓储（猪猪 / 保险箱 / 熔炉 / 虚空袋）：结构同背包，写 id + stack + prefix。 */
  storage?: Partial<Record<PlrStorageContainer, Record<number, PlrItemEdit>>>
  /** 三套配装：键 = 配装下标（0–2），`armor` 20 格 / `dye` 10 格。 */
  loadouts?: Record<number, { armor?: Record<number, PlrItemEdit>; dye?: Record<number, PlrItemEdit> }>
}

function i32(out: Uint8Array, pos: number, value: number): void {
  new DataView(out.buffer, out.byteOffset, out.byteLength).setInt32(pos, value, true)
}

function u8(out: Uint8Array, pos: number, value: number): void {
  out[pos] = value & 0xff
}

/**
 * 把编辑应用到原始 `.plr` 字节上，返回**新的** `.plr` 字节（不改动入参）。
 *
 * 偏移表必须来自同一份字节的 `parsePlr(data, track)`；缺偏移就直接抛错，
 * 绝不做「猜位置」的兜底（猜错就是毁档）。
 */
export function applyPlrEdits(
  data: ArrayBuffer | Uint8Array,
  track: PlrTrack,
  edits: PlrEdits,
): Uint8Array {
  const plain = decryptPlr(data).slice()
  const need = (pos: number | undefined, name: string): number => {
    if (pos == null) throw new Error(`${name}：这份存档没有这个字段，无法编辑`)
    return pos
  }

  if (edits.release != null) i32(plain, track.release, edits.release)
  if (edits.difficulty != null) u8(plain, need(track.difficulty, '模式'), edits.difficulty)
  if (edits.statLife != null) i32(plain, need(track.statLife, '生命'), edits.statLife)
  if (edits.statLifeMax != null) i32(plain, need(track.statLifeMax, '生命上限'), edits.statLifeMax)
  if (edits.statMana != null) i32(plain, need(track.statMana, '魔力'), edits.statMana)
  if (edits.statManaMax != null) i32(plain, need(track.statManaMax, '魔力上限'), edits.statManaMax)
  if (edits.anglerQuests != null) i32(plain, need(track.anglerQuests, '渔夫任务'), edits.anglerQuests)
  if (edits.golferScore != null) i32(plain, need(track.golferScore, 'Golf 分数'), edits.golferScore)

  for (const [key, on] of Object.entries(edits.boosts ?? {}) as [PlrBoostField, boolean][]) {
    u8(plain, need(track.boosts[key], key), on ? 1 : 0)
  }
  // 「火把神徽章」解锁与「生态火把启用」是两位：勾上/取消时一起写，否则进游戏看不出变化。
  const unlockTorches = edits.boosts?.unlockedBiomeTorches
  if (unlockTorches != null) {
    const pos = track.boosts.usingBiomeTorches
    if (pos != null) u8(plain, pos, unlockTorches ? 1 : 0)
  }

  if (edits.superCart) {
    const pos = need(track.superCartBits, '矿车升级包')
    const current = plain[pos] & 0xfc
    u8(plain, pos, current | (edits.superCart.unlocked ? 1 : 0) | (edits.superCart.enabled ? 2 : 0))
  }

  // 装备区：只写 id + prefix（该容器在文件里没有 stack 字段）。
  for (const [container, slots] of Object.entries(edits.equipment ?? {}) as [
    PlrEquipContainer,
    Record<number, PlrItemEdit>,
  ][]) {
    for (const [key, item] of Object.entries(slots)) {
      const slot = track.equipment[container]?.[Number(key)]
      if (!slot) throw new Error(`${container} 第 ${Number(key) + 1} 格不存在，无法编辑`)
      i32(plain, slot.id, item.id)
      u8(plain, slot.prefix, item.prefix)
    }
  }

  // 随身仓储：写 id + stack + prefix（结构与背包一致）
  for (const [container, slots] of Object.entries(edits.storage ?? {}) as [
    PlrStorageContainer,
    Record<number, PlrItemEdit>,
  ][]) {
    for (const [key, item] of Object.entries(slots)) {
      const slot = track.storage[container]?.[Number(key)]
      if (!slot) throw new Error(`${container} 第 ${Number(key) + 1} 格不存在，无法编辑`)
      i32(plain, slot.id, item.id)
      i32(plain, slot.stack, item.stack)
      u8(plain, slot.prefix, item.prefix)
    }
  }

  // 三套配装（结构同背包：id + stack + prefix）
  for (const [key, groups] of Object.entries(edits.loadouts ?? {})) {
    const loadout = track.loadouts[Number(key)]
    if (!loadout) throw new Error(`配装 ${Number(key) + 1} 不存在，无法编辑`)
    for (const group of ['armor', 'dye'] as const) {
      for (const [slotKey, item] of Object.entries(groups[group] ?? {})) {
        const slot = loadout[group][Number(slotKey)]
        if (!slot) throw new Error(`配装 ${Number(key) + 1} 的 ${group} 第 ${Number(slotKey) + 1} 格不存在`)
        i32(plain, slot.id, item.id)
        i32(plain, slot.stack, item.stack)
        u8(plain, slot.prefix, item.prefix)
      }
    }
  }

  for (const [key, item] of Object.entries(edits.inventory ?? {})) {
    const slot = track.inventory[Number(key)]
    if (!slot) throw new Error(`背包第 ${Number(key) + 1} 格不存在，无法编辑`)
    i32(plain, slot.id, item.id)
    i32(plain, slot.stack, item.stack)
    u8(plain, slot.prefix, item.prefix)
  }

  return aes128CbcEncrypt(PLR_AES_KEY, PLR_AES_KEY, plain)
}

/**
 * 两份 `.plr` **解密后**哪些字节不同（测试用：证明「只改了预期字段」）。
 *
 * 不比较密文：CBC 雪崩会让被改块之后的所有密文块都不同，那不能说明内容变了。
 */
export function changedPlainOffsets(a: Uint8Array, b: Uint8Array): number[] {
  const pa = decryptPlr(a)
  const pb = decryptPlr(b)
  const offsets: number[] = []
  const n = Math.min(pa.length, pb.length)
  for (let i = 0; i < n; i++) if (pa[i] !== pb[i]) offsets.push(i)
  return offsets
}
