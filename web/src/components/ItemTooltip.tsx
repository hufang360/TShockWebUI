import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ItemTooltipContent } from '@/components/ItemTooltipContent'
import type { Atlas, Item, ItemStatEntry } from '@/types'

/** 提示最大宽度 384px（`max-w-96`）；贴近视口边缘时按半宽夹取。 */
const TIP_HALF_WIDTH = 200
/** 与视口边缘保留的间距（防止顶部/底部被裁）。 */
const TIP_MARGIN = 8
/** 鼠标悬停后延迟弹出：太容易触发会遮 UI；未到时间就移走则不弹。 */
const OPEN_DELAY = 350
/** 关闭延迟：鼠标从触发元素移到提示上时不至于“穿过”空隙就消失。 */
const CLOSE_DELAY = 150

/**
 * 全局只允许一个提示存在：鼠标快速滑过多个物品时，新提示打开会**立即**关掉上一个，
 * 否则每个实例各自 150ms 延迟关闭，会出现好几个提示叠在一起。
 */
let closeActiveTooltip: (() => void) | null = null

/** 立即收起当前物品提示（点图标打开详情前调用）。 */
export function closeItemTooltip() {
  closeActiveTooltip?.()
}

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
  /** 不显示提示底部的「合成表」入口（格子图标点一下就能开详情时用）。 */
  hideRecipeLink?: boolean
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
 * 抽出来的原因：提示不只挂在图标画框上 —— 部分列表条目把提示绑在整张卡片上，
 * 而 `ItemIcon` 只需要绑在自己的 canvas 外层。两者共用同一份定位/收起逻辑与同一个 `ItemTooltipContent`。
 */
export function useItemTooltip<T extends HTMLElement = HTMLElement>({
  item,
  atlas,
  stat,
  prefix,
  stack,
  name,
  hideRecipeLink,
  disabled,
}: ItemTooltipOptions): { ref: RefObject<T | null>; props: ItemTooltipHandlers; node: ReactNode } {
  const ref = useRef<T>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<TipPosition | null>(null)
  const closeTimer = useRef<number | null>(null)
  const openTimer = useRef<number | null>(null)
  const canTip = !disabled && !!item

  // 关闭有 150ms 延迟：鼠标从触发元素移到提示上时不至于“穿过”空隙就消失（提示可悬停/选中文字）。
  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  /** 取消待弹出的延迟（未到时间就移走 → 不弹）。 */
  const cancelOpen = () => {
    if (openTimer.current != null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }
  /** 立即关闭（用于互斥地关掉其它提示 / 滚动收起）。 */
  const closeNow = () => {
    cancelOpen()
    cancelClose()
    setTip(null)
  }
  const scheduleClose = () => {
    cancelOpen()
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setTip(null)
    }, CLOSE_DELAY)
  }

  useEffect(
    () => () => {
      cancelClose()
      cancelOpen()
    },
    [],
  )

  // 提示打开后实测高度：顶部/底部会被裁时翻到另一侧，仍放不下就夹到视口内。
  // useLayoutEffect 在浏览器绘制前完成修正，不会闪。
  useLayoutEffect(() => {
    if (!tip) return
    const el = contentRef.current
    const anchor = ref.current
    if (!el || !anchor) return
    const r = el.getBoundingClientRect()
    const a = anchor.getBoundingClientRect()
    let next = tip
    if (!tip.below && r.top < TIP_MARGIN) {
      next = { x: tip.x, y: a.bottom + 6, below: true }
    } else if (tip.below && r.bottom > window.innerHeight - TIP_MARGIN) {
      next = { x: tip.x, y: a.top - 6, below: false }
    }
    // 翻转后仍溢出（提示比可用空间还高）：直接把朝向边缘的一侧夹到 margin。
    if (next !== tip) {
      setTip(next)
    } else if (!tip.below && r.top < TIP_MARGIN) {
      setTip({ ...tip, y: TIP_MARGIN + r.height })
    } else if (tip.below && r.bottom > window.innerHeight - TIP_MARGIN) {
      setTip({ ...tip, y: window.innerHeight - TIP_MARGIN - r.height })
    }
    // 仅在 token 变化时重测
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip])

  // 提示打开时，滚动 / 缩放立即收起，避免提示停在旧位置。
  useEffect(() => {
    if (!tip) return
    window.addEventListener('scroll', closeNow, true)
    window.addEventListener('resize', closeNow)
    return () => {
      window.removeEventListener('scroll', closeNow, true)
      window.removeEventListener('resize', closeNow)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip])

  const openNow = () => {
    if (!canTip) return
    const el = ref.current
    if (!el) return
    cancelOpen()
    cancelClose()
    // 只保留一个提示：立即关掉上一个实例的提示。
    closeActiveTooltip?.()
    closeActiveTooltip = closeNow
    const r = el.getBoundingClientRect()
    const below = r.top < 128
    const x = Math.min(Math.max(r.left + r.width / 2, TIP_HALF_WIDTH), window.innerWidth - TIP_HALF_WIDTH)
    setTip({ x, y: below ? r.bottom + 6 : r.top - 6, below })
  }

  /** 鼠标悬停：延迟弹出（未到时间就移走则不弹）。 */
  const scheduleOpen = () => {
    if (!canTip) return
    cancelOpen()
    cancelClose()
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      openNow()
    }, OPEN_DELAY)
  }

  const props: ItemTooltipHandlers = {
    onMouseEnter: scheduleOpen,
    onMouseLeave: scheduleClose,
    // 键盘聚焦直接弹出（无障碍：不受鼠标延迟影响）。
    onFocus: openNow,
    onBlur: scheduleClose,
  }

  const node =
    canTip && tip && item
      ? createPortal(
          <div
            ref={contentRef}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            // React Portal 的事件仍会沿 React 树冒泡；阻断后，点提示文字不会触发下方格子的详情。
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            /* 唯一手写 z-index：提示会从 Sheet / Dialog（都是 z-50）内部触发，portal 到 body 后
               必须盖在它们上面。属于自研 Terraria 风格富文本提示（非 shadcn Tooltip），
               无法复用组件的自管堆叠。见 docs/UI组件.md「已核实的例外」。 */
            className="pointer-events-auto fixed z-[100]"
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
              hideRecipeLink={hideRecipeLink}
            />
          </div>,
          document.body,
        )
      : null

  return { ref, props, node }
}
