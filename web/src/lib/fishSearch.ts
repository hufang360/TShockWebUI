import type { Dataset } from '@/types'
import type { FishGood } from '@/lib/tshock'

/**
 * 鱼店搜索命中判断：编号 / 名称 / 说明 / 别名（插件 `map`）/ 商品物品的名字。
 *
 * 最后一项是给「商品名 ≠ 物品名」的情况用的：服主常把商品叫「回城」「岛牌」，
 * 实际发的是某件物品；玩家记的是物品名，中英文任一边都该能搜到（内部名如 `Zenith`）。
 * 只认 `id > 0`（真发物品）的那件 —— 服务类商品的图标是**借来的识别图**，按它匹配只会误伤。
 */
export function matchFishGood(good: FishGood, query: string, dataset: Dataset | null): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (
    good.name.toLowerCase().includes(q) ||
    String(good.serial).includes(q) ||
    good.desc.toLowerCase().includes(q) ||
    (good.map ?? []).some((alias) => alias.toLowerCase().includes(q))
  ) {
    return true
  }
  const itemId = good.id ?? 0
  const item = itemId > 0 ? dataset?.itemsById.get(itemId) : undefined
  if (!item) return false
  return (
    item.name.toLowerCase().includes(q) ||
    item.key.toLowerCase().includes(q) ||
    item.tags.some((tag) => tag.toLowerCase().includes(q))
  )
}
