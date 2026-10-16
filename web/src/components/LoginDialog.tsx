import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { loadLoginMemory, saveLoginMemory } from '@/lib/credentials'
import { useI18n } from '@/lib/i18n'
import type { BackendTransport, TshockErrorKind, WebAuthCapabilities } from '@/lib/tshock'
import { TshockRequestError } from '@/lib/tshock'

/**
 * 服主赋权命令：普通用户组（默认 default）默认没有 `tshock.rest.useapi`，
 * 不赋权时即使密码正确也无法建 token（TShock 返回与「密码错」相同的 403）。
 */
const PERM_COMMAND = '/group addperm default tshock.rest.useapi tshock.rest.command'

interface LoginDialogProps {
  open: boolean
  onClose: () => void
  transport: BackendTransport
  onSuccess: (user: { username: string }) => void
  /** 当前 TShock 上游 id：密码按服务器分别记忆。 */
  serverId: string
  /** 因 token 失效被动弹出的说明文案（可选）。 */
  reason?: string
}

type LoginMode = 'password' | 'token' | 'online'

export function LoginDialog({ open, onClose, transport, onSuccess, serverId, reason }: LoginDialogProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<LoginMode>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState<TshockErrorKind | null>(null)
  const [copied, setCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // 在线授权：插件可用性 + 等待期间用于取消的 AbortController。
  const [caps, setCaps] = useState<WebAuthCapabilities | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 每次打开（或切换服务器）时回填：共用用户名 + 该服务器对应的密码。
  useEffect(() => {
    if (!open) return
    const memory = loadLoginMemory(serverId)
    setUsername(memory.username)
    setPassword(memory.password)
    setRemember(memory.remember)
    setError('')
    setErrorKind(null)
    setShowPassword(false)
  }, [open, serverId])

  // 在线授权：打开登录框时探测服务器是否安装了信使插件。
  useEffect(() => {
    if (!open) {
      // 关闭时中断仍在等待的在线授权请求。
      abortRef.current?.abort()
      return
    }
    let cancelled = false
    void transport.webauthCapabilities().then((c) => {
      if (!cancelled) setCaps(c)
    })
    return () => {
      cancelled = true
    }
  }, [open, transport, serverId])

  const copyPermCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PERM_COMMAND)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }, [])

  if (!open) return null

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    setErrorKind(null)
    try {
      let res: { username: string }
      if (mode === 'token') {
        res = await transport.loginWithToken(token)
      } else if (mode === 'online') {
        const controller = new AbortController()
        abortRef.current = controller
        res = await transport.loginOnline(username, controller.signal)
      } else {
        res = await transport.login(username, password)
        saveLoginMemory(serverId, { username: res.username || username, password, remember })
      }
      onSuccess({ username: res.username })
      setPassword('')
      setToken('')
      onClose()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 玩家主动取消等待：不视为错误。
      } else if (err instanceof TshockRequestError) {
        setError(err.message)
        setErrorKind(err.kind)
      } else {
        setError(t('login.failed'))
        setErrorKind(null)
      }
    } finally {
      abortRef.current = null
      setSubmitting(false)
    }
  }

  const cancelWait = () => {
    abortRef.current?.abort()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{t('login.title')}</DialogTitle>
            {transport.mock && <Badge tone="mock">{t('login.mockBadge')}</Badge>}
          </div>
        </DialogHeader>

        {reason && (
          <Alert variant="warning">
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
        )}

        <Tabs
          value={mode}
          onValueChange={(v) => {
            if (submitting) return
            setMode(v as LoginMode)
            setError('')
          }}
        >
          <TabsList className="mb-3 grid w-full grid-cols-3">
            <TabsTrigger value="password">{t('login.tab.password')}</TabsTrigger>
            <TabsTrigger value="token">{t('login.tab.token')}</TabsTrigger>
            <TabsTrigger value="online">{t('login.tab.online')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <FieldGroup>
          {mode === 'password' ? (
            <>
              <Field>
                <FieldLabel htmlFor="login-username">{t('login.username')}</FieldLabel>
                <Input
                  id="login-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder={t('login.usernamePlaceholder')}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="login-password">{t('login.password')}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder={t('login.passwordPlaceholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submit()
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                      title={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    >
                      {showPassword ? (
                        <EyeOff data-icon="inline-start" />
                      ) : (
                        <Eye data-icon="inline-start" />
                      )}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              <Field orientation="horizontal" className="gap-2">
                <Checkbox
                  id="login-remember"
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                />
                <FieldLabel htmlFor="login-remember" className="font-normal text-foreground/80">
                  {t('login.remember')}
                </FieldLabel>
              </Field>
            </>
          ) : mode === 'token' ? (
            <Field>
              <FieldLabel htmlFor="login-token">{t('login.token')}</FieldLabel>
              <Input
                id="login-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                placeholder={t('login.tokenPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
              />
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="login-online-username">{t('login.username')}</FieldLabel>
              <Input
                id="login-online-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder={t('login.usernamePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
              />
            </Field>
          )}

          {mode === 'online' && caps && !caps.plugin && (
            <p className="text-xs text-destructive">{t('login.pluginMissing')}</p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!transport.mock &&
            mode === 'password' &&
            (errorKind === 'auth' || errorKind === 'permission') && (
              <Alert variant="muted">
                <AlertDescription>
                  <p>{t('login.permissionHint')}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-background px-1.5 py-1 font-pixel text-[10px]">
                      {PERM_COMMAND}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => void copyPermCommand()}>
                      {copied ? (
                        <Check data-icon="inline-start" />
                      ) : (
                        <Copy data-icon="inline-start" />
                      )}
                      {copied ? t('action.copied') : t('action.copy')}
                    </Button>
                  </div>
                  <p className="mt-1">{t('login.permissionHintNote')}</p>
                </AlertDescription>
              </Alert>
            )}

          <p className="text-[11px] leading-4 text-foreground/60">
            {mode === 'token'
              ? t('login.help.token')
              : mode === 'online'
                ? t('login.help.online')
                : transport.mock
                  ? t('login.help.mock')
                  : remember
                    ? t('login.help.remembered')
                    : t('login.help.password')}
          </p>
          {mode === 'password' && !transport.mock && (
            <p className="text-[11px] leading-4 text-foreground/60">{t('login.help.registerHint')}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={submitting && mode === 'online' ? cancelWait : onClose}
              disabled={submitting && mode !== 'online'}
            >
              {submitting && mode === 'online' ? t('login.onlineCancel') : t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={submitting || (mode === 'online' && caps?.plugin === false)}
            >
              {submitting && <Spinner aria-hidden data-icon="inline-start" />}
              {submitting
                ? mode === 'online'
                  ? t('login.onlineWaiting')
                  : t('login.submitting')
                : mode === 'online'
                  ? t('login.onlineSubmit')
                  : t('login.submit')}
            </Button>
          </div>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}
