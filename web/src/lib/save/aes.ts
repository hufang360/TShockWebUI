/**
 * 最小 AES-128-CBC **解密**实现（只解不加密），给 `.plr` 角色存档用。
 *
 * 为什么不用 `crypto.subtle`：WebCrypto 的 AES-CBC 一定会按 PKCS#7 去填充，
 * 而 Terraria 用的是 `RijndaelManaged` + `PaddingMode.None`（明文尾部补的是 0），
 * 直接调 WebCrypto 会因「填充非法」抛错。这里实现的是无填充的原始 CBC，
 * 与 .NET 的行为一致（见 `docs/技术事实.md`「角色存档（.plr）」）。
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
