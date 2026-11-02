/**
 * 物品提示的**全局单例登记**（唯一来源）。
 *
 * 全局只允许一个提示存在：鼠标快速滑过多个物品时，新提示打开会立即关掉上一个，
 * 否则每个实例各自 150ms 延迟关闭，会出现好几个提示叠在一起。
 *
 * 单独放一个 lib 模块（而不是放在 `components/ItemTooltip.tsx`）是为了让**提示内容本身**
 * （`ItemTooltipContent` 右上角的 ⓘ「物品详情」）也能在点击后立刻收起提示，
 * 又不会形成 `ItemTooltip ↔ ItemTooltipContent` 的循环依赖。
 */

/** 当前打开着的提示的「立即关闭」函数。 */
let closeActive: (() => void) | null = null

/** 立即收起当前物品提示（点图标打开详情前调用）。 */
export function closeItemTooltip() {
  closeActive?.()
}

/** 由 `useItemTooltip` 在打开提示时登记；传 `null` 表示不再持有。 */
export function setActiveItemTooltip(close: (() => void) | null) {
  closeActive = close
}

/** 取当前登记的函数（`useItemTooltip` 打开新提示前先关掉上一个）。 */
export function getActiveItemTooltip() {
  return closeActive
}
