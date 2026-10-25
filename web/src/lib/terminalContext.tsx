import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 浮动终端（桌面临时指令窗口）的开关状态。
 *
 * 挂在 App 层只渲染一份：入口是右下角的 `TerminalFab`，执行结果 / 输入草稿 / 正在执行的指令
 * 都跟着同一个实例走——切换页面不会丢，也不会出现两个终端各记一份结果。
 */
export interface TerminalApi {
  isOpen: boolean
  /** 打开终端；给定文本时**覆盖**输入框草稿（如「指令小抄」页点一条记录）。 */
  open: (text?: string) => void
  close: () => void
  toggle: () => void
  /** 最近一次带文本打开请求（token 变化才生效）。 */
  request: { token: number; text: string } | null
}

const noop = () => {}

const TerminalContext = createContext<TerminalApi>({
  isOpen: false,
  open: noop,
  close: noop,
  toggle: noop,
  request: null,
})

/** 终端快捷键：Ctrl/Cmd + `（与终端类应用的习惯一致，不占用输入字符）。 */
export function isTerminalShortcut(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  return event.key === '`' && (event.ctrlKey || event.metaKey) && !event.altKey
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [request, setRequest] = useState<{ token: number; text: string } | null>(null)
  const seq = useRef(0)

  const open = useCallback((text?: string) => {
    if (typeof text === 'string') {
      seq.current += 1
      setRequest({ token: seq.current, text })
    }
    setIsOpen(true)
  }, [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTerminalShortcut(event)) return
      // 即使焦点在输入框里也要生效：Ctrl+` 不会产生字符，不会干扰输入法。
      event.preventDefault()
      setIsOpen((prev) => !prev)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const value = useMemo<TerminalApi>(
    () => ({ isOpen, open, close, toggle, request }),
    [isOpen, open, close, toggle, request],
  )
  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>
}

export function useTerminal(): TerminalApi {
  return useContext(TerminalContext)
}
