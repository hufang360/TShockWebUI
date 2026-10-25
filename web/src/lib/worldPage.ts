import { SaveFormatError } from '@/lib/save/bytes'
import { parseWorld, type WorldInfo } from '@/lib/save/worldFile'
import { renderWorldThumbnail, type WorldThumb } from '@/lib/save/worldThumb'

/**
 * 「查看世界」页的小工具：本地解析、按上游缓存上次结果、字段展示映射。
 *
 * **全程在浏览器里完成**：`.wld` 不上传服务器（`lib/save/worldFile.ts` 解析，
 * `lib/save/worldThumb.ts` 渲染缩略图），因此没有登录、权限、限流这些服务端约束。
 */

/**
 * 单文件体积上限（**只用于提示**，不再有上传）。
 *
 * 实测 1.4.5 大世界存档最大 15.5 MiB；这里是「明显不是世界存档」的保险丝，
 * 免得用户误选几百 MB 的文件把标签页卡死。
 */
export const MAX_WORLD_FILE_BYTES = 64 * 1024 * 1024

/** 文件是否过大（直接拒绝，不做解析）。 */
export function isWorldFileTooLarge(bytes: number): boolean {
  return bytes > MAX_WORLD_FILE_BYTES
}

/**
 * 自带 Demo 世界的静态资源路径（`web/public/demo/world.wld`，构建后随前端一起发布）。
 *
 * 内容是一张**空白世界**（4200×1200，只有天空 / 地表 / 石头 / 地狱四层），约 81 KB，
 * 用来让人不选文件就能看到这个页面长什么样；和用户自己选的存档走完全一样的本地解析路径。
 */
export const DEMO_WORLD_URL = `${import.meta.env.BASE_URL}demo/world.wld`

/** 取出自带 Demo 世界（当作一个普通本地文件返回，后续流程与手动选择完全一致）。 */
export async function loadDemoWorldFile(): Promise<File> {
  const res = await fetch(DEMO_WORLD_URL, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  return new File([blob], 'demo-world.wld', { type: 'application/octet-stream' })
}

/** 一次解析的结果（信息 + 缩略图位图）。 */
export interface WorldView {
  info: WorldInfo
  thumb: WorldThumb
}

const worldCaches = new Map<string, WorldView>()

/** 取某个服务器的缓存（切页面回来不用重新选文件；刷新页面即清空，不落 localStorage）。 */
export function cachedWorld(serverId: string): WorldView | undefined {
  return worldCaches.get(serverId)
}

export function cacheWorld(serverId: string, view: WorldView): void {
  worldCaches.set(serverId, view)
}

/** 清空缓存（单测之间隔离；也可在需要强制重新选择文件时用）。 */
export function clearWorldCache(): void {
  worldCaches.clear()
}

/** 本地解析 `.wld`（含 `.wld.bak` / `.wld.bak2`）并渲染缩略图。 */
export async function readWorldFile(
  bytes: Uint8Array,
  opts: { onProgress?: (ratio: number) => void } = {},
): Promise<WorldView> {
  const parsed = parseWorld(bytes)
  const thumb = await renderWorldThumbnail(bytes, parsed, {
    // 显示与导出共用同一张位图：默认按「像素预算」尽量 1 图格 = 1 像素
    // （大世界 8400×2400 → 2 图格/像素，即 4200×1200），屏幕按容器缩放。
    onProgress: opts.onProgress,
  })
  return { info: parsed.info, thumb }
}

/** 把解析错误翻成界面文案：存档格式问题直接用解析器给的具体原因。 */
export function worldErrorMessage(
  err: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (err instanceof SaveFormatError) return err.message
  return err instanceof Error ? err.message : t('save.err.readFailed')
}

/** 世界尺寸档位（按图格宽；阈值即游戏内小 / 中 / 大世界的宽度）。 */
export function worldSizeKey(width: number): 'small' | 'medium' | 'large' {
  if (width <= 4200) return 'small'
  if (width <= 6400) return 'medium'
  return 'large'
}

/** 难度（0 普通 / 1 专家 / 2 大师 / 3 旅途）→ i18n key 后缀。 */
export function gameModeKey(gameMode: number): string {
  switch (gameMode) {
    case 3:
      return 'journey'
    case 2:
      return 'master'
    case 1:
      return 'expert'
    default:
      return 'classic'
  }
}

/** Boss 字段名 → i18n key 后缀；「世界吞噬者 / 克苏鲁之脑」按世界邪恶类型区分。 */
export function bossKey(boss: string, evil: 'corruption' | 'crimson'): string {
  if (boss === 'evilBoss') return evil === 'crimson' ? 'brainOfCthulhu' : 'eaterOfWorlds'
  return boss
}

/**
 * 存档里记录的时间按 UTC 展示（等于游戏里看到的墙上时间）。
 *
 * 解析器按 UTC 解释 `.NET DateTime.ToBinary()` 的本地时间 ticks，这里只截取
 * `YYYY-MM-DD HH:mm`，**不做时区换算**，避免与游戏里显示的时间不一致。
 */
export function formatWorldTime(iso: string | null | undefined): string {
  if (!iso || iso.length < 16) return ''
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}
