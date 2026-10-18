/**
 * 当前页面是否有鼠标选中的文本。
 *
 * 用于「整个卡片头部可点击折叠、但指令文本仍能选中复制」：
 * 在头部的点击处理里先判断，若正在选中文本就不触发折叠。
 * jsdom / 老浏览器没有 getSelection 时按「未选中」处理。
 */
export function hasTextSelection(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false
  const selection = window.getSelection()
  return selection != null && selection.toString().length > 0
}
