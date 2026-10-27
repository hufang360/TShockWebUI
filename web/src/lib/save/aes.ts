/**
 * 最小 AES-128-CBC **加解密**实现，给 `.plr` 角色存档用（读取 + 编辑后另存）。
 *
 * 为什么不用 `crypto.subtle`：
 * - 读：WebCrypto 的 AES-CBC 一定会按 PKCS#7 去填充，而 Terraria 读取端是
 *   `RijndaelManaged` + `PaddingMode.None`（尾部那点补位块不参与解析），直接调会抛「填充非法」；
 * - 写：我们只改定长字段，明文长度不变，需要用**无填充**重新加密，保证输出除改动处外与原文件逐字节相同。
 * 所以这里自带一份无填充的原始 CBC（见 `docs/技术事实.md`「角色存档（.plr）」）。
 *
 * 事实来源：`Terraria/Player.cs` 的 `LoadPlayer` —— AES-128-CBC，
 * key 与 IV 均为 `UnicodeEncoding().GetBytes("h3y_gUyZ")`（UTF-16LE，16 字节）。
 */

/** 角色存档的 key / IV（"h3y_gUyZ" 的 UTF-16LE 字节）。 */
export const PLR_AES_KEY = new Uint8Array([
  0x68, 0x00, 0x33, 0x00, 0x79, 0x00, 0x5f, 0x00, 0x67, 0x00, 0x55, 0x00, 0x79, 0x00, 0x5a, 0x00,
])

const SBOX = new Uint8Array(256)
const INV_SBOX = new Uint8Array(256)
;(() => {
  // 用 GF(2^8) 乘法逆元 + 仿射变换生成 S 盒（避免手抄 256 个常量出错）。
  const rotl8 = (x: number, n: number) => ((x << n) | (x >> (8 - n))) & 0xff
  const mul = (a: number, b: number) => {
    let p = 0
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a
      const hi = a & 0x80
      a = (a << 1) & 0xff
      if (hi) a ^= 0x1b
      b >>= 1
    }
    return p
  }
  const inv = (x: number) => {
    if (x === 0) return 0
    for (let y = 1; y < 256; y++) {
      if (mul(x, y) === 1) return y
    }
    return 0
  }
  for (let i = 0; i < 256; i++) {
    const b = inv(i)
    SBOX[i] = b ^ rotl8(b, 1) ^ rotl8(b, 2) ^ rotl8(b, 3) ^ rotl8(b, 4) ^ 0x63
  }
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i
})()

function xtime(x: number): number {
  const hi = x & 0x80
  const v = (x << 1) & 0xff
  return hi ? v ^ 0x1b : v
}

function gmul(a: number, b: number): number {
  let p = 0
  let x = a
  let y = b
  for (let i = 0; i < 8; i++) {
    if (y & 1) p ^= x
    x = xtime(x)
    y >>= 1
  }
  return p
}

/** AES-128 密钥扩展 → 11 轮 × 16 字节的轮密钥。 */
function expandKey(key: Uint8Array): Uint8Array {
  const w = new Uint8Array(176)
  w.set(key, 0)
  let rcon = 1
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4]
    let t1 = w[i - 3]
    let t2 = w[i - 2]
    let t3 = w[i - 1]
    if (i % 16 === 0) {
      // RotWord + SubWord + Rcon
      const tmp = t0
      t0 = SBOX[t1] ^ rcon
      t1 = SBOX[t2]
      t2 = SBOX[t3]
      t3 = SBOX[tmp]
      rcon = xtime(rcon)
    }
    w[i] = w[i - 16] ^ t0
    w[i + 1] = w[i - 15] ^ t1
    w[i + 2] = w[i - 14] ^ t2
    w[i + 3] = w[i - 13] ^ t3
  }
  return w
}

/** InvShiftRows：第 1/2/3 行分别右移 1/2/3 格（第 0 行不动）。 */
function invShiftRows(s: Uint8Array): void {
  let t = s[13]
  s[13] = s[9]
  s[9] = s[5]
  s[5] = s[1]
  s[1] = t
  const a = s[2]
  const b = s[6]
  s[2] = s[10]
  s[6] = s[14]
  s[10] = a
  s[14] = b
  t = s[3]
  s[3] = s[7]
  s[7] = s[11]
  s[11] = s[15]
  s[15] = t
}

/** 单块解密（16 字节，原地写入 out）。 */
function decryptBlock(roundKeys: Uint8Array, input: Uint8Array, inOff: number, out: Uint8Array, outOff: number): void {
  const s = new Uint8Array(16)
  for (let i = 0; i < 16; i++) s[i] = input[inOff + i] ^ roundKeys[160 + i]

  for (let round = 9; round >= 1; round--) {
    invShiftRows(s)
    // InvSubBytes
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]
    // AddRoundKey
    const off = round * 16
    for (let i = 0; i < 16; i++) s[i] ^= roundKeys[off + i]
    // InvMixColumns
    for (let c = 0; c < 4; c++) {
      const i = c * 4
      const a0 = s[i]
      const a1 = s[i + 1]
      const a2 = s[i + 2]
      const a3 = s[i + 3]
      s[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9)
      s[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13)
      s[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11)
      s[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14)
    }
  }

  // 最后一轮：InvShiftRows + InvSubBytes + AddRoundKey(0)
  invShiftRows(s)
  for (let i = 0; i < 16; i++) out[outOff + i] = INV_SBOX[s[i]] ^ roundKeys[i]
}

/** ShiftRows：第 1/2/3 行分别左移 1/2/3 格（第 0 行不动）。 */
function shiftRows(s: Uint8Array): void {
  let t = s[1]
  s[1] = s[5]
  s[5] = s[9]
  s[9] = s[13]
  s[13] = t
  const a = s[2]
  const b = s[6]
  s[2] = s[10]
  s[6] = s[14]
  s[10] = a
  s[14] = b
  t = s[15]
  s[15] = s[11]
  s[11] = s[7]
  s[7] = s[3]
  s[3] = t
}

/** MixColumns（正向：2,3,1,1）。 */
function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4
    const a0 = s[i]
    const a1 = s[i + 1]
    const a2 = s[i + 2]
    const a3 = s[i + 3]
    s[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3
    s[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3
    s[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3)
    s[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2)
  }
}

/** 单块加密（16 字节，写入 out）。 */
function encryptBlock(roundKeys: Uint8Array, input: Uint8Array, inOff: number, out: Uint8Array, outOff: number): void {
  const s = new Uint8Array(16)
  for (let i = 0; i < 16; i++) s[i] = input[inOff + i] ^ roundKeys[i]

  for (let round = 1; round <= 9; round++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]
    shiftRows(s)
    mixColumns(s)
    const off = round * 16
    for (let i = 0; i < 16; i++) s[i] ^= roundKeys[off + i]
  }

  // 最后一轮（无 MixColumns）
  for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]
  shiftRows(s)
  for (let i = 0; i < 16; i++) out[outOff + i] = s[i] ^ roundKeys[160 + i]
}

/**
 * AES-128-CBC 加密（无填充，与解密对称）。
 *
 * 用途：编辑 `.plr` 后重新加密。长度必须与输入相同（16 的整数倍），
 * 因此原文件尾部的补位块会被原样保留 —— 读取端本来也不解析它。
 */
export function aes128CbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 16 || iv.length !== 16) throw new Error('AES-128 需要 16 字节密钥与 IV')
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('明文长度不是 16 的整数倍')
  const roundKeys = expandKey(key)
  const out = new Uint8Array(data.length)
  const prev = new Uint8Array(iv)
  const block = new Uint8Array(16)
  const xored = new Uint8Array(16)
  for (let off = 0; off < data.length; off += 16) {
    for (let i = 0; i < 16; i++) xored[i] = data[off + i] ^ prev[i]
    encryptBlock(roundKeys, xored, 0, block, 0)
    out.set(block, off)
    prev.set(block)
  }
  return out
}

/**
 * AES-128-CBC 解密（无填充），与 .NET `RijndaelManaged` + `PaddingMode.None` 一致。
 *
 * @param key 16 字节密钥
 * @param iv 16 字节初始向量
 * @param data 密文（长度必须是 16 的整数倍）
 */
export function aes128CbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 16 || iv.length !== 16) throw new Error('AES-128 需要 16 字节密钥与 IV')
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('密文长度不是 16 的整数倍')
  const roundKeys = expandKey(key)
  const out = new Uint8Array(data.length)
  const prev = new Uint8Array(iv)
  const block = new Uint8Array(16)
  for (let off = 0; off < data.length; off += 16) {
    decryptBlock(roundKeys, data, off, block, 0)
    for (let i = 0; i < 16; i++) out[off + i] = block[i] ^ prev[i]
    prev.set(data.subarray(off, off + 16))
  }
  return out
}
