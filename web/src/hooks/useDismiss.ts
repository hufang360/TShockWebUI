import { useEffect, type RefObject } from 'react'

/**
 * 让浮层（下拉/弹出面板）在「点击外部」或「按 Esc」时关闭。
 *
 * `ref` 需覆盖触发按钮 + 面板本身（通常就是最外层 `relative` 容器），
 * 这样点击触发按钮不会被误判为「外部点击」。
 */
export function useDismiss<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current
      if (el && !el.contains(event.target as Node)) onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, active, onDismiss])
}
