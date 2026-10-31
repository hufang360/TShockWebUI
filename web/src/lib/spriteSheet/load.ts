/**
 * 解码本地 PNG（不上传、不请求后端）。
 *
 * 优先 `createImageBitmap`（不占 DOM、可 `close()` 释放内存）；不可用时回退 `<img>` + object URL。
 * 只在浏览器里有意义，因此在测试环境（jsdom）由用例自行 mock。
 */

import type { SliceSource } from './export'

export interface LoadedSheet extends SliceSource {
  /** 文件名（导出时做前缀）。 */
  name: string
  /** 释放底层资源（切到别的图片 / 卸载页面时调用）。 */
  dispose: () => void
}

export function loadSheet(file: File): Promise<LoadedSheet> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bitmap) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      name: file.name,
      dispose: () => bitmap.close?.(),
    }))
  }
  return new Promise<LoadedSheet>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('image decoding unavailable'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error('empty image'))
        return
      }
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        name: file.name,
        dispose: () => {
          img.src = ''
        },
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    img.src = url
  })
}
