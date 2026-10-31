import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** 距底部多少像素内算「贴着底部」；超过就认为用户在回看历史，不再自动跟随。 */
const NEAR_BOTTOM_PX = 48

export interface BottomList<T extends HTMLElement = HTMLDivElement> {
  /** 挂到滚动容器上（必须是带 `overflow-y-auto` 的可滚动元素）。 */
  ref: RefObject<T | null>
  /**
   * 挂到滚动容器的**内层内容**上（可选）。内容自身变高（如富文本拿到服务器返回后才展开、
   * 列表条目换行）时也要贴底，只观察滚动容器本身的尺寸变化抓不到这种情况。
   */
  contentRef: (node: HTMLElement | null) => void
  /** 挂到滚动容器的 `onScroll`：记录用户是否还贴着底部。 */
  onScroll: () => void
  /** 本次渲染应从第几条开始（配合 `slice(start)` 使用）。 */
  start: number
  /** 被窗口隐藏的旧记录条数（>0 时显示「加载更早」）。 */
  hidden: number
  /** 每次「加载更早」展开的条数，用于文案里的 N。 */
  step: number
  /** 用户是否贴着底部（false 时可在列表上显示「回到底部」浮按钮）。 */
  atBottom: boolean
  /** 无条件滚到最底（并恢复自动跟随）。 */
  scrollToBottom: () => void
  /** 展开一批更早的记录（会保持视觉位置不跳）。 */
  loadEarlier: () => void
}

/**
 * 「贴底 + 懒加载旧记录」列表的共享逻辑（指令结果 / 服务器动态同款）。
 *
 * - **贴底跟随**：内容总数 `total` 变化时，若用户正贴着底部，就自动滚到最底；
 *   内容高度变化（`contentRef` 观察到的富文本 / 换行等）同样跟随。
 *   用户主动往上翻看旧记录时不打扰，滚回底部后自动恢复跟随。
 * - **懒渲染**：默认只渲染最后 `initial` 条，`loadEarlier()` 每次再往前展开 `step` 条，
 *   避免一次渲染上百条记录（滚动用 `slice(start)` 取窗口）。
 * - 列表清空后（`total === 0`）自动回到贴底状态，下次进来默认停在最新一条。
 */
export function useBottomList<T extends HTMLElement = HTMLDivElement>(
  total: number,
  opts?: {
    initial?: number
    step?: number
    /**
     * 自定滚动容器（不传则用 `ref` 那个元素）。
     *
     * 「聊天」页把滚动交给页面级滚动区（浏览器右侧那条滚动条），列表本身不溢出：
     * 此时需要告诉这里「真正在滚的是 `<main>`」，否则贴底 / 回到底部 / 加载更早都会作用在错的元素上。
     * 传 null / 不传时退回 `ref`。
     */
    scroller?: HTMLElement | null
  },
): BottomList<T> {
  const initial = Math.max(1, opts?.initial ?? 10)
  const step = Math.max(1, opts?.step ?? initial)
  const ref = useRef<T>(null)
  const scroller = opts?.scroller ?? null
  const getScroller = useCallback(() => scroller ?? ref.current, [scroller])
  // 内容元素（用 state 存，元素换了 / 晚挂载时才能重新决定观察谁）。
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null)
  const contentRef = useCallback((node: HTMLElement | null) => setContentEl(node), [])
  // 用户是否贴着底部；初始为 true（首次进入默认停在最新一条）。
  const stickRef = useRef(true)
  // 展开旧记录前「到内容底部的距离」，用于展开后还原滚动位置。
  const keepDistanceRef = useRef<number | null>(null)
  const [visible, setVisible] = useState(initial)
  // 是否贴着底部（用于「回到底部」浮按钮）。
  const [atBottom, setAtBottom] = useState(true)

  const onScroll = useCallback(() => {
    const el = getScroller()
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    stickRef.current = near
    setAtBottom((prev) => (prev === near ? prev : near))
  }, [getScroller])

  const scrollToBottom = useCallback(() => {
    const el = getScroller()
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setAtBottom(true)
  }, [getScroller])

  // 新内容到达：贴着底部才跟随（用户正在回看历史时不打扰）。
  useLayoutEffect(() => {
    const el = getScroller()
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [total, getScroller])

  // 容器尺寸变化也要贴底：首次渲染时容器可能还没有可滚动高度（如页面量高前是自适应高度、
  // 或内容比容器矮），此时单靠 `[total]` 那次贴底会失效、停留在顶部；切到固定高度后需再贴一次。
  // 同时观察内层内容：富文本结果在服务器返回后才有内容、行高会变，容器本身尺寸不变。
  useLayoutEffect(() => {
    const el = getScroller()
    if (!el) return
    const stick = () => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    }
    stick()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(stick)
    ro.observe(el)
    if (contentEl && contentEl !== el) ro.observe(contentEl)
    return () => ro.disconnect()
  }, [contentEl, getScroller])

  // 加载更早：补回新增内容的高度，视觉上停在原来那条记录。
  useLayoutEffect(() => {
    const el = getScroller()
    if (el && keepDistanceRef.current != null) {
      el.scrollTop = el.scrollHeight - keepDistanceRef.current
      keepDistanceRef.current = null
    }
  }, [visible, getScroller])

  // 列表清空 / 切换数据源：重新贴底（窗口自然由 slice(start) 回落，不必重置 state）。
  useLayoutEffect(() => {
    if (total === 0) stickRef.current = true
  }, [total])

  const loadEarlier = useCallback(() => {
    const el = getScroller()
    if (el) keepDistanceRef.current = el.scrollHeight - el.scrollTop
    setVisible((v) => v + step)
  }, [step, getScroller])

  const start = Math.max(0, total - visible)
  return {
    ref,
    contentRef,
    onScroll,
    start,
    hidden: start,
    step,
    atBottom,
    scrollToBottom,
    loadEarlier,
  }
}
