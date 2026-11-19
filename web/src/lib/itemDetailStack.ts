import type { DetailEntry, ItemDetailApi } from '@/lib/itemDetailContext'

/**
 * 把「打开某物品」实现成往栈里 push 一层（物品详情弹框与搜索面板的物品层共用）。
 *
 * 点自己不要叠层：同一个物品 + 同一个词缀已经在栈顶时忽略。
 */
export function pushApi(entry: DetailEntry, onPush: (entry: DetailEntry) => void): ItemDetailApi {
  return {
    open: (itemId, opts) => {
      const sameItem = entry.id === itemId && (opts?.prefixId ?? 0) === (entry.prefixId ?? 0)
      if (sameItem) return
      onPush({ id: itemId, prefixId: opts?.prefixId, stack: opts?.stack })
    },
  }
}
