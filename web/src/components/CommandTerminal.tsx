import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ExternalLink, Terminal, Trash2, X } from 'lucide-react'
import { CommandEditor } from '@/components/CommandEditor'
import { ConfirmButton } from '@/components/ConfirmButton'
import { LoginGate } from '@/components/LoginGate'
import { ResultPanel } from '@/components/ResultPanel'
import {
  Button,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { useCommandEditing } from '@/hooks/useCommandEditing'
import { useCommandHistory } from '@/hooks/useCommandHistory'
import { useCommandResultsList } from '@/hooks/useCommandResultsList'
import { useCommandRunner } from '@/hooks/useCommandRunner'
import { useLocalState } from '@/hooks/useLocalState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useI18n } from '@/lib/i18n'
import { StorageKeys, writeJson } from '@/lib/storage'
import { useTerminal } from '@/lib/terminalContext'
import {
  clampTerminalRect,
  defaultTerminalRect,
  sanitizeTerminalRect,
  type TerminalRect,
} from '@/lib/terminalWindow'
import type { BackendTransport } from '@/lib/tshock'
import type { Dataset, Settings, TabId } from '@/types'

interface CommandTerminalProps {
  /** 当前页面是否允许显示终端（「指令」「设置」两页为 false）。 */
  visible: boolean
  dataset: Dataset
  transport: BackendTransport
  authenticated: boolean
  serverId: string
  players: string[]
  ingameAllowed: boolean
  runtimeValues: { regions?: string[]; warps?: string[] }
  settings: Settings
  onTokenInvalid: () => Promise<boolean>
  onLogin: () => void
  onNavigate: (tab: TabId) => void
}

const viewport = () => ({
  w: typeof window === 'undefined' ? 1024 : window.innerWidth || 1024,
  h: typeof window === 'undefined' ? 768 : window.innerHeight || 768,
})

/** 桌面端从 `md`（768px）起用浮动窗口；更窄改用底部抽屉，避免浮窗占掉整屏。 */
const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * 浮动终端：桌面端是非模态可拖动 / 缩放的小窗，窄屏是底部抽屉。
 *
 * - 输入框固定在底部：`CommandEditor` 的补全下拉向上展开，这样才不会被窗口底部裁掉；
 * - 结果与指令页**共用** `tswui:commandResults` / `tswui:history`（key 与服务器一致），
 *   在终端里跑的指令，切到指令页能直接看到；
 * - 输入草稿独立（`tswui:terminal:draft`）：执行后清空输入，不能顺手抹掉指令页的草稿；
 * - 关闭时组件不卸载，正在执行的指令继续走完，重新打开就能看到结果。
 */
export function CommandTerminal({
  visible,
  dataset,
  transport,
  authenticated,
  serverId,
  players,
  ingameAllowed,
  runtimeValues,
  settings,
  onTokenInvalid,
  onLogin,
  onNavigate,
}: CommandTerminalProps) {
  const { t } = useI18n()
  const { isOpen, close, request } = useTerminal()
  const desktop = useMediaQuery(DESKTOP_QUERY)

  // 草稿 / 结果 / 历史与指令页的关系见组件注释。
  const [text, setText] = useLocalState(StorageKeys.terminalDraft, '')
  const { results, append, remove, toggleCollapse, clear } = useCommandResultsList(serverId)
  const { history, push: pushHistory } = useCommandHistory()
  const { running, run } = useCommandRunner({
    dataset,
    transport,
    authenticated,
    ingameAllowed,
    onTokenInvalid,
    appendResult: append,
    pushHistory,
  })

  // ---- 窗口几何（只在桌面端有意义）----
  const [storedRect, setStoredRect] = useLocalState<TerminalRect | null>(StorageKeys.terminal, null)
  const [rect, setRect] = useState<TerminalRect>(() => {
    const view = viewport()
    return clampTerminalRect(
      sanitizeTerminalRect(storedRect) ?? defaultTerminalRect(view.w, view.h),
      view.w,
      view.h,
    )
  })
  const rectRef = useRef(rect)
  const commitRect = useCallback((next: TerminalRect) => {
    rectRef.current = next
    setRect(next)
  }, [])

  // 切到「指令」「设置」页时自动收起：这两页不需要终端，浮窗留在上面只是干扰。
  // （正在执行的指令不受影响，结果照样写进共用的结果列表。）
  useEffect(() => {
    if (!visible && isOpen) close()
  }, [visible, isOpen, close])

  // 打开时按当前视口重新夹一次（换了显示器 / 缩放 / 窗口刚变小都可能失效）。
  useEffect(() => {
    if (!isOpen) return
    const view = viewport()
    commitRect(clampTerminalRect(rectRef.current, view.w, view.h))
  }, [isOpen, commitRect])

  useEffect(() => {
    const onResize = () => {
      const view = viewport()
      commitRect(clampTerminalRect(rectRef.current, view.w, view.h))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [commitRect])

  // 关闭：Esc 优先给补全下拉（它会 preventDefault），否则才关终端。
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, close])

  // 外部带文本打开（如「小抄」页点一条记录）：覆盖草稿并让输入框重新聚焦。
  const [focusToken, setFocusToken] = useState(0)
  useEffect(() => {
    if (!request) return
    setText(request.text)
    setFocusToken((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token])

  // ---- 执行 ----
  // 前端执行策略 / 补全 / 参数提示：与指令页共用一份实现。
  const { check, getCompletions, getHelp } = useCommandEditing({
    dataset,
    text,
    players,
    language: settings.language,
    runtimeValues,
  })

  const submit = useCallback(() => {
    if (running) return
    const value = text
    void run(value).then((outcome) => {
      // 只有真的发出去了才清空；被前置校验拒绝时保留输入，方便改。
      if (outcome.dispatched) setText('')
    })
  }, [run, running, text, setText])

  const openInCommandPage = useCallback(() => {
    if (text.trim()) writeJson(StorageKeys.draft, text)
    close()
    onNavigate('editor')
  }, [close, onNavigate, text])

  // ---- 拖动 ----
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!desktop || event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rectRef.current.x,
      offsetY: event.clientY - rectRef.current.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const view = viewport()
    commitRect(
      clampTerminalRect(
        {
          ...rectRef.current,
          x: event.clientX - drag.offsetX,
          y: event.clientY - drag.offsetY,
        },
        view.w,
        view.h,
      ),
    )
  }
  const onDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setStoredRect(rectRef.current)
  }

  // ---- 缩放（右下角手柄）----
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; w: number; h: number } | null>(
    null,
  )
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!desktop || event.button !== 0) return
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      w: rectRef.current.w,
      h: rectRef.current.h,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const view = viewport()
    commitRect(
      clampTerminalRect(
        {
          ...rectRef.current,
          w: resize.w + (event.clientX - resize.startX),
          h: resize.h + (event.clientY - resize.startY),
        },
        view.w,
        view.h,
      ),
    )
  }
  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setStoredRect(rectRef.current)
  }

  if (!isOpen) return null

  // 右上角图标按钮统一 hover 出 Tooltip（`title` 保留，触屏 / 读屏也有名称）。
  const actions = (
    <TooltipProvider delayDuration={150}>
      <div className="flex shrink-0 items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <ConfirmButton
                size="icon-sm"
                onConfirm={clear}
                disabled={results.length === 0}
                confirmLabel={t('action.clearConfirm')}
                icon={<Trash2 data-icon="inline-start" />}
                aria-label={t('result.clear')}
                title={t('result.clear')}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{t('result.clear')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={openInCommandPage}
              aria-label={t('terminal.openInCommand')}
              title={t('terminal.openInCommand')}
            >
              <ExternalLink />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('terminal.openInCommand')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="max-md:hidden"
              onClick={close}
              aria-label={t('terminal.close')}
              title={t('terminal.close')}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('terminal.close')}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )

  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <Terminal className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-semibold tracking-wide text-foreground">
        {t('terminal.title')}
      </span>
      {running && <Spinner className="size-3.5 text-muted-foreground" />}
    </span>
  )

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <ResultPanel
          entries={results}
          running={running}
          itemsById={dataset.itemsById}
          prefixesById={dataset.prefixesById}
          atlas={dataset.atlas}
          onRemove={remove}
          onToggleCollapse={toggleCollapse}
          onFillCommand={(cmd) => {
            // 只填进终端输入框（不执行），并让输入框重新聚焦。
            setText(cmd)
            setFocusToken((n) => n + 1)
          }}
        />
      </div>
      <Separator />
      <div className="shrink-0 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {authenticated ? (
          <CommandEditor
            value={text}
            onChange={setText}
            computeCompletions={getCompletions}
            getHelp={getHelp}
            onExecute={submit}
            busy={running}
            atlas={dataset.atlas}
            fontSize={settings.fontSize}
            invalid={check.executability === 'in_game_only' && !ingameAllowed}
            focusRequest={focusToken}
            compact
            history={history.map((h) => h.cmd)}
          />
        ) : (
          <LoginGate onLogin={onLogin} />
        )}
      </div>
    </div>
  )

  // 窄屏：底部抽屉（模态，输入框跟着软键盘上移由浏览器 / 抽屉处理）。
  if (!desktop) {
    return (
      <Sheet
        open={isOpen}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <SheetContent
          side="bottom"
          className="flex h-[80dvh] flex-col gap-2 p-0"
          aria-describedby={undefined}
        >
          <SheetHeader className="flex-row items-center justify-between gap-2 border-b border-border/60 px-3 py-2 pr-10">
            <SheetTitle className="flex min-w-0 flex-1">{title}</SheetTitle>
            {actions}
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('terminal.title')}
      data-testid="terminal-window"
      className="fixed z-40 flex flex-col overflow-hidden rounded-container border border-border/60 bg-card text-card-foreground shadow-2xl"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        data-testid="terminal-drag-handle"
        className="flex shrink-0 cursor-grab touch-none items-center gap-2 border-b border-border/60 px-3 py-2 select-none active:cursor-grabbing"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="flex min-w-0 flex-1">{title}</div>
        {actions}
      </div>
      {body}
      <div
        data-testid="terminal-resize-handle"
        aria-hidden
        className="absolute right-0 bottom-0 z-10 size-4 cursor-nwse-resize touch-none"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      >
        <span className="pointer-events-none absolute right-1 bottom-1 size-2 rounded-chip border-r-2 border-b-2 border-muted-foreground/40" />
      </div>
    </div>
  )
}
