import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge, Button, Spinner } from '@/components/ui'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import { useI18n } from '@/lib/i18n'
import { TshockRequestError, type BackendTransport, type MeInfo, type SessionInfo } from '@/lib/tshock'

interface WebAccountSectionProps {
  transport: BackendTransport
  authenticated: boolean
  /** 切换服务器后需要重新拉取。 */
  serverId: string
}

/**
 * 设置里的「在线授权 / 账户」区块：
 * 展示当前用户的组与 REST 权限，并列出本插件的 web 会话，可自助吊销。
 * 服务器未安装信使插件时整体优雅降级（提示未安装）。
 */
export function WebAccountSection({ transport, authenticated, serverId }: WebAccountSectionProps) {
  const { t } = useI18n()
  const [me, setMe] = useState<MeInfo | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!authenticated) {
      setMe(null)
      setSessions([])
      setMissing(false)
      return
    }
    try {
      const [m, s] = await Promise.all([transport.me(), transport.sessions()])
      setMe(m)
      setSessions(s)
      setMissing(false)
    } catch (err) {
      if (err instanceof TshockRequestError && err.kind === 'plugin_missing') {
        setMissing(true)
        setMe(null)
        setSessions([])
      }
    }
  }, [authenticated, transport])

  useEffect(() => {
    void load()
  }, [load, serverId])

  const revoke = async (id?: string, all?: boolean) => {
    setBusy(true)
    setNotice('')
    try {
      const n = await transport.revokeSessions(id, all)
      setNotice(t('account.revoked', { n }))
      await load()
    } catch {
      /* 失败静默；列表保持不变 */
    } finally {
      setBusy(false)
    }
  }

  if (!authenticated) return null

  if (missing) {
    return (
      <CollapsibleCard title={t('account.title')} bodyClassName="pt-0">
        <p className="text-[11px] text-muted-foreground">{t('account.unavailable')}</p>
      </CollapsibleCard>
    )
  }

  const others = sessions.filter((s) => !s.current).length

  return (
    <CollapsibleCard
      title={t('account.title')}
      bodyClassName="flex flex-col gap-3 pt-0"
      headerExtra={
        <Button size="sm" variant="ghost" aria-label={t('home.refresh')} onClick={() => void load()} disabled={busy}>
          {busy ? <Spinner aria-hidden data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
        </Button>
      }
    >
        {me && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="neutral">{t('account.group')}: {me.group}</Badge>
            <Badge tone={me.canUseApi ? 'success' : 'danger'}>
              {t('account.canUseApi')}
            </Badge>
            <Badge tone={me.canRunCommands ? 'success' : 'warn'}>
              {t('account.canRunCommands')}
            </Badge>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('account.sessions')}</span>
            {others > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void revoke(undefined, true)} disabled={busy}>
                {t('account.revokeAll')}
              </Button>
            )}
          </div>
          {sessions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('account.sessionsEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-accent/40 px-2 py-1 text-[11px]"
                >
                  {s.current ? (
                    <Badge tone="success">{t('account.current')}</Badge>
                  ) : (
                    <code className="font-pixel text-foreground/70">{s.id}</code>
                  )}
                  {!s.current && (
                    <Button size="sm" variant="ghost" onClick={() => void revoke(s.id)} disabled={busy}>
                      {t('account.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {notice && <p className="text-[11px] text-muted-foreground">{notice}</p>}
    </CollapsibleCard>
  )
}
