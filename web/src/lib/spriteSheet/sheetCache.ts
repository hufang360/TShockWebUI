/**
 * 「分割」tab 的**会话内图片缓存**：切到别的页面再回来还能看到同一张图（刷新即清空，不写任何存储）。
 *
 * 单独放 lib 而不是组件文件里：组件文件只导出组件，才符合 Fast Refresh 的约定。
 */

import type { LoadedSheet } from './load'

let cached: LoadedSheet | null = null

export function getCachedSheet(): LoadedSheet | null {
  return cached
}

/** 写入缓存（替换时释放上一张的 `ImageBitmap`）。 */
export function setCachedSheet(sheet: LoadedSheet) {
  if (cached && cached !== sheet) cached.dispose()
  cached = sheet
}

/** 释放缓存（测试之间互不影响；将来要做「关闭图片」也可以复用）。 */
export function clearSheetCache() {
  cached?.dispose()
  cached = null
}
