import { useCallback, useEffect, useState } from 'react'
import { Plug, RefreshCw } from 'lucide-react'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import { Badge, Button, Spinner } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { type BackendTransport, type PluginStatus } from '@/lib/tshock'

interface PluginDiagnosticsCardProps {
  transport: BackendTransport
  /** 切换服务器后重新探测。 */
  serverId: string
}

/** 状态 → 徽标色调。 */
function toneFor(status: PluginStatus): 'success' | 'warn' | 'danger' {
  if (!status.installed) return 'danger'
  if (!status.compatible || status.legacy) return 'warn'
  return 'success'
}

/**
 * 「设置 → 信使插件诊断」：把插件版本 / 协议 / 能力 / 兼容性一次摊开，
 * 便于在插件与后端协议有出入时快速定位（见 docs/插件-信使.md 的协议握手）。
 * 不需要登录（后端只用共享 secret 调 /webui/meta）。
 */
export function PluginDiagnosticsCard({ transport, serverId }: PluginDiagnosticsCardProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<PluginStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await transport.pluginStatus())
      setFailed(false)
    } catch {
      setStatus(null)
      setFailed(true)
    } finally {
      setChecking(false)
    }
  }, [transport])

  useEffect(() => {
    void load()
  }, [load, serverId])

  // 容错：装好插件后回到页面自动重新检测（与账号区块一致）。
  useEffect(() => {
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const missing = status?.missingCapabilities ?? []
  const reasonKey = status ? `plugins.reason.${status.reason}` : 'plugins.reason.not_installed'

  return (
    <CollapsibleCard
      title={t('plugins.title')}
      icon={<Plug />}
      defaultOpen={false}
      bodyClassName="flex flex-col gap-2 pt-0"
      headerExtra={
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('modules.recheck')}
          title={t('modules.recheck')}
          onClick={() => void load()}
          disabled={checking}
        >
          {checking ? <Spinner aria-hidden data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
        </Button>
      }
    >
      {checking && !status ? (
        <p className="text-2xs text-muted-foreground">{t('plugins.checking')}</p>
      ) : !status ? (
        <p className="text-2xs text-muted-foreground">
          {failed ? t('plugins.checkFailed') : t('plugins.checking')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={toneFor(status)}>
              {status.installed ? t('plugins.installed') : t('plugins.notInstalled')}
            </Badge>
            {status.version && <Badge tone="neutral">{t('plugins.version', { version: status.version })}</Badge>}
            {status.installed && (
              <Badge tone="neutral">
                {t('plugins.protocol', { plugin: status.protocol, backend: status.backendProtocol })}
              </Badge>
            )}
            {status.legacy && <Badge tone="warn">{t('plugins.legacy')}</Badge>}
          </div>
          <p className={status.compatible && !status.legacy ? 'text-2xs text-muted-foreground' : 'text-2xs text-warning'}>
            {t(reasonKey)}
          </p>
          {missing.length > 0 && (
            <p className="text-2xs text-warning">{t('plugins.missing', { list: missing.join(', ') })}</p>
          )}
          {status.capabilities.length > 0 && (
            <p className="font-pixel text-2xs break-all text-muted-foreground">
              {t('plugins.capabilities', { list: status.capabilities.join(', ') })}
            </p>
          )}
        </>
      )}
    </CollapsibleCard>
  )
}
