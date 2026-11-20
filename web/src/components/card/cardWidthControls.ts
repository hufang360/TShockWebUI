import { SquarePaddingHorizontal, SquarePaddingLeft, SquarePaddingRight } from 'lucide-react'
import type { CardWidth } from '@/lib/cardLayout'

/**
 * 卡片宽度的显示名与图标（「管理卡片」列表行内与添加 / 编辑面板共用）。
 *
 * 尺寸用图标表示（不再写字）：左·小 = 方块靠左填充，左·大 = 横向铺满，右栏 = 靠右填充。
 * 文字只留在 `aria-label` / 悬停提示里。
 */
export const WIDTH_LABEL_KEY: Record<CardWidth, string> = {
  half: 'home.widthSmall',
  full: 'home.widthLarge',
  right: 'home.widthRight',
}

export const WIDTH_ICON: Record<CardWidth, typeof SquarePaddingLeft> = {
  half: SquarePaddingLeft,
  full: SquarePaddingHorizontal,
  right: SquarePaddingRight,
}
