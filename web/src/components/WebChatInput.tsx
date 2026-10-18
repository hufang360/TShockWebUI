import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Spinner,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { TshockRequestError, type BackendTransport } from '@/lib/tshock'

interface WebChatInputProps {
  transport: BackendTransport
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
  className?: string
}

/**
 * 网页发言输入框（指令页「动态」tab 底部）。
 *
 * - 发送到游戏内聊天（插件加前缀，默认 `[WebUI]`，与真实玩家区分）；
 * - 发送按钮在输入框内部右侧，圆形气泡图标；
 * - 失败保留输入，可就地「重试」，不造假成功；
 * - 插件缺失 / 版本过旧 / 未登录时禁用或给出可定位的提示。
 */
export function WebChatInput({
  transport,
  disabled = false,
  pluginInstalled,
  onSent,
  compact = false,
  className,
}: WebChatInputProps) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const send = async () => {
    const value = text.trim()
    if (!value || sending || disabled) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const res = await transport.sendChat(value)
      setText('')
      setNotice(t('feed.chatSent', { name: res.name }))
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

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <InputGroup className={cn('rounded-full', compact && 'h-8')}>
          <InputGroupInput
            value={text}
            maxLength={200}
            disabled={sending || disabled}
            placeholder={disabled ? t('feed.chatPluginMissing') : t('feed.chatPlaceholder')}
            aria-label={t('feed.chatPlaceholder')}
            className={compact ? 'text-xs' : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <Button
              type="submit"
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              disabled={sending || disabled || text.trim().length === 0}
              aria-label={t('feed.chatSend')}
              title={t('feed.chatSend')}
            >
              {sending ? <Spinner aria-hidden /> : <MessageCircle />}
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </form>
      {error ? (
        <p className={cn('flex flex-wrap items-center gap-2 text-destructive', compact ? 'text-[10px]' : 'text-[11px]')}>
          {error}
          {canRetry && (
            <button type="button" className="cursor-pointer underline underline-offset-2" onClick={() => void send()}>
              {t('feed.chatRetry')}
            </button>
          )}
        </p>
      ) : notice ? (
        <p className={compact ? 'text-[10px] text-muted-foreground' : 'text-[11px] text-muted-foreground'}>{notice}</p>
      ) : null}
    </div>
  )
}
