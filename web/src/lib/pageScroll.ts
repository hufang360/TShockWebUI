import type { TabId } from '@/types'

/**
 * 「整页滚动」的页面：滚动条是浏览器右侧那条（AppShell 的 `<main>`），页面里**不再嵌**滚动区。
 *
 * - 指令 / 聊天 / 指令小抄 / 物品 ID / 数据 ID 走这套：内容多就把页面撑高，交给 `<main>` 滚；
 * - 页内吸顶 / 吸底（工具条、输入框）用 `sticky`，悬浮按钮投到宿主上（见 `usePageScroll`）。
 *
 * 这些页面常驻预留滚动条槽（`scrollbar-gutter: stable`）：切筛选后内容变短 → 滚动条消失 →
 * 内容区宽度多出 8px → 整列左右跳一下。
 */
export const PAGE_SCROLL_TABS: ReadonlySet<TabId> = new Set<TabId>([
  'chat',
  'editor',
  'commands',
  'items',
  'dataid',
])
