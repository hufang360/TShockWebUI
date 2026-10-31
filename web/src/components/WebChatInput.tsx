import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import { Composer } from '@/components/Composer'
import { Button, Spinner, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { TshockRequestError, type BackendTransport } from '@/lib/tshock'

interface WebChatInputProps {
  transport: BackendTransport
  /** 受控文本；不传时由组件自己保存。 */
  value?: string
  onValueChange?: (value: string) => void
  /** 未登录 / 插件缺失时禁用。 */
  disabled?: boolean
  /**
   * 信使插件是否已确认可用（事件流能用）。
   * 用于把「发言端点 404」区分为「插件版本过旧」而不是「未安装」。
   */
  pluginInstalled?: boolean
  /** 发送成功后回调（父组件据此刷新事件流，让发言立刻上屏）。 */
  onSent?: () => void
  /** 紧凑模式（更矮的输入框）。 */
  compact?: boolean
  /** 发送按钮左边的附加操作（「聊天」页放刷新 / 上次刷新 / 终端入口）。 */
  actions?: ReactNode
  /** 工具行左侧（发送框左下角）的附加操作，如「物品」图标。 */
  leadingActions?: ReactNode
  /** 页面级 `/` 快捷键：不在输入框里时聚焦这里（与指令页一致）。 */
  slashToFocus?: boolean
  /** 值变化即把焦点交回输入框并把光标放到末尾（如刚插入物品标签）。 */
  focusRequest?: number
  className?: string
}

/**
 * 网页发言输入框（「聊天」页底部常驻）。
 *
 * - 发送到游戏内聊天（插件加前缀，默认 `[WebUI]`，与真实玩家区分）；
 * - 发送按钮在输入框内部右侧，使用与指令发送一致的主色飞机按钮；
 * - 失败保留输入，可就地「重试」，不造假成功；
 * - 插件缺失 / 版本过旧 / 未登录时禁用或给出可定位的提示。
 * - 发送成功用 sonner 提示（`已发送（显示为 [WebUI] hf）`）：可堆叠、带关闭按钮、数秒自动消失，
 *   不再占用输入框里的一行。
 */
export function WebChatInput({
  transport,
  value,
  onValueChange,
  disabled = false,
  pluginInstalled,
  onSent,
  compact = false,
  actions,
  leadingActions,
  slashToFocus = false,
  focusRequest,
  className,
}: WebChatInputProps) {
  const { t } = useI18n()
  const [internalText, setInternalText] = useState('')
  const text = value ?? internalText
  const setText = onValueChange ?? setInternalText
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // 发送期间**不禁用输入框**：禁用会让浏览器把焦点从输入框摘掉（用户会以为「点发送 / 敲回车后焦点没了」）。
  // 代价是发送途中可能又敲了字，所以成功后只在文本没被改过时才清空。
  const inputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  const send = async () => {
    const value = text.trim()
    if (!value || sending || disabled) return
    setSending(true)
    setError('')
    try {
      const res = await transport.sendChat(value)
      if (textRef.current.trim() === value) setText('')
      toast.success(t('feed.chatSent', { name: res.name }))
      onSent?.()
    } catch (err) {
      if (err instanceof TshockRequestError && (err.kind === 'plugin_outdated' || err.kind === 'plugin_protocol')) {
        setError(t('feed.chatOutdated'))
      } else if (err instanceof TshockRequestError && err.kind === 'plugin_missing' && pluginInstalled) {
        // 事件流能用、发言端点却 404：插件是旧版而非没装。
        setError(t('feed.chatOutdated'))
      } else {
        setError(err instanceof Error ? err.message : t('feed.chatFailed'))
      }
    } finally {
      setSending(false)
    }
  }

  const canRetry = text.trim().length > 0 && !sending && !disabled

  /** 页面级 `/`：不在输入框里时聚焦这里（浮层开着时让 `/` 留在浮层里）。 */
  useEffect(() => {
    if (!slashToFocus) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
        return
      }
      if (
        document.querySelector(
          '[data-slot="popover-content"], [data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="drawer-content"]',
        )
      ) {
        return
      }
      const el = inputRef.current
      if (!el || el.disabled) return
      event.preventDefault()
      el.focus()
      // 聊天不是指令：不补 `/`，只是把光标放到末尾继续打字。
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [slashToFocus])

  // 只在 `focusRequest` **变化**时抢焦点：挂载时（初始值）不能抢，否则页面一进来焦点就跳。
  const lastFocusRequest = useRef(focusRequest)
  /** 外部插入（物品标签等）后把光标交回输入框末尾。 */
  useEffect(() => {
    if (focusRequest === lastFocusRequest.current) return
    lastFocusRequest.current = focusRequest
    const el = inputRef.current
    if (!el || el.disabled) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [focusRequest])

  // 失败提示（含「重试」）放在输入框的**左下角**：工具行左侧、发送按钮旁边，
  // 不另起一行把输入区顶高；成功提示走 sonner（见上方注释）。
  const status = error ? (
    <p className="flex min-w-0 flex-1 items-center gap-2 text-2xs text-destructive">
      <span className="min-w-0 truncate" title={error}>
        {error}
      </span>
      {canRetry && (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-chip underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void send()}
        >
          {t('feed.chatRetry')}
        </button>
      )}
    </p>
  ) : null

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Composer
          compact={compact}
          leading={
            leadingActions || status ? (
              <>
                {leadingActions}
                {status}
              </>
            ) : undefined
          }
          trailing={
            <>
              {actions}
              <Button
                type="submit"
                size="icon"
                variant="primary"
                // 发送途中不用 `disabled`：被聚焦的元素一旦禁用会掉焦点（用户以为「焦点被抢走」）。
                // 改用 aria-busy + 不吃点击，重复提交由 `send()` 里的 `sending` 守卫拦住。
                className={cn(
                  'shrink-0 rounded-full',
                  compact ? 'size-7' : 'size-8',
                  sending && 'pointer-events-none opacity-60',
                )}
                disabled={disabled || text.trim().length === 0}
                aria-busy={sending || undefined}
                aria-label={t('feed.chatSend')}
                title={t('feed.chatSend')}
              >
                {sending ? <Spinner aria-hidden /> : <Send data-icon="inline-start" />}
              </Button>
            </>
          }
        >
          <input
            ref={inputRef}
            value={text}
            maxLength={200}
            disabled={disabled}
            aria-busy={sending || undefined}
            placeholder={disabled ? t('feed.chatPluginMissing') : t('feed.chatPlaceholder')}
            aria-label={t('feed.chatPlaceholder')}
            className={cn(
              'h-8 w-full min-w-0 bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none',
              compact && 'h-7 text-xs',
            )}
            onChange={(e) => setText(e.target.value)}
          />
        </Composer>
      </form>
    </div>
  )
}
