// @vitest-environment node
/**
 * `.plr` 测试用的**派生**存档：不提交新的真实存档，而是把 1.4.5.8 的 fixture
 * 拆成 1.4.4（269）布局 —— 正好是升级的逆操作，于是「拆掉再升回去」可以逐字节对账。
 *
 * 只在测试里用（`*.test.ts` / `*.test.tsx` 通过 `@/test/plrSave` 引入），不进产物。
 */
import { readFileSync } from 'node:fs'
import { aes128CbcEncrypt, PLR_AES_KEY } from '@/lib/save/aes'
import { decryptPlr, parsePlr, type PlrTrack } from '@/lib/save/plr'

export const readPlr326 = (): Uint8Array =>
  new Uint8Array(readFileSync('src/lib/save/fixtures/webui-326.plr'))

const padToBlock = (plain: Uint8Array): Uint8Array => {
  const n = (16 - (plain.length % 16)) % 16
  if (n === 0) return plain
  const out = new Uint8Array(plain.length + n)
  out.set(plain)
  out.fill(n, plain.length)
  return out
}

/**
 * 1.4.5.8 → 1.4.4：删掉 262 之后新增的字节，版本号改成 269。
 *
 * 删的 8 类（136 字节）：声音 1 + 音调 4 + 退款队列 4 + 一次性对话 4（≥280/281/300/310）、
 * 研究进度前导 bool（282）、装备 20 + 染料 10 + 配装 90 个收藏位（322）、预留字节（324）、
 * 队伍字节（283）。
 */
export function stripTo144(source: Uint8Array = readPlr326()): {
  bytes: Uint8Array
  /** 被删掉的字节及其原值（用来断言「升级只插入、且默认值对得上」）。 */
  removed: { pos: number; value: number }[]
} {
  const track = {} as PlrTrack
  const player = parsePlr(source, track)
  if (player.release !== 326) throw new Error(`fixture 版本应是 326，实际 ${player.release}`)
  const plain = decryptPlr(source)
  const anchors = track.anchors
  const slots = [
    ...(track.equipment.armor ?? []),
    ...(track.equipment.dye ?? []),
    ...track.loadouts.flatMap((loadout) => [...loadout.armor, ...loadout.dye]),
  ]
  const cut = [
    ...Array.from({ length: 13 }, (_, i) => anchors.loadoutsEnd! + i),
    anchors.researchStart! - 1,
    ...slots.map((slot) => slot.prefix + 1),
    track.boosts.ateArtisanBread! + 1,
    anchors.afterHairDye!,
  ]
  const drop = new Set(cut)
  const kept = new Uint8Array(plain.length - cut.length)
  let dst = 0
  for (let i = 0; i < plain.length; i++) if (!drop.has(i)) kept[dst++] = plain[i]
  new DataView(kept.buffer).setInt32(0, 269, true)
  return {
    bytes: aes128CbcEncrypt(PLR_AES_KEY, PLR_AES_KEY, padToBlock(kept)),
    removed: cut.map((pos) => ({ pos, value: plain[pos] })),
  }
}
