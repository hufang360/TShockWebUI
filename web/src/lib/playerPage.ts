import { EQUIP_GROUP_A, EQUIP_GROUP_B } from '@/lib/playerSlots'
import { TshockRequestError, type BackendTransport, type PlayerCapabilities, type PlayerLook } from '@/lib/tshock'

/**
 * 「查看存档」与「玩家管理」两个页面共用的小工具。
 *
 * 两个页面在侧边栏是**独立菜单**（查看存档是公开工具，玩家管理依赖 PlayerManager 插件），
 * 但都需要：按上游缓存上次结果、触发下载、把后端错误翻成给玩家看的文案。
 */

/** 按「上游 + transport」缓存探测结果与上次查看的背包（**内存**，刷新页面即清空）。 */
export interface PlayerCache {
  capability?: PlayerCapabilities
  /** 上次查看的玩家名（用于判断缓存是否对应输入的玩家）。 */
  name?: string
  look?: PlayerLook
  /** 上次导入的本地存档（「查看存档」页）。 */
  saveLook?: PlayerLook
}

const playerCaches = new WeakMap<BackendTransport, Map<string, PlayerCache>>()

/**
 * 取某个 transport 的缓存表。
 * 用 `WeakMap<BackendTransport, ...>` 做外层键，保证测试里每个 transport 互相隔离。
 *
 * 目的：侧栏切到别的页面再回来时，组件会重新挂载，但**不再重新探测 / 重新拉取**，
 * 直接显示上次的结果；需要最新数据时用页面上的刷新按钮。
 */
export function cacheFor(transport: BackendTransport): Map<string, PlayerCache> {
  let cache = playerCaches.get(transport)
  if (!cache) {
    cache = new Map<string, PlayerCache>()
    playerCaches.set(transport, cache)
  }
  return cache
}

/** 触发浏览器下载（导出 .plr / 导出图片共用）。 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 导出图片时需要翻译的分组标题（与 `lib/playerShot.ts` 的版面对应）。 */
export const SHOT_GROUP_KEYS = [
  'players.group.inventory',
  'players.group.coins',
  'players.group.ammo',
  'players.group.trash',
  ...EQUIP_GROUP_B,
  ...EQUIP_GROUP_A,
]

/** 把 transport 抛出的错误翻成界面文案（权限 / 插件缺失 / 限流 / 上游 4xx 原文…）。 */
export function playerErrorMessage(
  err: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (err instanceof TshockRequestError) {
    switch (err.kind) {
      case 'token':
      case 'auth':
        return t('app.tokenInvalid')
      case 'permission':
        return t('players.err.permission')
      case 'plugin_missing':
        return t('players.err.pluginMissing')
      case 'rate_limited':
        return t('players.err.rateLimited')
      case 'timeout':
        return t('players.err.timeout')
      case 'unavailable':
        return t('players.err.unavailable')
      case 'validation':
        // 后端把上游 4xx（如 PlayerManager「未找到玩家」/ .plr 解析失败）的原文透传过来，直接展示具体原因。
        return err.message || t('players.err.badResponse')
      default:
        return t('players.err.badResponse')
    }
  }
  return err instanceof Error ? err.message : t('players.err.badResponse')
}
