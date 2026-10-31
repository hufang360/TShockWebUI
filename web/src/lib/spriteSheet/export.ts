/**
 * 精灵图切片的**导出**：canvas 裁切 → PNG blob → 单张下载 / store-only ZIP 打包。
 *
 * 全部在浏览器本地完成：不请求后端、不上传图片（与「玩家存档 / 世界存档」同一原则）。
 */

import { buildZip, type ZipEntry } from './zip'
import type { SliceRect } from './slice'

export interface SliceSource {
  /** 已解码的图片（`ImageBitmap` / `HTMLImageElement`），只用于 `drawImage`。 */
  source: CanvasImageSource
  width: number
  height: number
}

const noopCanvas = (): HTMLCanvasElement | null => {
  if (typeof document === 'undefined') return null
  try {
    return document.createElement('canvas')
  } catch {
    return null
  }
}

/** 把 `rect` 区域原样画到一张新 canvas（不缩放）。canvas 不可用时返回 `null`。 */
export function cropCanvas(src: SliceSource, rect: SliceRect): HTMLCanvasElement | null {
  const canvas = noopCanvas()
  if (!canvas) return null
  const w = Math.max(1, Math.round(rect.w))
  const h = Math.max(1, Math.round(rect.h))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(src.source, rect.x, rect.y, w, h, 0, 0, w, h)
  return canvas
}

/** canvas → PNG blob（`toBlob` 不支持时回退 `toDataURL`）。 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('toBlob failed'))
      }, 'image/png')
      return
    }
    try {
      const url = canvas.toDataURL('image/png')
      const base64 = url.slice(url.indexOf(',') + 1)
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      resolve(new Blob([bytes], { type: 'image/png' }))
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** 单张切片 → PNG 字节。 */
export async function sliceBytes(src: SliceSource, rect: SliceRect): Promise<Uint8Array> {
  const canvas = cropCanvas(src, rect)
  if (!canvas) throw new Error('canvas unavailable')
  const blob = await canvasToBlob(canvas)
  return new Uint8Array(await blob.arrayBuffer())
}

/** 单张切片 → PNG blob（页面直接下载用）。 */
export async function sliceBlob(src: SliceSource, rect: SliceRect): Promise<Blob> {
  const canvas = cropCanvas(src, rect)
  if (!canvas) throw new Error('canvas unavailable')
  return canvasToBlob(canvas)
}

/**
 * 该切片是否**全透明**（用于「跳过全透明切片」）。
 * 拿不到像素数据（无 canvas / 被禁用）时按「不透明」处理，宁可多导一张也不误删。
 */
export function isBlank(src: SliceSource, rect: SliceRect): boolean {
  const canvas = noopCanvas()
  if (!canvas) return false
  const w = Math.max(1, Math.round(rect.w))
  const h = Math.max(1, Math.round(rect.h))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  try {
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(src.source, rect.x, rect.y, w, h, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false
    }
    return true
  } catch {
    // 跨域图片会污染 canvas（本地文件不会），按不透明处理
    return false
  }
}

export interface SliceExportItem {
  /** 包内文件名（不含 `.png`；由 `model.ts` 的 `sliceFileNames` 生成，已去重）。 */
  name: string
  rect: SliceRect
}

/**
 * 打包导出：每个切片一个 PNG 条目，文件名与单张导出一致。
 * 返回 ZIP blob。任一张编码失败直接抛出，不做「静默少几张」。
 */
export async function zipSlices(src: SliceSource, items: SliceExportItem[]): Promise<Blob> {
  const entries: ZipEntry[] = []
  for (const item of items) {
    entries.push({
      name: `${item.name}.png`,
      data: await sliceBytes(src, item.rect),
    })
  }
  const bytes = buildZip(entries)
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([payload], { type: 'application/zip' })
}

/** 把一帧 RGBA 画到 canvas（GIF 分拆导出 / 缩略图用）；canvas 不可用时返回 `null`。 */
export function canvasFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const canvas = noopCanvas()
  if (!canvas) return null
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    const image = new ImageData(new Uint8ClampedArray(data), canvas.width, canvas.height)
    ctx.putImageData(image, 0, 0)
  } catch {
    return null
  }
  return canvas
}

/** 一帧 RGBA → PNG 字节（GIF 分拆导出用）。 */
export async function rgbaToPngBytes(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = canvasFromRgba(data, width, height)
  if (!canvas) throw new Error('canvas unavailable')
  return new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer())
}

export interface ComposedGifFrames {
  width: number
  height: number
  frames: { /** 便于 `putImageData` / 编码的原始像素。 */ data: Uint8ClampedArray; /** 便于预览缩放绘制。 */ canvas: HTMLCanvasElement }[]
}

/**
 * 把多张切片合成为**同一尺寸**的动画帧（GIF 要求每帧同宽高）。
 *
 * 尺寸取所有切片的最大宽 / 高，较小的帧**居中**放置（四周透明）。
 * canvas 不可用（无 2D context）时返回 `null`，由调用方提示。
 */
export function composeGifFrames(src: SliceSource, rects: SliceRect[]): ComposedGifFrames | null {
  if (rects.length === 0) return null
  const width = Math.max(1, ...rects.map((rect) => Math.round(rect.w)))
  const height = Math.max(1, ...rects.map((rect) => Math.round(rect.h)))
  const frames: ComposedGifFrames['frames'] = []
  for (const rect of rects) {
    const canvas = noopCanvas()
    if (!canvas) return null
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, width, height)
    const w = Math.max(1, Math.round(rect.w))
    const h = Math.max(1, Math.round(rect.h))
    ctx.drawImage(
      src.source,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      Math.round((width - w) / 2),
      Math.round((height - h) / 2),
      w,
      h,
    )
    const data = ctx.getImageData(0, 0, width, height).data
    frames.push({ data, canvas })
  }
  return { width, height, frames }
}

/** 去掉 `.png` 后缀，作为导出文件名前缀（其它后缀原样保留）。 */
export function sheetBaseName(fileName: string): string {
  return fileName.replace(/\.png$/i, '') || 'sheet'
}

/** 全部切片的 ZIP 文件名。 */
export function slicesZipName(fileName: string): string {
  return `${sheetBaseName(fileName)}-slices.zip`
}
