import { useEffect, useRef, useState, type ReactNode } from 'react'

interface FullscreenDockProps {
  /** 收起后那条小竖条的无障碍名称 / 提示。 */
  label: string
  children: ReactNode
}

/** 展开后无操作多久自动收起（毫秒）。 */
const IDLE_COLLAPSE_MS = 4000

/**
 * 全屏结果页**右上角**的操作坞：进入全屏先显示几秒，随后收成贴右边的一条小竖条
 * （左侧上下圆角、右侧直角）；悬停 / 聚焦 / 点击会重新展开，展开后 4 秒无操作再收起。
 *
 * 全屏时页面没有顶栏，设置与退出全屏只能放在内容之上，固定在右上角最不容易挡住列表。
 */
export function FullscreenDock({ label, children }: FullscreenDockProps) {
  const [expanded, setExpanded] = useState(true)
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const timer = useRef<number | null>(null)

  // 展开但没有交互（悬停 / 聚焦）时，延迟收起；任何一次交互都会重置计时。
  useEffect(() => {
    if (!expanded || hover || focused) {
      if (timer.current != null) window.clearTimeout(timer.current)
      timer.current = null
      return
    }
    timer.current = window.setTimeout(() => {
      setExpanded(false)
      timer.current = null
    }, IDLE_COLLAPSE_MS)
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [expanded, hover, focused])

  return (
    <div
      className="absolute top-2 right-0 z-30"
      onMouseEnter={() => {
        setHover(true)
        setExpanded(true)
      }}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {expanded ? (
        <div className="mr-2 flex flex-col items-center gap-1 rounded-xl border border-border/60 bg-card/95 p-1 shadow-sm backdrop-blur">
          {children}
        </div>
      ) : (
        <button
          type="button"
          aria-label={label}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          onFocus={() => {
            setFocused(true)
            setExpanded(true)
          }}
          className="block h-14 w-3 cursor-pointer rounded-l-full rounded-r-none bg-border transition-colors hover:bg-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      )}
    </div>
  )
}
