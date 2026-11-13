import { useEffect } from 'react'

/**
 * 「常用表格」页要打开哪张表的跨页面意图。
 *
 * 和 `lib/editorView.ts` 同一套做法：从别处跳过来时（旧地址 `#/commands`、全局搜索里的指令命中）
 * 页面可能还没挂载，所以把「要打开哪一张」写成模块级待办，而不是 React state。
 */
export type TablesView = 'tips' | string

let desired: TablesView | null = null
const listeners = new Set<(view: TablesView) => void>()

/** 请求打开某一张表（不清除待办：冷启动会先挂一次未登录形态，一次性消费会被提前吃掉）。 */
export function requestTablesView(view: TablesView): void {
  desired = view
  for (const listener of listeners) listener(view)
}

/** 取走并清空待办；没有返回 null。 */
export function consumeTablesView(): TablesView | null {
  const view = desired
  desired = null
  return view
}

/** 订阅「要打开哪一张」：挂载时若已有待办，立刻应用一次。 */
export function useTablesViewRequest(apply: (view: TablesView) => void): void {
  useEffect(() => {
    listeners.add(apply)
    if (desired) apply(desired)
    return () => {
      listeners.delete(apply)
    }
  }, [apply])
}
