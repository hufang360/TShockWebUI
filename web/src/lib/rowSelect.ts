import type { KeyboardEvent } from 'react'

/**
 * 表格「整行可点」的统一事件：鼠标点击、键盘 Enter / 空格都能打开详情抽屉。
 *
 * 只给事件，视觉（`cursor-pointer` + hover / 聚焦底色）由各处自己写：
 * 物品 ID 表格与数据 ID 表格（NPC / 图格 / 墙 / Buff）共用同一套手感。
 */
export function selectableRow(onSelect: () => void) {
  return {
    onClick: onSelect,
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onSelect()
    },
  }
}
