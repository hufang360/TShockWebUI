import { useCallback, useState } from 'react'
import { toast } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { TshockRequestError, type BackendTransport } from '@/lib/tshock'

/** 插件默认前缀（`plugin/WebUI/Extras.cs` 的 `DefaultChatPrefix`，`ChatPrefix` 留空时用它）。 */
export const DEFAULT_CHAT_PREFIX = '[WebUI]'

export interface ChatSend {
  /** 发送中（按钮转圈 + 挡住重复提交）。 */
  sending: boolean
  /** 上一次失败的文案（空串 = 没有错误）。 */
  error: string
  /**
   * 插件实际使用的前缀（默认 `[WebUI]`，服主可在插件配置 `ChatPrefix` 改）。
   * 前端拿不到配置，所以从**发过的第一条**消息的 `line`（`<前缀> 名字: 内容`）里学出来。
   */
  prefix: string
  /** 发送一段话；成功 resolve(true)，失败 / 空文本 / 发送中 resolve(false)。 */
  send: (text: string) => Promise<boolean>
}

/**
 * 网页发言（`POST /api/chat`，插件加 `[WebUI]` 前缀）的共享逻辑：错误归类 + 成功提示。
 *
 * 「指令」页的聊天模式（`CommandPage` → `CommandEditor`）用这一套文案：
 * 插件缺失 / 版本过旧 / 协议不匹配各有可定位的提示，绝不显示「成功了」而实际没发出去。
 * 调用方负责把文本清空与刷新事件流（见 `onSent`）。
 */
export function useChatSend(opts: {
  /** 没有传输层（未登录 / 页面未提供）时传 null：`send` 直接 resolve(false)，不会发请求。 */
  transport: BackendTransport | null
  /** 发送成功后（刷新事件流，让刚发的话立刻上屏）。 */
  onSent?: () => void
  /**
   * 失败时直接 toast 提示（不分页面自己渲染 `error` 的场景，如物品详情的「广播」按钮）。
   * 指令页的聊天模式不用它：那里把错误写在输入框下方。
   */
  toastOnError?: boolean
}): ChatSend {
  const { transport, onSent, toastOnError = false } = opts
  const { t } = useI18n()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [prefix, setPrefix] = useState(DEFAULT_CHAT_PREFIX)

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const value = text.trim()
      if (!value || sending || !transport) return false
      setSending(true)
      setError('')
      try {
        const res = await transport.sendChat(value)
        // `line` 形如 `[WebUI] hf: 你好` → 前缀就是名字前面那一段。
        const at = res.line.indexOf(`${res.name}:`)
        if (at > 0) setPrefix(res.line.slice(0, at).trim())
        toast.success(t('feed.chatSent', { name: res.name }))
        onSent?.()
        return true
      } catch (err) {
        let message: string
        if (
          err instanceof TshockRequestError &&
          (err.kind === 'plugin_outdated' || err.kind === 'plugin_protocol')
        ) {
          message = t('feed.chatOutdated')
        } else if (err instanceof TshockRequestError && err.kind === 'plugin_missing') {
          message = t('feed.chatPluginMissing')
        } else {
          message = err instanceof Error ? err.message : t('feed.chatFailed')
        }
        setError(message)
        if (toastOnError) toast.error(message)
        return false
      } finally {
        setSending(false)
      }
    },
    [onSent, sending, t, toastOnError, transport],
  )

  return { sending, error, prefix, send }
}
