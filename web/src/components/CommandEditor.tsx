import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { User } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { Badge, Button, Kbd, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { applyCompletion, type CompletionItem } from '@/lib/completion'
import { useI18n } from '@/lib/i18n'
import type { Atlas } from '@/types'

export interface CommandEditorProps {
  value: string
  onChange: (next: string) => void
  computeCompletions: (text: string, caret: number) => CompletionItem[]
  /** 当前参数的用法串（TShock 源码原文）；没有参数表时返回 null。 */
  getParamHint?: (text: string, caret: number) => string | null
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
  /** 只能在游戏内执行（allowServer=false）：输入文本标红提示。 */
  invalid?: boolean
}

export function CommandEditor({
  value,
  onChange,
  computeCompletions,
  getParamHint,
  onExecute,
  busy,
  atlas,
  fontSize = 15,
  insertRequest,
  onInsertHandled,
  focusRequest,
  invalid = false,
}: CommandEditorProps) {
  const { t } = useI18n()
  const taRef = useRef<HTMLTextAreaElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
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
    () => (open ? computeCompletions(value, caret) : []),
    [open, value, caret, computeCompletions],
  )
  const paramHint = useMemo(
    () => (getParamHint ? getParamHint(value, caret) : null),
    [getParamHint, value, caret],
  )

  useEffect(() => {
    setHighlight(0)
  }, [items.length])

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
      if (item.kind !== 'command') setOpen(false)
      else setCaret(applied.caret)
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

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const composing = composingRef.current || e.nativeEvent.isComposing
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onExecute()
      return
    }
    if (open && items.length > 0) {
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
    // 单行编辑器：无补全时 Enter 直接执行，且绝不换行。
    if (e.key === 'Enter' && !composing) {
      e.preventDefault()
      onExecute()
    }
  }

  return (
    <div className="relative">
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl bg-accent pr-1.5 pl-3.5',
          'focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring',
          invalid && 'ring-1 ring-destructive/60',
        )}
      >
        <textarea
          ref={taRef}
          rows={1}
          wrap="off"
          className={cn(
            'editor h-12 min-w-0 flex-1 resize-none overflow-x-auto overflow-y-hidden bg-transparent py-2.5',
            'text-foreground placeholder:text-muted-foreground focus:outline-none',
            invalid && 'text-destructive caret-destructive',
          )}
          style={{ fontSize }}
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
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={() => {
            hasFocusedRef.current = true
            syncCaret()
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
          onBlur={() => {
            // 延迟关闭，允许鼠标点击候选项
            window.setTimeout(() => setOpen(false), 150)
          }}
        />
        <Button
          variant="primary"
          className="my-1.5 shrink-0"
          onClick={onExecute}
          disabled={busy}
        >
          {busy && <Spinner aria-hidden data-icon="inline-start" />}
          {busy ? t('editor.running') : t('editor.execute')}
        </Button>
      </div>

      {open && items.length > 0 && (
        <ul
          className={cn(
            'absolute bottom-full left-0 z-30 mb-1 max-h-72 w-full overflow-y-auto',
            'rounded-xl bg-popover shadow-xl',
          )}
          role="listbox"
        >
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
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                  idx === highlight ? 'bg-accent' : 'hover:bg-accent',
                )}
              >
                {item.kind === 'item' && item.item ? (
                  <ItemIcon item={item.item} atlas={atlas} size={26} />
                ) : (
                  <span
                    className={cn(
                      'grid size-[26px] shrink-0 place-items-center rounded-md font-pixel text-[11px]',
                      item.kind === 'command' ? 'bg-accent text-foreground' : 'bg-warning/25 text-foreground',
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
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                  {item.kind === 'command' && (
                    <span
                      className={cn(
                        'mt-0.5 block truncate font-pixel text-[10px]',
                        item.command?.permission ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {item.command?.permission
                        ? t('editor.permission', { perm: item.command.permission })
                        : t('editor.permissionNone')}
                    </span>
                  )}
                </span>
                {item.inGameOnly && <Badge tone="warn">{t('editor.badge.inGame')}</Badge>}
                {item.kind === 'item' && (
                  <span className="font-pixel text-[10px] text-muted-foreground">
                    ID {(item.item?.id ?? 0)}
                  </span>
                )}
              </button>
            </li>
          ))}
          {/* 键盘提示：放在下拉框内（输入框在底部，下拉向上展开） */}
          <li
            role="presentation"
            className="sticky bottom-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 bg-popover px-3 py-1.5 text-[11px] text-muted-foreground"
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
          </li>
        </ul>
      )}

      {paramHint && (
        <p className="mt-2 truncate font-pixel text-[11px] text-muted-foreground" title={paramHint}>
          {paramHint}
        </p>
      )}
    </div>
  )
}
