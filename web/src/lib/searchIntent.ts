import { useEffect } from 'react'
import type { TabId } from '@/types'

/**
 * 「全局搜索」选完一条结果后，目标页面该带什么进来的**一次性意图**。
 *
 * 为什么用模块级待办而不是 props：搜索面板在侧栏，点完立刻导航，目标页可能还没挂载；
 * 把一个只生效一次的查询词做成 `App` 的 state 再一路透传，会多出「什么时候清掉」的问题。
 * 这与 `lib/editorView.ts` 的做法一致，也避免把 `searchIntent` 塞进 `AppRoutes` 的 props 面。
 *
 * 生命周期：
 * - `requestSearchIntent` 设置待办并通知**已挂载**的同页订阅者；
 * - 页面用 `useSearchIntent` 订阅，挂载时也会尝试消费一次（冷启动导航）；
 * - 消费即清空；`App` 的普通导航会调用 `clearSearchIntent`，避免旧词在下次进入该页时突然出现。
 */
export interface SearchIntent {
  /** 预填搜索词（各页面的搜索框）。 */
  query?: string
  /** 数据 ID 页的数据源。 */
  kind?: 'npc' | 'tile' | 'wall' | 'buff'
  /** 物品图鉴要应用的集合 id。 */
  collectionId?: string
}

interface PendingIntent extends SearchIntent {
  tab: TabId
}

let pending: PendingIntent | null = null
const listeners = new Set<(intent: PendingIntent) => void>()

/** 请求目标页带意图进入（随后由调用方导航）。 */
export function requestSearchIntent(tab: TabId, intent: SearchIntent = {}): void {
  pending = { tab, ...intent }
  for (const listener of listeners) listener(pending)
}

/** 作废待办（用户自己点了导航 / 切页时调用）。 */
export function clearSearchIntent(): void {
  pending = null
}

/** 取走并清空待办；`tab` 不匹配时返回 null（不影响其它页的待办）。 */
export function consumeSearchIntent(tab: TabId): SearchIntent | null {
  if (!pending || pending.tab !== tab) return null
  const { tab: _tab, ...intent } = pending
  pending = null
  return intent
}

/**
 * 订阅「带意图进入本页」。`apply` 必须是稳定引用（`useCallback`），否则每次渲染都会重订阅。
 */
export function useSearchIntent(tab: TabId, apply: (intent: SearchIntent) => void): void {
  useEffect(() => {
    const run = () => {
      const intent = consumeSearchIntent(tab)
      if (intent) apply(intent)
    }
    // 挂载时先试一次：导航发生在挂载之前（冷启动 / 懒加载 chunk）。
    run()
    const listener = (target: PendingIntent) => {
      if (target.tab === tab) run()
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [tab, apply])
}

/** 单测用：清空待办与订阅者。 */
export function resetSearchIntent(): void {
  pending = null
  listeners.clear()
}
