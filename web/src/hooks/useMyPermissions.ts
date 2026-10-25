import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BackendTransport, MeInfo } from '@/lib/tshock'

/**
 * 当前登录玩家的权限节点（`GET /api/me` → TShock `/tokentest`）。
 *
 * 用途：按权限决定**是否显示**某条指令（如 NPC 详情的 `/sb`、`/sm`，Buff 详情的 `/gbuff`）。
 * 权限判定仍然在 TShock；这里只是「不展示玩家明显用不了的指令」，不是权限边界。
 *
 * - 未登录不请求、`has()` 恒为 false；
 * - 按 `transport + serverId` 缓存（切页面回来不重复请求）；退出登录时清掉该上游的缓存。
 */
const cache = new WeakMap<BackendTransport, Map<string, MeInfo>>()

function cacheFor(transport: BackendTransport): Map<string, MeInfo> {
  let map = cache.get(transport)
  if (!map) {
    map = new Map<string, MeInfo>()
    cache.set(transport, map)
  }
  return map
}

export interface MyPermissions {
  /** 当前登录用户名（未登录 / 请求中为 null）。 */
  username: string | null
  /**
   * 是否**确认**拿到了权限列表（`/api/me` 成功）。
   * 为 false 时调用方应当「宁可显示也不隐藏」——老版本信使插件没有 `/webui/me`、
   * 或临时请求失败时，隐藏指令只会让玩家以为功能坏了。
   */
  known: boolean
  /** 是否拥有某个权限节点（支持 TShock 的通配：`*`、`tshock.*`、`tshock.npc.*`）。 */
  has: (permission: string) => boolean
}

export function useMyPermissions(
  transport: BackendTransport | undefined,
  authenticated: boolean,
  serverId: string,
): MyPermissions {
  const [me, setMe] = useState<MeInfo | null>(() =>
    transport && authenticated ? (cacheFor(transport).get(serverId) ?? null) : null,
  )

  useEffect(() => {
    if (!transport) return
    if (!authenticated) {
      // 退出 / 换账号：缓存失效（权限随用户组变化），下次登录重新拉。
      cacheFor(transport).delete(serverId)
      setMe(null)
      return
    }
    const hit = cacheFor(transport).get(serverId)
    if (hit) {
      setMe(hit)
      return
    }
    let cancelled = false
    void transport
      .me()
      .then((info) => {
        if (cancelled) return
        cacheFor(transport).set(serverId, info)
        setMe(info)
      })
      .catch(() => {
        // 权限拿不到（token 失效等）→ 不显示这些指令，不影响页面其它内容。
        if (!cancelled) setMe(null)
      })
    return () => {
      cancelled = true
    }
  }, [transport, authenticated, serverId])

  const permissions = useMemo(() => new Set(me?.permissions ?? []), [me])
  const has = useCallback(
    (permission: string) => {
      if (permissions.has(permission) || permissions.has('*')) return true
      // TShock 的 Group.HasPermission() 支持逐级通配：tshock.npc.spawnboss → tshock.npc.* / tshock.* / *
      const parts = permission.split('.')
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const wildcard = [...parts.slice(0, i), '*'].join('.')
        if (permissions.has(wildcard)) return true
      }
      return false
    },
    [permissions],
  )

  return { username: me?.username ?? null, known: me !== null, has }
}
