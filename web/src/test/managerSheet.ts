import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * 「管理卡片」里每行行尾的「更多设置」菜单的测试助手。
 *
 * Radix 的 DropdownMenu 默认是模态的：菜单打开时把其余内容从可访问树里隐藏，
 * 所以查询别的行之前要先关掉菜单，否则 `getByRole('listitem')` 会找不到。
 */

/** 关闭已打开的「更多设置」菜单。 */
export async function closeRowMenu() {
  const menu = screen.queryByRole('menu')
  if (!menu) return
  // Escape 要落在菜单内部才生效（焦点可能在触发按钮 / 菜单项上），必要时再兜一层到 document。
  const target = (document.activeElement as HTMLElement | null) ?? menu
  fireEvent.keyDown(target, { key: 'Escape' })
  if (screen.queryByRole('menu')) fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

/** 打开某一行行尾的「更多设置」菜单（Radix DropdownMenu 由 pointerdown 触发）。 */
export async function openRowMenu(row: HTMLElement) {
  await closeRowMenu()
  const trigger = within(row).getByRole('button', { name: '更多' })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  return screen.getByRole('menu')
}
