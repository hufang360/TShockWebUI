import { afterEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_JSON_FETCH, atlasImageUrl, loadVerifiedAtlasImage } from '@/lib/atlas'

/** 用桩 Image 记录请求过的 URL，并按 URL 返回指定尺寸（模拟浏览器拿到旧图 / 半截图）。 */
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  private _src = ''
  static requests: string[] = []
  static sizeFor: (url: string) => [number, number] = () => [0, 0]

  set src(url: string) {
    this._src = url
    FakeImage.requests.push(url)
    const [w, h] = FakeImage.sizeFor(url)
    queueMicrotask(() => {
      this.naturalWidth = w
      this.naturalHeight = h
      if (w > 0) this.onload?.()
      else this.onerror?.()
    })
  }
  get src() {
    return this._src
  }
}

/** 每个用例用不同哈希：lib/atlas 的图集缓存是模块级单例，跨用例不能共用 URL。 */
const atlasWith = (hash: string) => ({ meta: { sheet: 'npc-atlas.png', hash, width: 1162, height: 5054 } })

describe('lib/atlas', () => {
  afterEach(() => {
    FakeImage.requests = []
    vi.unstubAllGlobals()
  })

  it('裁切表 JSON 请求绕过 HTTP 缓存（避免旧坐标 + 新 PNG）', () => {
    expect(ATLAS_JSON_FETCH.cache).toBe('no-store')
    expect(atlasImageUrl('npc-atlas.png', 'abc123')).toBe('/data/npc-atlas.png?v=abc123')
    expect(atlasImageUrl('npc-atlas.png')).toBe('/data/npc-atlas.png')
  })

  it('尺寸与裁切表一致时直接用缓存哈希 URL', async () => {
    vi.stubGlobal('Image', FakeImage)
    FakeImage.sizeFor = () => [1162, 5054]
    const img = await loadVerifiedAtlasImage(atlasWith('h1'))
    expect(img.naturalWidth).toBe(1162)
    expect(FakeImage.requests).toEqual(['/data/npc-atlas.png?v=h1'])
  })

  it('尺寸不一致时带时间戳重取一次；重取对了就用它', async () => {
    vi.stubGlobal('Image', FakeImage)
    FakeImage.sizeFor = (url) => (url.includes('retry=') ? [1162, 5054] : [1024, 5000])
    const img = await loadVerifiedAtlasImage(atlasWith('h2'))
    expect(img.naturalHeight).toBe(5054)
    expect(FakeImage.requests).toHaveLength(2)
    expect(FakeImage.requests[1]).toContain('retry=')
  })

  it('重取后仍不一致则抛错（调用方显示占位，绝不画错位贴图）', async () => {
    vi.stubGlobal('Image', FakeImage)
    FakeImage.sizeFor = () => [1024, 5000]
    await expect(loadVerifiedAtlasImage(atlasWith('h3'))).rejects.toThrow('图集尺寸不匹配')
  })
})
