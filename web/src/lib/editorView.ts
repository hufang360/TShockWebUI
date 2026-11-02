import { useEffect } from 'react'

/**
 * 「指令」页要展示哪一块（结果 / 聊天）的跨页面意图。
 *
 * 为什么要这个：宽屏两栏同屏，窄屏是顶部 tab —— 从别处跳过来时（首页「最新动态」的箭头、
 * 旧地址 `#/chat`）需要指定「落到聊天那一块」。跨页面的一次性信号不能放进 state
 * （页面还没挂载），所以按 `lib/editorFocus.ts` 的老办法：写一个模块级待办。
 */
export type EditorView = 'results' | 'chat'

let desired: EditorView | null = null
const listeners = new Set<(view: EditorView) => void>()

/**
 * 请求「指令」页打开某一块。
 *
 * 两条路径都覆盖：页面**还没挂载**（留着待办，挂载时用）；页面**已经挂着**（直接通知订阅者）。
 * 待办**不在这里清掉**：冷启动打开 `#/chat` 时，页面会先以未登录形态挂一次、登录后再挂一次，
 * 一次性消费会在第一次就被吃掉（表现是「登录后停在结果而不是聊天」）。
 */
export function requestEditorView(view: EditorView): void {
  desired = view
  for (const listener of listeners) listener(view)
}

/** 用户自己点了 tab：之前的跳转意图作废（否则下次挂载又会被拉回聊天）。 */
export function clearEditorViewRequest(): void {
  desired = null
}

/** 取走并清空待办；没有待办返回 null。 */
export function consumeEditorView(): EditorView | null {
  const view = desired
  desired = null
  return view
}

/**
 * 订阅「要打开哪一块」：挂载时若已有待办，立刻应用一次。
 * `apply` 必须是稳定引用（如 `setView`），否则会反复重订阅。
 */
export function useEditorViewRequest(apply: (view: EditorView) => void): void {
  useEffect(() => {
    listeners.add(apply)
    if (desired) apply(desired)
    return () => {
      listeners.delete(apply)
    }
  }, [apply])
}
