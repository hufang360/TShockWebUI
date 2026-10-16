import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ItemTooltipContent } from '@/components/ItemTooltipContent'
import type { Atlas, Item, ItemStatEntry } from '@/types'

/** 提示最大宽度 384px（`max-w-96`）；贴近视口边缘时按半宽夹取。 */
const TIP_HALF_WIDTH = 200

interface TipPosition {
  x: number
  y: number
  /** 触发元素靠近视口顶部时改为在下方弹出。 */
  below: boolean
}

export interface ItemTooltipOptions {
  item?: Item
  atlas?: Atlas
  stat?: ItemStatEntry
  prefix?: string | null
  stack?: number
  /** 覆盖显示名（默认 item.name）。 */
  name?: string
  /** 为 true 时不挂载提示（也没有手型指针）。 */
  disabled?: boolean
}

export interface ItemTooltipHandlers {
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
}

/**
 * 物品提示（全项目统一样式）的**锚点逻辑**：把鼠标/焦点事件绑到任意元素上，
 * 由本 hook 负责定位与 portal 渲染。
 *
 * 抽出来的原因：提示不只挂在图标画框上 —— 图鉴格子要求"整张卡片都能触发"，
 * 而 `ItemIcon` 只需要绑在自己的 canvas 外层。两者共用同一份定位/收起逻辑与同一个 `ItemTooltipContent`。
 */
export function useItemTooltip<T extends HTMLElement = HTMLElement>({
  item,
  atlas,
  stat,
  prefix,
  stack,
  name,
  disabled,
}: ItemTooltipOptions): { ref: RefObject<T | null>; props: ItemTooltipHandlers; node: ReactNode } {
  const ref = useRef<T>(null)
  const [tip, setTip] = useState<TipPosition | null>(null)
  const canTip = !disabled && !!item

  // 提示打开时，滚动 / 缩放立即收起，避免提示停在旧位置。
  useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [tip])

  const open = () => {
    if (!canTip) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = r.top < 128
    const x = Math.min(Math.max(r.left + r.width / 2, TIP_HALF_WIDTH), window.innerWidth - TIP_HALF_WIDTH)
    setTip({ x, y: below ? r.bottom + 6 : r.top - 6, below })
  }
  const close = () => setTip(null)

  const props: ItemTooltipHandlers = {
    onMouseEnter: open,
    onMouseLeave: close,
    onFocus: open,
    onBlur: close,
  }

  const node =
    canTip && tip && item
      ? createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100]"
            style={{
              left: tip.x,
              top: tip.y,
              transform: tip.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
            }}
          >
            <ItemTooltipContent
              item={item}
              atlas={atlas}
              stat={stat}
              prefix={prefix}
              stack={stack}
              name={name}
            />
          </div>,
          document.body,
        )
      : null

  return { ref, props, node }
}
