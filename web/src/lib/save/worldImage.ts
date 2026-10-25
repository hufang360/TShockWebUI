/**
 * 把世界缩略图位图编码成 PNG（浏览器本地，`canvas.toBlob`），用于「导出图片」。
 *
 * 与「查看存档」的图片导出（`lib/playerShot.ts`）同一套思路：位图已经渲染好，
 * 这里只负责编码与下载，不依赖任何服务端。
 */
import type { WorldThumb } from './worldThumb'

/** 位图 → PNG Blob；环境不支持 canvas（如 jsdom）时返回 null。 */
export function worldThumbnailBlob(thumb: WorldThumb): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof ImageData === 'undefined') return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = thumb.width
  canvas.height = thumb.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.putImageData(new ImageData(thumb.pixels, thumb.width, thumb.height), 0, 0)
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null)
      return
    }
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/** 导出图片的文件名：`<世界名>.png`，去掉路径 / 非法字符。 */
export function worldImageFilename(name: string): string {
  const safe = (name || 'world')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safe || 'world'}.png`
}
