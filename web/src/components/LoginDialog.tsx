import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronsUpDown,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  Gamepad2,
  KeyRound,
  Server,
  UserRound,
} from 'lucide-react'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Spinner,
} from '@/components/ui'
import { ServerSwitcherDialog } from '@/components/ServerSwitcher'
import { cn } from '@/lib/cn'
import { loadLoginMemory, saveLoginMemory } from '@/lib/credentials'
import { useI18n } from '@/lib/i18n'
import type { ServerTarget } from '@/lib/servers'
import type { BackendTransport, ServerInfo, TshockErrorKind, WebAuthCapabilities } from '@/lib/tshock'
import { TshockRequestError } from '@/lib/tshock'

/**
 * 服主赋权命令：普通用户组（默认 default）默认没有 `tshock.rest.useapi`，
 * 不赋权时即使密码正确也无法建 token（TShock 返回与「密码错」相同的 403）。
 */
const PERM_COMMAND = '/group addperm default tshock.rest.useapi tshock.rest.command'

// 静态资源基路径：登录框右侧插画（web/public/login-art.png，由 tools/gen-brand-assets.py 生成）。
const BASE = import.meta.env.BASE_URL

interface LoginDialogProps {
  open: boolean
  onClose: () => void
  transport: BackendTransport
  onSuccess: (user: { username: string }) => void
  /** 当前 TShock 上游 id：密码按服务器分别记忆，也是服务器切换弹框的当前项。 */
  serverId: string
  /** 当前服务器展示名（已遮挡）。 */
  serverLabel: string
  /** 当前上游是否在线（服务器行上的圆点）。 */
  serverOnline: boolean
  /** 因 token 失效被动弹出的说明文案（可选）。 */
  reason?: string
  // ── 服务器切换（点击「服务器」一行时弹出，交互与侧栏账号菜单一致）──
  servers: ServerTarget[]
  info: ServerInfo
  onSelectServer: (id: string) => void
  onAddServer: (target: ServerTarget) => void
  onEditServer: (oldId: string, target: ServerTarget) => void
  onRemoveServer: (id: string) => void
}

type LoginMode = 'password' | 'token' | 'online'

export function LoginDialog({
  open,
  onClose,
  transport,
  onSuccess,
  serverId,
  serverLabel,
  serverOnline,
  reason,
  servers,
  info,
  onSelectServer,
  onAddServer,
  onEditServer,
  onRemoveServer,
}: LoginDialogProps) {
  const { t } = useI18n()
  // 默认只看「账号密码」；访问令牌 / 在线授权是次要路径，用底部小字切换。
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
  const [serverOpen, setServerOpen] = useState(false)
  // 「登录帮助」浮层：hover 或点击展开。
  const [helpOpen, setHelpOpen] = useState(false)
  const helpCloseTimer = useRef<number | null>(null)
  // 在线授权：插件可用性 + 等待期间用于取消的 AbortController。
  const [caps, setCaps] = useState<WebAuthCapabilities | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // hover 打开、离开后小幅延迟关闭，给鼠标从触发按钮移到浮层留出时间。
  const openHelp = () => {
    if (helpCloseTimer.current) window.clearTimeout(helpCloseTimer.current)
    setHelpOpen(true)
  }
  const scheduleCloseHelp = () => {
    if (helpCloseTimer.current) window.clearTimeout(helpCloseTimer.current)
    helpCloseTimer.current = window.setTimeout(() => setHelpOpen(false), 150)
  }
  useEffect(() => () => {
    if (helpCloseTimer.current) window.clearTimeout(helpCloseTimer.current)
  }, [])

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

  const switchMode = (next: LoginMode) => {
    if (submitting) return
    setMode(next)
    setError('')
    setErrorKind(null)
  }

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

  const helpText =
    mode === 'token'
      ? t('login.help.token')
      : mode === 'online'
        ? t('login.help.online')
        : transport.mock
          ? t('login.help.mock')
          : remember
            ? t('login.help.remembered')
            : t('login.help.password')

  const serverRow = (
    <button
      type="button"
      onClick={() => setServerOpen(true)}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg bg-accent/50 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${t('login.server')}: ${serverLabel}`}
    >
      <Server className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{serverLabel}</span>
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          serverOnline ? 'bg-success' : 'bg-destructive',
        )}
      />
      <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent
          className="max-w-sm gap-0 p-0 sm:max-w-3xl"
          aria-describedby={undefined}
        >
          {/* 大屏两栏：左侧表单（p-5 自负内边距），右侧品牌插画；小屏插画列隐藏，表单占满。 */}
          <div className="grid min-w-0 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4 p-5">
              <DialogHeader className="items-center text-center">
                <div className="flex items-center justify-center gap-2">
                  <DialogTitle className="text-lg font-semibold">{t('login.title')}</DialogTitle>
                  {transport.mock && <Badge tone="mock">{t('login.mockBadge')}</Badge>}
                </div>
              </DialogHeader>

              {reason && (
                <Alert variant="warning">
                  {/* 文案里可能有 \n（如会话过期），用 pre-line 保留换行而不拆成多行节点。 */}
                  <AlertDescription className="whitespace-pre-line">{reason}</AlertDescription>
                </Alert>
              )}

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
                        autoFocus
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
                      autoFocus
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
                      autoFocus
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
                    {errorKind === 'rate_limited' ? (
                      // 精确限流提示：线上授权是插件自身的防刷（与 TShock 建令牌桶无关），分开说明。
                      <AlertDescription>
                        {mode === 'online' ? t('login.rateLimitedOnline') : t('login.rateLimited')}
                      </AlertDescription>
                    ) : mode === 'password' && errorKind === 'auth' ? (
                      // TShock 对「密码错 / 组缺 useapi / 建令牌限流」返回的是同一条 403
                      // （SecureRest.cs:117-176 已核实），无法自动区分；拆成逐条可核对的清单并说明原因，
                      // 比原来一句含糊的长句更精确。文案走 i18n，不直接透出后端的中文 message。
                      <AlertDescription className="min-w-0 justify-items-stretch">
                        <p className="font-medium text-foreground">{t('login.failedTitle')}</p>
                        <p>{t('login.failedWhy')}</p>
                        <ol className="ml-4 list-decimal leading-relaxed">
                          <li>{t('login.cause.credentials')}</li>
                          <li>{t('login.cause.permission')}</li>
                          {/* 装了 WebUI 插件时，后端已先查过 TShock 限流桶：走到这里说明不是限流，不再列。 */}
                          {!caps?.plugin && <li>{t('login.cause.rateLimit')}</li>}
                        </ol>
                      </AlertDescription>
                    ) : (
                      <AlertDescription>{error}</AlertDescription>
                    )}
                  </Alert>
                )}

                {!transport.mock &&
                  mode === 'password' &&
                  (errorKind === 'auth' || errorKind === 'permission') && (
                    <Alert variant="muted">
                      {/* `justify-items-stretch` + `w-full min-w-0`：否则 AlertDescription 默认 `justify-items-start`，
                          长的赋权命令行会按 max-content 抳出左栏、盖到右侧插画上。 */}
                      <AlertDescription className="min-w-0 justify-items-stretch">
                        <p>{t('login.permissionHint')}</p>
                        <div className="mt-1 flex w-full min-w-0 items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded bg-background px-1.5 py-1 font-pixel text-2xs">
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

              </FieldGroup>

              {/* 主按钮：通栏（参考图里的宽登录按钮）。 */}
              <Button
                variant="primary"
                size="lg"
                className="w-full"
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

              {/* 在线授权等待中：给一个取消入口（其余情况直接点右上角 X 即可，不再单列「取消」）。 */}
              {submitting && mode === 'online' && (
                <button
                  type="button"
                  className="mx-auto cursor-pointer rounded-sm text-xs font-medium text-foreground/75 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={cancelWait}
                >
                  {t('login.onlineCancel')}
                </button>
              )}

              {/* 次要登录方式：分隔线 + 两个 Alt Line 按钮（访问令牌 / 在线授权）。 */}
              {mode === 'password' ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground">{t('login.orContinue')}</span>
                    <Separator className="flex-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => switchMode('token')}>
                      <KeyRound data-icon="inline-start" />
                      {t('login.tab.token')}
                    </Button>
                    <Button variant="outline" onClick={() => switchMode('online')}>
                      <Gamepad2 data-icon="inline-start" />
                      {t('login.tab.online')}
                    </Button>
                  </div>
                </div>
              ) : (
                // 与密码模式下的「其他登录方式」保持同一小区域样式（分隔行 + 通栏 outline 按钮）。
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground">{t('login.orContinue')}</span>
                    <Separator className="flex-1" />
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => switchMode('password')}>
                    <UserRound data-icon="inline-start" />
                    {t('login.backToPassword')}
                  </Button>
                </div>
              )}

              {/* 当前服务器：点击打开「切换服务器」弹框（放在次要登录方式下面一行）。 */}
              {serverRow}

              {/* 登录帮助：`mt-auto` 推到左栏左下角（不再用带底色的 DialogFooter）。 */}
              <div className="mt-auto flex justify-start">
                <Popover open={helpOpen} onOpenChange={setHelpOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onPointerEnter={openHelp}
                      onPointerLeave={scheduleCloseHelp}
                      className="flex cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <CircleHelp className="size-3.5" />
                      {t('login.help')}
                    </button>
                  </PopoverTrigger>
                  {/* hover 打开时不抢焦点；关闭时也不把焦点弹回触发按钮（否则会来回闪）。 */}
                  <PopoverContent
                    side="top"
                    align="start"
                    className="w-72"
                    onPointerEnter={openHelp}
                    onPointerLeave={scheduleCloseHelp}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    onFocusOutside={() => setHelpOpen(false)}
                    onInteractOutside={() => setHelpOpen(false)}
                  >
                    <p className="text-xs leading-5 whitespace-pre-line text-foreground/70">
                      {helpText}
                    </p>
                    {mode === 'password' && !transport.mock && (
                      <p className="pt-1.5 text-xs leading-5 whitespace-pre-line text-foreground/70">
                        {t('login.help.registerHint')}
                      </p>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* 插画列：仅大屏显示。纯装饰（aria-hidden），不承载信息。 */}
            <div
              aria-hidden
              className="relative hidden border-l border-border/60 bg-accent/40 sm:flex sm:min-h-[24rem] sm:flex-col sm:items-center sm:justify-center sm:gap-3 sm:p-6"
            >
              <img src={`${BASE}login-art.png`} alt="" draggable={false} className="w-40" />
              <div className="text-center">
                <p className="text-lg font-semibold text-foreground/80">{t('app.title')}</p>
                <p className="text-sm text-muted-foreground">{t('login.artCaption')}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ServerSwitcherDialog
        open={serverOpen}
        onOpenChange={setServerOpen}
        servers={servers}
        activeId={serverId}
        info={info}
        transport={transport}
        onSelect={onSelectServer}
        onAdd={onAddServer}
        onEdit={onEditServer}
        onRemove={onRemoveServer}
      />
    </>
  )
}
