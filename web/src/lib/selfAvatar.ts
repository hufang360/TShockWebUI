/**
 * 「自己」的玩家外观缓存（内存，按服务器分开）。
 *
 * 联动：在「玩家管理」里查询到**当前登录账号本人**时，把该 `PlayerLook` 记下来，
 * 侧栏底部的账号卡片用它画全身图当头像。只存在内存、不落盘，刷新页面即清空。
 */

import { useSyncExternalStore } from 'react'
import type { PlayerLook } from './tshock'

const selfAvatars = new Map<string, PlayerLook>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 记录某服务器上「自己」的外观。 */
export function setSelfAvatar(serverId: string, look: PlayerLook): void {
  selfAvatars.set(serverId, look)
  emit()
}

/** 清除某服务器（不传则全部）的「自己」外观。 */
export function clearSelfAvatar(serverId?: string): void {
  if (serverId) selfAvatars.delete(serverId)
  else selfAvatars.clear()
  emit()
}

export function getSelfAvatar(serverId: string): PlayerLook | null {
  return selfAvatars.get(serverId) ?? null
}

/** 订阅式读取：侧栏账号卡片用。 */
export function useSelfAvatar(serverId: string): PlayerLook | null {
  return useSyncExternalStore(
    subscribe,
    () => selfAvatars.get(serverId) ?? null,
    () => null,
  )
}
