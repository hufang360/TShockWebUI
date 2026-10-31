import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { History, X } from 'lucide-react'
import { Button, InputGroup, InputGroupAddon, InputGroupInput, Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { SEARCH_HISTORY_MAX, SEARCH_HISTORY_NARROW_MAX } from '@/lib/searchHistory'

type SearchInputProps = Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
  /** 输入框自身的额外类（如整体大一号：`text-sm`）。 */
  inputClassName?: string
  /** 「最近搜索」：在下方下拉框里展示（类似代码补全），点一下填入。 */
  history?: readonly string[]
  /** 点击「最近搜索」时的回调；缺省时回落到 `onValueChange`。 */
  onHistorySelect?: (value: string) => void
  /** 删除单条最近搜索记录。 */
  onHistoryRemove?: (value: string) => void
  /** 下拉框顶部的小标题（默认「最近搜索」）。 */
  historyHeader?: string
  /**
   * 聚焦时是否立刻弹出「最近搜索」，**默认 `false`**。
   *
   * 页面进入时会自动聚焦搜索框，若有历史就会立刻盖住结果（像被强行塞了个菜单）。
   * 现在的规则：**只在打字时**弹（边输边筛），想直接看历史就点输入框右侧的历史按钮；
   * 需要旧行为可显式传 `true`。
   */
  historyOnFocus?: boolean
  /** 是否在输入框内显示「最近搜索」按钮（有历史时才出现），默认 `true`。 */
  historyToggle?: boolean
  /** 打字时是否自动展开「最近搜索」下拉，默认 `true`；物品图鉴改为 `false`（只点按钮展开）。 */
  historyOnInput?: boolean
  /** 输入框左侧的前置图标（如放大镜），走 `InputGroup` 的 inline-start addon。 */
  leadingIcon?: ReactNode
  /** 输入框最右侧的操作图标（如搜索放大镜）。 */
  trailingIcon?: ReactNode
  /**
   * 输入框**外面再挂一个 addon**（同一 `InputGroup` 里的 `inline-end`，例如「物品收藏」按钮）：
   * 与输入框是一个整体（没有缝隙），也不会被「最近搜索 / `/` 提示」顶掉。
   */
  trailingAddon?: ReactNode
  /**
   * 搜索结果的条数文案（已翻译，如「12 个结果」），显示在输入框右侧。
   *
   * **失焦且没有内容时让位给快捷键提示**（`shortcut`），与「最近搜索」同一个位置。
   */
  resultLabel?: ReactNode
  /**
   * 页面内的 `/` 快捷键：失焦且输入框为空时在右侧显示 `kbd` 提示，按 `/` 聚焦它。
   *
   * 只给**页面级**搜索框开（物品 ID / 数据 ID / 指令小抄 / 鱼店 / 玩家管理）；
   * 弹框、面板里的搜索框不要开（会和指令页的 `/` 抢焦点）。
   */
  shortcut?: boolean
}

/**
 * 紧凑搜索框：右侧内嵌圆形 ✕（有内容时才出现），点击清空并保持焦点。
 * 基于 shadcn `InputGroup`（不用 relative + 绝对定位）。
 *
 * 带 `history` 时：**打字**（或点右侧历史按钮）会在下方下拉框里显示「最近搜索」，
 * 可像代码补全那样边输边筛；**聚焦本身不弹**（页面进入会自动聚焦，见 `historyOnFocus`）。
 */
export function SearchInput({
  value,
  onValueChange,
  className,
  inputClassName,
  history,
  onHistorySelect,
  onHistoryRemove,
  historyHeader,
  historyOnFocus = false,
  historyToggle = true,
  historyOnInput = true,
  leadingIcon,
  trailingIcon,
  resultLabel,
  trailingAddon,
  shortcut = false,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: SearchInputProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const q = value.trim().toLowerCase()
  const items = history && history.length > 0
    ? q
      ? history.filter((h) => h.toLowerCase().includes(q))
      : history
    : []
  // 统一规则：宽区域最多展示 10 条，窄区域（< 420px）只展示前 5 条。
  const shown = items.slice(0, narrow ? SEARCH_HISTORY_NARROW_MAX : SEARCH_HISTORY_MAX)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setNarrow(el.clientWidth < 420)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const showList = open && shown.length > 0
  /** 失焦且没有内容：右侧让位给 `/` 快捷键提示（有内容 / 聚焦时显示结果数与最近搜索）。 */
  const idle = !focused && value.length === 0
  const showShortcut = idle && shortcut

  // 页面级 `/`：不在输入框里时聚焦本搜索框（`/` 本身不是搜索词的一部分，只负责聚焦）。
  useEffect(() => {
    if (!shortcut) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      ) {
        return
      }
      // 浮层（指令工具弹框、抽屉、弹框）开着时让 `/` 留在浮层里。
      if (
        document.querySelector(
          '[data-slot="popover-content"], [data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="drawer-content"]',
        )
      ) {
        return
      }
      const input = rootRef.current?.querySelector('input')
      if (!input) return
      event.preventDefault()
      input.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcut])

  // 点到输入框 / 历史按钮以外的地方收起下拉（历史按钮在容器内，不会误关）。
  useEffect(() => {
    if (!showList) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showList])

  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    setFocused(true)
    if (historyOnFocus) setOpen(true)
    onFocus?.(e)
  }
  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    setFocused(false)
    // 延迟关闭，允许鼠标点候选（onMouseDown preventDefault 已避免失焦，这里兜底）。
    window.setTimeout(() => setOpen(false), 150)
    onBlur?.(e)
  }
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
    // 回车 = 结束输入：收起历史下拉并失焦（搜索本身实时生效）。
    if (e.key === 'Enter') {
      setOpen(false)
      e.currentTarget.blur()
    }
    onKeyDown?.(e)
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <InputGroup className={cn('h-8 w-full', className)}>
        {leadingIcon && (
          <InputGroupAddon align="inline-start" className="pr-0">
            {leadingIcon}
          </InputGroupAddon>
        )}
        <InputGroupInput
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value)
            // 输入时是否自动打开历史下拉由 historyOnInput 决定（物品图鉴只点按钮展开）。
            if (historyOnInput) setOpen(true)
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn('px-3 text-xs', inputClassName)}
          aria-keyshortcuts={shortcut ? '/' : undefined}
          {...props}
        />
        {(showShortcut ||
          resultLabel != null ||
          (historyToggle && items.length > 0) ||
          value.length > 0 ||
          trailingIcon != null) && (
          <InputGroupAddon align="inline-end">
            {showShortcut && (
              <Kbd
                title={t('search.shortcut')}
                data-testid="search-shortcut"
                className="h-5 min-w-5 border border-border/60 bg-background/70 px-1 text-2xs text-muted-foreground"
              >
                /
              </Kbd>
            )}
            {!showShortcut && resultLabel != null && (
              <span className="px-1 text-xs text-muted-foreground tabular-nums">{resultLabel}</span>
            )}
            {!showShortcut && historyToggle && items.length > 0 && (
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn(
                  'rounded-full text-muted-foreground hover:text-foreground',
                  showList && 'bg-accent text-foreground',
                )}
                aria-label={t('search.recent')}
                aria-expanded={showList}
                title={t('search.recent')}
                // 不让输入框失焦（失焦会延迟关闭下拉）。
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen((v) => !v)}
              >
                <History data-icon="inline-start" />
              </Button>
            )}
            {!showShortcut && value.length > 0 && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="rounded-full text-muted-foreground hover:text-foreground"
                aria-label={t('editor.clear')}
                title={t('editor.clear')}
                onClick={() => {
                  onValueChange('')
                  setOpen(false)
                }}
              >
                <X data-icon="inline-start" />
              </Button>
            )}
            {!showShortcut && trailingIcon}
          </InputGroupAddon>
        )}
        {trailingAddon != null && (
          <InputGroupAddon align="inline-end" className="pl-0">
            {trailingAddon}
          </InputGroupAddon>
        )}
      </InputGroup>
      {showList && (
        <ul
          role="listbox"
          data-testid="search-history-list"
          className="absolute top-full left-0 z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-container bg-popover py-1 shadow-xl"
        >
          <li className="px-3 py-1 text-2xs text-muted-foreground">
            {historyHeader ?? t('search.recent')}
          </li>
          {shown.map((h) => (
            <li key={h} className="flex items-center gap-1 pr-1">
              <button
                type="button"
                role="option"
                aria-selected={false}
                data-testid="search-history-item"
                // 防止点击时输入框失焦（失焦会触发延迟关闭）。
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (onHistorySelect) onHistorySelect(h)
                  else onValueChange(h)
                  setOpen(false)
                }}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <History className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{h}</span>
              </button>
              {onHistoryRemove && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('search.remove')}
                  title={t('search.remove')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onHistoryRemove(h)}
                  className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
