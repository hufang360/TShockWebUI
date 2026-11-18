// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AtlasLike } from '@/lib/atlas'

/**
 * 真实图集文件的**自洽性**契约：四个 `data/<x>-atlas.json` 与它指向的 `.webp` 必须对得上。
 *
 * 为什么需要：前端用 `meta.sheet` 拼 URL、用 `meta.hash` 做缓存失效、用 `meta.width/height` 校验图片
 * （见 `lib/atlas.ts` 的 `loadVerifiedAtlasImage`）。三者只要有一个与文件不同步，表现就是
 * 「图标错位 / 图集加载失败」这种很难从报错看出来的故障——历史上已经因为「新 regions + 旧 PNG」
 * 出过一次（见 `记录-实现与验收.md`）。
 *
 * 这条测试只碰文件头，不解码像素，几十毫秒就能挡住「改了图集忘了改 hash / 忘了提交文件 / 名字写错」。
 */
const dataDir = resolve(process.cwd(), '../data')

/** `meta.hash` 只取前 12 位十六进制（见生成脚本 `atlas_hash`）。 */
function md5Prefix(bytes: Buffer): string {
  return createHash('md5').update(bytes).digest('hex').slice(0, 12)
}

/**
 * 从无损 WebP（VP8L）的文件头读出画布尺寸。
 *
 * VP8L 位流的第 2 个字节是 `0x2F` 签名，接下来 14 bit 宽 + 14 bit 高（均以 1 为基）。
 * 格式出处：WebP 容器规范（RIFF 容器 + `VP8L` chunk）。
 */
function losslessWebpSize(bytes: Buffer): { width: number; height: number } | null {
  const chunk = bytes.indexOf('VP8L')
  if (chunk < 0) return null
  const p = chunk + 8 // fourcc(4) + chunk size(4)
  if (bytes[p] !== 0x2f) return null
  const b0 = bytes[p + 1]
  const b1 = bytes[p + 2]
  const b2 = bytes[p + 3]
  const b3 = bytes[p + 4]
  return {
    width: 1 + (((b1 & 0x3f) << 8) | b0),
    height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
  }
}

const ATLASES = ['items', 'npc', 'player', 'buff']

describe.each(ATLASES)('真实数据：%s 图集', (name) => {
  const file = resolve(dataDir, `${name}-atlas.json`)
  const atlas = JSON.parse(readFileSync(file, 'utf8')) as AtlasLike

  it('裁切表指向的图集文件存在且是合法 WebP', () => {
    expect(atlas.meta.sheet).toMatch(/^[a-z]+-atlas\.webp$/)
    const image = resolve(dataDir, atlas.meta.sheet)
    expect(existsSync(image), `${atlas.meta.sheet} 未提交（或名字写错）`).toBe(true)
    const bytes = readFileSync(image)
    // RIFF 容器 + WEBP 标识；图集是像素画，必须是**无损**（VP8L），有损（VP8）一律不允许。
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP')
    expect(bytes.includes('VP8L'), `${atlas.meta.sheet} 不是无损编码`).toBe(true)
  })

  it('hash 是文件内容的哈希（缓存失效依赖它）', () => {
    const bytes = readFileSync(resolve(dataDir, atlas.meta.sheet))
    expect(atlas.meta.hash).toBe(md5Prefix(bytes))
  })

  it('文件头里的尺寸与裁切表一致（不一致会被 loadVerifiedAtlasImage 判为坏图）', () => {
    const bytes = readFileSync(resolve(dataDir, atlas.meta.sheet))
    expect(losslessWebpSize(bytes)).toEqual({ width: atlas.meta.width, height: atlas.meta.height })
  })
})

describe('真实数据：图集体积', () => {
  it('首屏最大的图集（items）不超过 1 MB', () => {
    // 有损 / 回退成 PNG 会立刻突破这条线（PNG 是 1.9MB），防止"哪天顺手改回去"。
    const bytes = readFileSync(resolve(dataDir, 'items-atlas.webp'))
    expect(bytes.byteLength).toBeLessThan(1024 * 1024)
  })
})
