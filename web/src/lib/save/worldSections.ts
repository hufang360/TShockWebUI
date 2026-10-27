/**
 * 重写 `.wld` 的「箱子」/「招牌」段（W4）。
 *
 * 与图格替换（W3）不同，这两段里有**变长字符串**（箱子名 / 招牌文本），长度一变整段就变长，
 * 所以必须重建这一段 + 把它之后的所有段整体平移 + 重写段指针表（footer 里没有箱子/招牌数据，不用动）。
 *
 * 编码规则逐条照抄游戏的写入端（`WorldFile.SaveChests` / `SaveSigns`），顺序错一个字节就整段读偏：
 *
 * 箱子段：
 *   `int16 数量` → `release < 294` 时先一个**整段共享**的 `int16 容量` →
 *   每个箱子：`int32 x`、`int32 y`、`string 名字`、（≥294：`int32 容量`）→
 *   容量个格子：`int16 stack`（`0` = 空槽，**后面不跟任何字节**；`≠0` 时再 `int32 type` + `u8 prefix`）。
 *
 * 招牌段：`int16 数量` → 每块 `string 文本`、`int32 x`、`int32 y`。
 */
import type { ChestItemDetail } from './worldStats'
import { encodeDotNetString } from './worldWrite'

/** 要写进箱子段的一个箱子（`items` 只看 `slot / id / stack / prefix`，`slot < capacity`）。 */
export interface ChestWrite {
  x: number
  y: number
  name: string
  capacity: number
  items: ChestItemDetail[]
}

/** 要写进招牌段的一块招牌。 */
export interface SignWrite {
  text: string
  x: number
  y: number
}

function i16(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff)
}

function i32(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff)
}

function str(out: number[], value: string): void {
  for (const byte of encodeDotNetString(value)) out.push(byte)
}

/**
 * 生成箱子段。
 *
 * `release < 294` 的存档只有一个共享容量：取第一个箱子的 `capacity`（解析时就是这么读的），
 * 并且那时**每个箱子都不写自己的容量**。
 */
export function encodeChestsSection(chests: readonly ChestWrite[], release: number): Uint8Array {
  const out: number[] = []
  i16(out, chests.length)
  const shared = release < 294
  if (shared) i16(out, chests[0]?.capacity ?? 40)
  for (const chest of chests) {
    i32(out, chest.x)
    i32(out, chest.y)
    str(out, chest.name)
    const capacity = shared ? (chests[0]?.capacity ?? 40) : chest.capacity
    if (!shared) i32(out, chest.capacity)
    // 按格子顺序写；只写「非空」的 id/prefix（空槽只有一个 int16 0）
    const slots = new Array<ChestItemDetail | undefined>(capacity)
    for (const item of chest.items) {
      if (item.slot >= 0 && item.slot < capacity) slots[item.slot] = item
    }
    for (let slot = 0; slot < capacity; slot++) {
      const item = slots[slot]
      if (!item || item.id <= 0 || item.stack <= 0) {
        i16(out, 0)
        continue
      }
      // 负数 stack（「1 个但带词缀」）必须原样写回，否则重建就不再逐字节相同
      i16(out, item.rawStack ?? item.stack)
      i32(out, item.id)
      out.push(item.prefix & 0xff)
    }
  }
  return new Uint8Array(out)
}

/** 生成招牌段。 */
export function encodeSignsSection(signs: readonly SignWrite[]): Uint8Array {
  const out: number[] = []
  i16(out, signs.length)
  for (const sign of signs) {
    str(out, sign.text)
    i32(out, sign.x)
    i32(out, sign.y)
  }
  return new Uint8Array(out)
}
