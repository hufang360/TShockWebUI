import { afterEach, describe, expect, it } from 'vitest'
import { installCanvasStub } from '@/test/canvasStub'
import { buildWorld } from '@/test/worldFile'
import { parseWorld, type WorldTrack } from './worldFile'
import { renderWorldThumbnail } from './worldThumb'
import { worldImageFilename, worldThumbnailBlob } from './worldImage'

let stub: ReturnType<typeof installCanvasStub> | null = null
afterEach(() => {
  stub?.restore()
  stub = null
})

describe('世界缩略图导出 PNG', () => {
  it('画布尺寸 = 位图尺寸，putImageData 用的是这张位图，输出 image/png', async () => {
    const bytes = buildWorld({ width: 40, height: 20, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, {} as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 100_000 })
    stub = installCanvasStub()

    const blob = await worldThumbnailBlob(thumb)
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/png')
    expect(stub.log.canvases).toEqual([{ width: thumb.width, height: thumb.height }])
    expect(stub.log.imageData).toEqual([
      { width: thumb.width, height: thumb.height, x: 0, y: 0 },
    ])
    expect(stub.log.blobTypes).toEqual(['image/png'])
  })

  it('环境没有 canvas（未装桩）时返回 null，而不是抛错', async () => {
    const bytes = buildWorld({ width: 8, height: 8, tiles: () => ({ typ: 1 }) })
    const parsed = parseWorld(bytes, {} as WorldTrack)
    const thumb = await renderWorldThumbnail(bytes, parsed, { maxPixels: 10_000 })
    expect(await worldThumbnailBlob(thumb)).toBeNull()
  })

  it('文件名清洗：非法字符换下划线、空白合并、空名回退 world.png', () => {
    expect(worldImageFilename('中秋 快乐')).toBe('中秋 快乐.png')
    expect(worldImageFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j.png')
    expect(worldImageFilename('  spaced   name  ')).toBe('spaced name.png')
    expect(worldImageFilename('')).toBe('world.png')
  })
})
