import { useCallback, useRef } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { StorageKeys } from '@/lib/storage'

/** 工具弹框里的一页（与 `ToolsTab` 同名；这里只做「记忆」的键，不依赖组件）。 */
export type ToolsPanelId = 'commands' | 'favorites' | 'history' | 'items' | 'recipes'

/**
 * 工具弹框的本机记忆：**上次停在哪个 tab** + 每一页的**搜索词 / 滚动位置**。
 *
 * 弹框一关内容就卸载了，`useState` 会丢；而「刚搜过 `give`，关掉再开还得重敲」很烦。
 * 存在 `tswui:toolsMemory`（只在本机、只存界面状态，不含任何服务器数据）。
 */
export interface ToolsMemory {
  /** 每个入口（指令库 / 物品）最后停的 tab。 */
  tab: Partial<Record<'commands' | 'items', ToolsPanelId>>
  /** 每一页的搜索词。 */
  query: Partial<Record<ToolsPanelId, string>>
  /** 每一页的滚动位置（px）。 */
  scroll: Partial<Record<ToolsPanelId, number>>
}

const EMPTY: ToolsMemory = { tab: {}, query: {}, scroll: {} }

/** 读 / 写整份记忆（弹框与各面板共用同一份；`writeJson` 会广播，彼此保持同步）。 */
export function useToolsMemory() {
  const [memory, setMemory] = useLocalState<ToolsMemory>(StorageKeys.toolsMemory, EMPTY)
  // 合并写入：并发改不同字段时不会把对方覆盖成旧值。
  const patch = useCallback(
    (next: (prev: ToolsMemory) => ToolsMemory) => {
      setMemory((prev) => {
        const base: ToolsMemory = {
          tab: prev?.tab ?? {},
          query: prev?.query ?? {},
          scroll: prev?.scroll ?? {},
        }
        return next(base)
      })
    },
    [setMemory],
  )
  return { memory: memory ?? EMPTY, patch }
}

/**
 * 单页的记忆：`query` / `setQuery` 直接当受控输入框用；
 * `scrollRef` 挂到滚动容器上 —— 挂载后**恢复**上次的 `scrollTop`，滚动时**记下**新的位置。
 */
export function usePanelMemory(panel: ToolsPanelId) {
  const { memory, patch } = useToolsMemory()
  const lastSaved = useRef<number>(memory.scroll[panel] ?? 0)

  const query = memory.query[panel] ?? ''
  const setQuery = useCallback(
    (value: string) => {
      patch((prev) => ({ ...prev, query: { ...prev.query, [panel]: value } }))
    },
    [panel, patch],
  )

  const scrollRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      // 恢复放到下一帧：内容刚挂上时 `scrollHeight` 还没算好，立刻赋值会被夹到 0。
      requestAnimationFrame(() => {
        node.scrollTop = lastSaved.current
      })
      node.onscroll = () => {
        lastSaved.current = node.scrollTop
      }
    },
    // 只按面板建一次；`patch` 变化不需要重挂（写入时读的是 ref）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panel],
  )

  /** 关闭弹框时落盘（滚动事件里只记内存，避免每滚 1px 写一次 localStorage）。 */
  const flushScroll = useCallback(() => {
    patch((prev) => ({ ...prev, scroll: { ...prev.scroll, [panel]: lastSaved.current } }))
  }, [panel, patch])

  return { query, setQuery, scrollRef, flushScroll }
}
