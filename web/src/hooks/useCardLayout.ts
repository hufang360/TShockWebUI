import { useCallback, useMemo } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import {
  DEFAULT_CARD_LAYOUTS,
  cardLayoutFor,
  clearCardLayout,
  moveInOrder,
  sanitizeCardLayouts,
  shiftInOrder,
  writeCardLayout,
  type CardLayout,
  type CardLayoutPrefs,
  type CardWidth,
} from '@/lib/cardLayout'
import { StorageKeys } from '@/lib/storage'

/**
 * 某服务器 + 某模块的卡片布局（顺序 / 宽度），存本机 `tswui:cardLayout`。
 *
 * `ids` 是当前真实存在的卡片 id（含记事本这类非指令卡片）。顺序里消失的 id 自动丢弃、
 * 新出现的 id 补在末尾，所以增删卡片不需要额外迁移。
 */
export function useCardLayout(serverId: string, scopeId: string, ids: string[]): {
  layout: CardLayout
  /** 上 / 下移一格。 */
  move: (id: string, delta: number) => void
  /** 拖拽到指定下标。 */
  moveTo: (id: string, index: number) => void
  setWidth: (id: string, width: CardWidth) => void
  /** 切换某张卡片的显示 / 隐藏。 */
  toggleHidden: (id: string) => void
  /** 恢复默认：清掉这个作用域的顺序 / 宽度 / 隐藏。 */
  reset: () => void
} {
  const [raw, setRaw] = useLocalState<CardLayoutPrefs>(StorageKeys.cardLayout, DEFAULT_CARD_LAYOUTS)
  const prefs = useMemo(() => sanitizeCardLayouts(raw), [raw])
  const idsKey = ids.join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => cardLayoutFor(prefs, serverId, scopeId, ids), [prefs, serverId, scopeId, idsKey])

  const write = useCallback(
    (next: CardLayout) => {
      setRaw((prev) => writeCardLayout(sanitizeCardLayouts(prev), serverId, scopeId, next))
    },
    [setRaw, serverId, scopeId],
  )

  const move = useCallback(
    (id: string, delta: number) => write({ ...layout, order: shiftInOrder(layout.order, id, delta) }),
    [layout, write],
  )
  const moveTo = useCallback(
    (id: string, index: number) => write({ ...layout, order: moveInOrder(layout.order, id, index) }),
    [layout, write],
  )
  const setWidth = useCallback(
    (id: string, width: CardWidth) => write({ ...layout, width: { ...layout.width, [id]: width } }),
    [layout, write],
  )
  const toggleHidden = useCallback(
    (id: string) => {
      const hidden = { ...layout.hidden }
      if (hidden[id]) delete hidden[id]
      else hidden[id] = true
      write({ ...layout, hidden })
    },
    [layout, write],
  )

  const reset = useCallback(() => {
    setRaw((prev) => clearCardLayout(sanitizeCardLayouts(prev), serverId, scopeId))
  }, [setRaw, serverId, scopeId])

  return { layout, move, moveTo, setWidth, toggleHidden, reset }
}
