import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { Send, User } from 'lucide-react'
import { Composer } from '@/components/Composer'
import { ItemIcon } from '@/components/ItemIcon'
import { Badge, Button, Kbd, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  applyCompletion,
  completionSnippet,
  splitSyntaxArg,
  type CompletionItem,
} from '@/lib/completion'
import { useI18n } from '@/lib/i18n'
import type { Atlas } from '@/types'

export interface CommandEditorProps {
  value: string
  onChange: (next: string) => void
  computeCompletions: (text: string, caret: number) => CompletionItem[]
  /**
   * 当前参数的完整用法 + 备注（如 `/accountinfo <username>`）。
   * 下拉框顶部的「指令帮助」条用它：参数位没有值候选时（无人在线 / 自由文本参数）也不空着。
   */
  getHelp?: (
    text: string,
    caret: number,
  ) => { syntax: string; note: string; argName?: string; argRequired?: boolean } | null
  onExecute: () => void
  busy: boolean
  atlas: Atlas | undefined
  /** 编辑器字号（来自界面偏好） */
  fontSize?: number
  /** 外部请求聚焦/插入（例如点击「插入物品」） */
  insertRequest?: { token: number; text: string } | null
  onInsertHandled?: () => void
  /** 递增令牌：变化时聚焦输入框并把光标移到末尾（载入指令/历史时用）。 */
  focusRequest?: number
  /** 指令历史（最新在前）；下拉框关闭时用 ↑/↓ 回翻。 */
  history?: string[]
  /** 只能在游戏内执行（allowServer=false）：输入文本标红提示。 */
  invalid?: boolean
  /** 工具行左侧（如指令库 / 物品 / 收藏 / 历史按钮）。 */
  leading?: ReactNode
  /** 工具行右侧、**发送按钮左边**的额外操作（目前只有聊天页的发送相关按钮用）。 */
  trailing?: ReactNode
  /**
   * 页面级快捷键：不在输入框里时敲 `/` 直接聚焦本输入框。
   *
   * - 草稿为空：顺手补一个 `/`，补全下拉立刻列出全部指令；
   * - 草稿非空：只聚焦并把光标移到末尾，**不**改动已有内容；
   * - 焦点已经在输入框 / 弹框里（任何 `input` / `textarea` / contenteditable）时不抢。
   *
   * 只在指令页开启（浮动终端不抢全局 `/`）。
   */
  slashToFocus?: boolean
  /** 紧凑尺寸（浮动终端用）：降低输入框高度与字号，节省纵向空间。 */
  compact?: boolean
}

export function CommandEditor({
  value,
  onChange,
  computeCompletions,
  getHelp,
  onExecute,
  busy,
  atlas,
  fontSize = 15,
  insertRequest,
  onInsertHandled,
  focusRequest,
  history,
  invalid = false,
  leading,
  trailing,
  slashToFocus = false,
  compact = false,
}: CommandEditorProps) {
  const { t } = useI18n()
  const inputId = useId()
  // 帮助条的 id：输入框用 aria-describedby 指过去，读屏也能读到用法（它现在在浮层里）。
  const helpId = `${inputId}-help`
  const taRef = useRef<HTMLTextAreaElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  // 历史回翻位置（-1 = 未在回翻）。
  const [historyIdx, setHistoryIdx] = useState(-1)
  // 开始回翻前输入框里的草稿：↓ 回到「未在回翻」时原样还原，不能清空。
  const draftRef = useRef('')
  // 幽灵文字要跟着输入框的横向滚动一起挪，否则长指令下会错位。
  const [ghostScroll, setGhostScroll] = useState(0)
  const inputFontSize = compact ? Math.max(12, fontSize - 3) : fontSize
  // 幽灵图层按输入框的横向滚动量整体平移；光靠 onScroll 会漏（删字时 scrollLeft 归零不一定触发事件），
  // 所以每次 value / caret 变化后都对一次，避免长指令之后幽灵文字整体偏左、被已输入文字盖住。
  useLayoutEffect(() => {
    const next = taRef.current?.scrollLeft ?? 0
    setGhostScroll((prev) => (prev === next ? prev : next))
  }, [value, caret, inputFontSize])
  const composingRef = useRef(false)
  const hasFocusedRef = useRef(false)
  const lastFocusRef = useRef(focusRequest)

  // 进入页面：输入框默认聚焦；已有指令时光标停在末尾。
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    const len = ta.value.length
    ta.setSelectionRange(len, len)
    setCaret(len)
    hasFocusedRef.current = true
  }, [])

  // 外部请求聚焦（载入历史/指令后）：焦点回到输入框，光标在末尾。
  useEffect(() => {
    if (focusRequest == null || focusRequest === lastFocusRef.current) return
    lastFocusRef.current = focusRequest
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    const len = ta.value.length
    ta.setSelectionRange(len, len)
    setCaret(len)
    hasFocusedRef.current = true
  }, [focusRequest])

  const items = useMemo(
    // 输入框为空时不弹候选（点一下、聚焦也不会弹）：有内容（如 `/`）才出下拉框。
    () => (open && value.trim() ? computeCompletions(value, caret) : []),
    [open, value, caret, computeCompletions],
  )
  /**
   * 指令用法/备注（供输入框里的幽灵文字与下拉框里的备注条使用）：
   *
   * - 已进入参数区：当前形态的完整用法 + 该形态的备注；
   * - 还在敲指令名：高亮那条指令的用法（说明已经在候选行里，不重复）。
   */
  // 只有真有候选时才弹下拉框：弹出来就该能用 ↑↓ 选。
  // 没有候选（自由文本参数 / 没人在线 / 已经属于多打的第 N 个参数）时不弹空浮层，
  // 用法交给输入框里的幽灵文字，免得「↑↓ 选择」的提示与实际行为对不上。
  const showDropup = open && value.trim().length > 0 && items.length > 0

  const helpLine = useMemo(() => {
    if (!open || !value.trim()) return null
    const typed = getHelp?.(value, caret) ?? null
    if (typed) {
      return { ...typed, arg: splitSyntaxArg(typed.syntax, typed.argName) }
    }
    const item = items[highlight]
    if (item?.kind !== 'command' || !item.command) return null
    // 只说「怎么用」：「是什么」已经在候选行里（别名 + 说明），这里再说一遍就重复了。
    const syntax = item.syntax ? `${item.label} ${item.syntax}` : item.label
    return { syntax, note: '', arg: null }
  }, [open, value, caret, getHelp, items, highlight])

  /**
   * 终端式「幽灵文字」：光标在末尾时，用半透明文字补出**接下来会输入的内容**。
   *
   * - 有候选：补完当前词（正是 Tab / Enter 会接受的那条）——`/worldevent invasion gob` → `lins `；
   * - 没有候选：补完这条指令用法剩下的部分，如 `/accountinfo ` → `<username>`；
   *   说明/备注不塞进输入行（它们在下拉框顶部那条里），否则一行太长太吵。
   *
   * 只画在输入框里、光标后面，不占布局、不参与补全（`aria-hidden`，读屏忽略）。
   */
  const ghostText = useMemo(() => {
    if (busy || !value.trim() || caret !== value.length) return ''
    const wordStart =
      Math.max(value.lastIndexOf(' '), value.lastIndexOf('\n'), value.lastIndexOf('\t')) + 1
    const word = value.slice(wordStart)
    if (showDropup) {
      const item = items[highlight]
      if (item && word) {
        const target = completionSnippet(item)
        if (target.length > word.length && target.toLowerCase().startsWith(word.toLowerCase())) {
          return target.slice(word.length)
        }
      }
    }
    const hint = helpLine
    if (hint && hint.syntax.length > value.length && hint.syntax.toLowerCase().startsWith(value.toLowerCase())) {
      return hint.syntax.slice(value.length)
    }
    // 参数已经敲了具体值（和用法串里的占位符对不上）时，退一步只提示「下一个参数长什么样」。
    if (hint?.argName) {
      return `${hint.argRequired === false ? `[${hint.argName}]` : `<${hint.argName}>`} `
    }
    return ''
  }, [busy, caret, value, showDropup, items, highlight, helpLine])


  // 输入变化就把高亮拉回第一条（帮助条预览的也是第一条）；只在候选条数变化时复位是不够的
  //（同样长度的一批候选里高亮可能停在上一条指令上，预览就会串）。
  useEffect(() => {
    setHighlight(0)
  }, [value, items.length])

  // 方向键移动高亮时，保证选中项始终在可视区域内（候选过多会被容器裁切）。
  // scrollIntoView 在 jsdom 中不存在，故用可选调用保护测试环境。
  useEffect(() => {
    if (!open) return
    optionRefs.current[highlight]?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, open, items.length])

  /**
   * 用原生 insertText 替换 [start, end)，保留浏览器撤销栈；
   * 关键是**先 setSelectionRange 选中要替换的范围**，否则会变成“追加插入”。
   */
  const replaceRangeNative = useCallback(
    (start: number, end: number, snippet: string, fallbackText: string, fallbackCaret: number) => {
      const ta = taRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(start, end)
        const before = ta.value
        const canExec = typeof document.execCommand === 'function'
        const ok = canExec && document.execCommand('insertText', false, snippet)
        if (ok && ta.value !== before) {
          onChange(ta.value)
          const pos = ta.selectionStart ?? fallbackCaret
          setCaret(pos)
          return
        }
        // 还原选区，避免影响后续输入
        ta.setSelectionRange(start, end)
      }
      onChange(fallbackText)
      setCaret(fallbackCaret)
      requestAnimationFrame(() => {
        const el = taRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(fallbackCaret, fallbackCaret)
      })
    },
    [onChange],
  )

  const accept = useCallback(
    (item: CompletionItem) => {
      const applied = applyCompletion(value, caret, item)
      replaceRangeNative(applied.start, applied.end, applied.snippet, applied.text, applied.caret)
      // 保持打开：接受后 value / caret 变化会自动算出下一级候选（没有候选时下拉框会自动隐藏）。
      // 不再「接受参数就关闭」，否则接完 /fish jar 还得再敲一下空格才出 in/out/help，很不对齐终端体验。
      setOpen(true)
    },
    [value, caret, replaceRangeNative],
  )

  /** 处理来自物品搜索面板的插入请求。
   *  编辑器聚焦过 → 插到上次光标处；从未聚焦 → 追加到末尾。 */
  useEffect(() => {
    if (!insertRequest) return
    const ta = taRef.current
    const start = hasFocusedRef.current ? (ta?.selectionStart ?? value.length) : value.length
    const end = hasFocusedRef.current ? (ta?.selectionEnd ?? value.length) : value.length
    replaceRangeNative(
      start,
      end,
      insertRequest.text,
      value.slice(0, start) + insertRequest.text + value.slice(end),
      start + insertRequest.text.length,
    )
    onInsertHandled?.()
  }, [insertRequest, replaceRangeNative, onInsertHandled, value])

  const syncCaret = useCallback(() => {
    const ta = taRef.current
    if (ta) setCaret(ta.selectionStart ?? 0)
  }, [])

  /**
   * 页面级 `/` 快捷键：不在输入框里时聚焦指令输入框（`slashToFocus`）。
   * 弹框 / 抽屉开着时不抢（`/` 应该打进弹框里的搜索框）。
   */
  useEffect(() => {
    if (!slashToFocus) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      ) {
        return
      }
      // 浮层（工具 popover、登录框 / 抽屉等弹框）开着时让 `/` 留在浮层里。
      if (
        document.querySelector(
          '[data-slot="popover-content"], [data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="drawer-content"]',
        )
      ) {
        return
      }
      const ta = taRef.current
      if (!ta) return
      event.preventDefault()
      ta.focus()
      hasFocusedRef.current = true
      // 直接读 textarea 里的当前内容：监听不随每次输入重挂，也不用在渲染期读 ref。
      const empty = ta.value.trim().length === 0
      if (empty) {
        // 空草稿：直接补一个 `/`，补全下拉列出全部指令（再敲字就是筛选）。
        onChange('/')
        setCaret(1)
        setOpen(true)
        requestAnimationFrame(() => ta.setSelectionRange(1, 1))
      } else {
        const len = ta.value.length
        ta.setSelectionRange(len, len)
        setCaret(len)
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [slashToFocus, onChange])

  /** 把整段文本换掉并把光标放到末尾（历史回翻用）。 */
  const setValueAtEnd = useCallback(
    (v: string) => {
      const text = v ?? ''
      onChange(text)
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (!ta) return
        ta.focus()
        ta.setSelectionRange(text.length, text.length)
        setCaret(text.length)
      })
    },
    [onChange],
  )

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const composing = composingRef.current || e.nativeEvent.isComposing
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onExecute()
      return
    }
    // 「下拉框开着」= 和渲染同一个条件（真的有候选）。这样 ↑↓ / Tab / Enter 永远对应「有东西可选」。
    if (showDropup) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => (h + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + items.length) % items.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (composing) return // 输入法确认候选：交给原生处理
        e.preventDefault()
        const item = items[highlight]
        if (item) accept(item)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
      return
    }
    // 下拉框关闭时：↑/↓ 回翻指令历史（终端手感）。
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history && history.length > 0) {
      e.preventDefault()
      // 第一次进入回翻就记住草稿：↑ / ↓ 都算，↓ 回到「未在选择」时原样还回去（不是清空）。
      if (historyIdx === -1) draftRef.current = value
      if (e.key === 'ArrowUp') {
        const next = Math.min(historyIdx + 1, history.length - 1)
        setHistoryIdx(next)
        setValueAtEnd(history[next] ?? '')
      } else {
        // 夹在 [-1, …]：继续减会取到不存在的 `history[-1]`（undefined）写回输入框。
        const next = Math.max(historyIdx - 1, -1)
        setHistoryIdx(next)
        setValueAtEnd(next >= 0 ? (history[next] ?? '') : draftRef.current)
      }
      return
    }
    // 单行编辑器：无补全时 Enter 直接执行，且绝不换行。
    if (e.key === 'Enter' && !composing) {
      e.preventDefault()
      onExecute()
    }
  }

  return (
    <div className="relative">
      <Composer
        leading={leading}
        invalid={invalid}
        compact={compact}
        trailing={
          <>
            {trailing}
            <Button
              size="icon"
              variant="primary"
              className={cn('shrink-0 rounded-full', compact ? 'size-7' : 'size-8')}
              onClick={onExecute}
              disabled={busy}
              aria-label={busy ? t('editor.running') : t('editor.execute')}
              title={busy ? t('editor.running') : t('editor.execute')}
            >
              {busy ? <Spinner aria-hidden /> : <Send data-icon="inline-start" />}
            </Button>
          </>
        }
      >
        <div className="relative min-w-0 flex-1">
          {/* 幽灵文字：和输入框同一行、同一套字体，画在已输入内容之后（半透明）。
              用不可见的前缀占位对齐光标，再按输入框的横向滚动量整体平移。 */}
          {ghostText && (
            <div
              aria-hidden
              data-slot="command-ghost"
              className="pointer-events-none absolute inset-0 overflow-hidden px-1 font-pixel whitespace-pre text-muted-foreground/40 select-none"
              style={{
                fontSize: inputFontSize,
                lineHeight: 1.7,
                transform: `translateX(${-ghostScroll}px)`,
              }}
            >
              <span className="invisible">{value.slice(0, caret)}</span>
              {ghostText}
            </div>
          )}
          <textarea
          ref={taRef}
          id={inputId}
          aria-describedby={helpLine ? helpId : undefined}
          name={inputId}
          rows={1}
          wrap="off"
          className={cn(
            'editor relative w-full min-w-0 resize-none overflow-x-auto overflow-y-hidden bg-transparent px-1',
            compact ? 'h-7' : 'h-8',
            'text-foreground placeholder:text-muted-foreground focus:outline-none',
            invalid && 'text-destructive caret-destructive',
          )}
          style={{ fontSize: inputFontSize }}
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder={t('editor.placeholder')}
          onChange={(e) => {
            // 单行：粘贴/输入的多行内容折叠为空格。
            const next = e.target.value.replace(/\r?\n/g, ' ')
            onChange(next)
            setCaret(e.target.selectionStart ?? 0)
            setOpen(true)
            setHistoryIdx(-1)
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={() => {
            hasFocusedRef.current = true
            syncCaret()
            // 点回输入框时重新弹出候选（终端里回车后再敲也会有）。
            setOpen(true)
          }}
          onFocus={() => {
            hasFocusedRef.current = true
          }}
          onSelect={() => {
            hasFocusedRef.current = true
            syncCaret()
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onScroll={(e) => setGhostScroll(e.currentTarget.scrollLeft)}
          onBlur={() => {
            // 延迟关闭，允许鼠标点击候选项
            window.setTimeout(() => setOpen(false), 150)
          }}
        />
        </div>
      </Composer>

      {showDropup && (
        <div className="absolute bottom-full left-0 z-30 mb-1 flex max-h-[min(20rem,45vh)] w-full flex-col overflow-hidden rounded-container border border-border/60 bg-popover shadow-xl">
          {/* 当前用法（+ 该形态的备注）：纯提示，不参与 ↑↓ 高亮、不响应点击。
              输入框里的幽灵文字只补「接下来输入的那一小段」，这里给的是完整写法，两者互补。 */}
          {helpLine && (
            <div
              id={helpId}
              role="note"
              className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/60 px-3 py-1.5"
            >
              <span className="min-w-0 truncate font-pixel text-xs text-foreground">
                {helpLine.arg ? (
                  <>
                    {helpLine.arg.before}
                    <span className="text-primary">{helpLine.arg.arg}</span>
                    {helpLine.arg.after}
                  </>
                ) : (
                  helpLine.syntax
                )}
              </span>
              {helpLine.note && (
                <span className="min-w-0 flex-1 text-2xs text-muted-foreground">
                  {helpLine.note}
                </span>
              )}
            </div>
          )}
          {items.length > 0 && (
            <ul className="min-h-0 flex-1 overflow-y-auto" role="listbox">
              {items.map((item, idx) => (
                <li key={item.id}>
                  <button
                    ref={(el) => {
                      optionRefs.current[idx] = el
                    }}
                    type="button"
                    role="option"
                    aria-selected={idx === highlight}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => accept(item)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 text-left text-sm focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                      item.kind === 'command' ? 'py-2' : 'py-2',
                      idx === highlight ? 'bg-accent' : 'hover:bg-accent',
                    )}
                  >
                    {item.kind === 'item' && item.item ? (
                      <ItemIcon item={item.item} atlas={atlas} size={26} />
                    ) : (
                      <span
                        className={cn(
                          'grid shrink-0 place-items-center rounded-control font-pixel text-2xs',
                          item.kind === 'command' ? 'size-5 bg-accent text-foreground' : 'size-[26px] bg-warning/25 text-foreground',
                        )}
                      >
                        {item.kind === 'command' ? '/' : item.kind === 'player' ? (
                          <User className="size-3.5" />
                        ) : item.kind === 'prefix' ? (
                          '#'
                        ) : item.kind === 'enum' ? (
                          '='
                        ) : (
                          '/'
                        )}
                      </span>
                    )}
                    {item.kind === 'command' ? (
                      /* 指令候选：指令 / 别名 · 说明 / 权限 一行排开（小屏或装不下时说明换行），
                         每行只占一条高度，一屏能看更多；不需要权限的指令不占位。
                         语法归顶部帮助条，行内不再重复。 */
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="shrink-0 font-pixel text-xs text-foreground">{item.label}</span>
                        {/* 语法不在这里：它在下拉框顶部那条帮助条里（两处都写就是重复）。 */}
                        {item.detail && (
                          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground max-sm:order-last max-sm:basis-full max-sm:overflow-visible max-sm:whitespace-normal">
                            {item.detail}
                          </span>
                        )}
                        {item.command?.permission && (
                          <span className="shrink-0 font-pixel text-2xs text-warning">
                            {item.command.permission}
                          </span>
                        )}
                        {item.inGameOnly && <Badge tone="warn">{t('editor.badge.inGame')}</Badge>}
                      </span>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-foreground">{item.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.detail}
                          </span>
                        </span>
                        {item.inGameOnly && <Badge tone="warn">{t('editor.badge.inGame')}</Badge>}
                        {item.kind === 'item' && (
                          <span className="font-pixel text-2xs text-muted-foreground">
                            ID {(item.item?.id ?? 0)}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* 键盘提示：放在下拉框内、**滚动区之外**（输入框在底部，下拉向上展开）；
              不放进滚动列表，避免选中最底部时被提示条遮住一半。 */}
          <div
            role="presentation"
            className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-3 py-2 text-2xs text-muted-foreground"
          >
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> {t('editor.hint.select')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Tab</Kbd>/<Kbd>Enter</Kbd> {t('editor.hint.accept')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> {t('editor.hint.close')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
