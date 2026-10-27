import { SaveFormatError } from '@/lib/save/bytes'
import { parseWorld, type ParsedWorld, type WorldInfo, type WorldTrack } from '@/lib/save/worldFile'
import { parseWorldSections, type WorldSections } from '@/lib/save/worldStats'
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

/** 一次解析的结果（信息 + 缩略图位图 + 各段统计）。 */
export interface WorldView {
  info: WorldInfo
  thumb: WorldThumb
  /** 箱子 / 招牌 / NPC / 图格实体统计（某段读不动时为 `null`）。 */
  sections: WorldSections
  /** 解析结果（图格段起点 / frame 表）；「查找图格」要重新走一趟图格流，需要它。 */
  parsed: ParsedWorld
}

/**
 * 每服缓存最多保留几个世界。
 *
 * 一个世界视图最重的是缩略图位图（4200×1200 ≈ 20 MB），多服务器来回切会累积，
 * 所以只留最近 2 个（LRU）：切回来还在，切第三个就把最久没看的丢掉。
 */
export const WORLD_CACHE_LIMIT = 2

/** Map 的插入顺序天然就是 LRU 顺序（命中时删了重插 → 移到末尾）。 */
const worldCaches = new Map<string, WorldView>()

/** 取某个服务器的缓存（切页面回来不用重新选文件；刷新页面即清空，不落 localStorage）。 */
export function cachedWorld(serverId: string): WorldView | undefined {
  const hit = worldCaches.get(serverId)
  if (hit) {
    // 命中 → 移到末尾（最近使用）
    worldCaches.delete(serverId)
    worldCaches.set(serverId, hit)
  }
  return hit
}

/** 写入缓存，超出上限时淘汰最久未使用的（见 `WORLD_CACHE_LIMIT`）。 */
export function cacheWorld(serverId: string, view: WorldView): void {
  worldCaches.delete(serverId)
  worldCaches.set(serverId, view)
  while (worldCaches.size > WORLD_CACHE_LIMIT) {
    const oldest = worldCaches.keys().next().value
    if (oldest === undefined) break
    worldCaches.delete(oldest)
  }
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
  const track = {} as unknown as WorldTrack // 偏移表由 parseWorld 自己填（含 bosses 子表）
  const parsed = parseWorld(bytes, track)
  const thumb = await renderWorldThumbnail(bytes, parsed, {
    // 显示与导出共用同一张位图：默认按「像素预算」尽量 1 图格 = 1 像素
    // （大世界 8400×2400 → 2 图格/像素，即 4200×1200），屏幕按容器缩放。
    onProgress: opts.onProgress,
    // 悬停看「这一格是什么」需要每列的流偏移（8400 列 ≈ 34 KB）
    recordColumnOffsets: true,
  })
  // 段统计（箱子 / 招牌 / NPC / 实体）：复用同一份字节与段指针。
  const sections = parseWorldSections(bytes, track, parsed.info.release)
  return { info: parsed.info, thumb, sections, parsed }
}

/**
 * 高清导出的像素数上限：超过它就不给「1 图格 = 1 像素」。
 *
 * 1.4.5.8 最大世界 8400×2400 = **20.16M px**：位图 + 画布 ≈ 160 MB（`Uint32Array` 80 MB + `ImageData` 80 MB），
 * 桌面浏览器可以，手机可能被系统杀掉。所以这里只拦「大于最大世界」的异常情况，
 * 大世界本身仍然允许，但界面会先确认（见 `WorldPage` 的「导出高清图」）。
 */
export const MAX_HIRES_PIXELS = 24_000_000

/** 高清导出是否可用（世界太大时拒绝，避免一次性分配上百 MB）。 */
export function canExportHiRes(width: number, height: number): boolean {
  return width * height <= MAX_HIRES_PIXELS
}

/**
 * 以 **1 图格 = 1 像素** 重新渲染一张位图（「导出高清图」用）。
 *
 * 与屏幕上那张缩略图分开渲染：缩略图受 8M 像素预算限制（大世界会降到 2 图格/像素），
 * 想看清方块就得按原尺寸重画一次。渲染本身仍是本地的，不上传。
 */
export async function renderWorldHiRes(
  bytes: Uint8Array,
  parsed: ParsedWorld,
  opts: { onProgress?: (ratio: number) => void } = {},
): Promise<WorldThumb> {
  const { width, height } = parsed.info
  if (!canExportHiRes(width, height)) {
    throw new Error(`世界太大（${width}×${height}），高清导出会占用上百 MB 内存`)
  }
  return renderWorldThumbnail(bytes, parsed, {
    res: 1,
    onProgress: opts.onProgress,
  })
}

/** 把解析错误翻成界面文案：存档格式问题直接用解析器给的具体原因。 */
export function worldErrorMessage(
  err: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (err instanceof SaveFormatError) return err.message
  return err instanceof Error ? err.message : t('save.err.readFailed')
}

/**
 * 当日的游戏时间（0–54000 tick）→ `HH:MM`。
 *
 * 游戏里的一天从 **04:30** 起算（`Main.time = 0` 于 4:30:00），`54000` 回到次日 4:30。
 */
export function formatWorldClock(time: number): string {
  const totalMinutes = Math.floor((time / 54000) * 24 * 60 + 4 * 60 + 30) % (24 * 60)
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
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
/**
 * 世界时间显示成 `YYYY-MM-DD HH:MM`。
 *
 * 存档里两种时间语义不同（见 `lib/save/bytes.ts` 的 `dotnetBinaryToIso`）：
 * - 带时区（`Z` / `±hh:mm`）→ 换算成浏览器本地时区（「最后游玩」是 UTC）；
 * - 不带时区 → 就是存档里的**本地墙上时间**（「创建时间」），原样显示。
 */
export function formatWorldTime(iso: string | null | undefined): string {
  if (!iso || iso.length < 16) return ''
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) {
    const at = new Date(iso)
    if (!Number.isNaN(at.getTime())) {
      const p2 = (n: number) => String(n).padStart(2, '0')
      return `${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}`
    }
  }
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}
