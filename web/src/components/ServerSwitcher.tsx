import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, Pencil, Plus, Trash2, Wifi, WifiOff } from 'lucide-react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Separator,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import { ConfirmButton } from '@/components/ConfirmButton'
import {
  BUILTIN_ID,
  DEFAULT_TSHOCK_PORT,
  formatTargetUrl,
  parseTargetInput,
  targetHeader,
  targetUrl,
  type ServerTarget,
  type TargetScheme,
} from '@/lib/servers'
import type { BackendTransport, ServerInfo } from '@/lib/tshock'

export interface ServerSwitcherDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  servers: ServerTarget[]
  activeId: string
  info: ServerInfo
  /** 用于逐行探测「后端服务器」连通情况。 */
  transport: BackendTransport
  onSelect: (id: string) => void
  onAdd: (target: ServerTarget) => void
  /** 修改已保存的上游（`oldId` 是原 id，新 id 可能因 host/port/scheme 变化而变）。 */
  onEdit: (oldId: string, target: ServerTarget) => void
  onRemove: (id: string) => void
}

/** 单行连通性探测状态。 */
type ProbeState = 'checking' | 'online' | 'offline'

/**
 * 管理 / 切换 TShock 上游的**受控弹框**（host 与 port 分开）。
 * 触发器在侧栏底部账号卡片与登录框的「当前服务器」行里。
 * - 列表每行显示完整 URL（`scheme://host:port`）+ 连通性圆点；内置项不可编辑/删除。
 * - 默认不展开新增表单，点列表下方的 outline「添加服务器」才出现；新增不会立即切换。
 * - 点铅笔可修改已保存的地址（表单预填，保存即替换）。
 * 弹框采用模态对话框；点击框外不关闭，需用右上角关闭或 Esc。
 */
export function ServerSwitcherDialog({
  open,
  onOpenChange,
  servers,
  activeId,
  info,
  transport,
  onSelect,
  onAdd,
  onEdit,
  onRemove,
}: ServerSwitcherDialogProps) {
  const { t } = useI18n()
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_TSHOCK_PORT))
  const [scheme, setScheme] = useState<TargetScheme>('http')
  const [error, setError] = useState<string | null>(null)
  // 新增 / 编辑共用同一个表单：默认收起，editingId 非空表示在改已有项。
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, ProbeState>>({})

  const resetForm = useCallback(() => {
    setHost('')
    setPort(String(DEFAULT_TSHOCK_PORT))
    setScheme('http')
    setError(null)
    setFormOpen(false)
    setEditingId(null)
  }, [])

  // 关闭时清空新增 / 编辑表单，下次打开是干净状态。
  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm()
    onOpenChange(next)
  }

  // 探测单个上游的连通性（内置项传空串 → 不带 X-TSWUI-Target）。
  const probe = useCallback(
    async (id: string, header: string) => {
      setStatus((prev) => ({ ...prev, [id]: 'checking' }))
      const res = await transport.serverStatus(header)
      setStatus((prev) => ({ ...prev, [id]: res.reachable ? 'online' : 'offline' }))
    },
    [transport],
  )

  // 打开 / 列表变化时自动全量探测一次。
  const probeAll = useCallback(() => {
    const entries: Array<{ id: string; header: string }> = [
      { id: BUILTIN_ID, header: '' },
      ...servers.map((s) => ({ id: s.id, header: targetHeader(s) ?? '' })),
    ]
    void Promise.all(entries.map((e) => probe(e.id, e.header)))
  }, [servers, probe])

  useEffect(() => {
    if (open) probeAll()
  }, [open, probeAll])

  const startAdd = () => {
    setEditingId(null)
    setHost('')
    setPort(String(DEFAULT_TSHOCK_PORT))
    setScheme('http')
    setError(null)
    setFormOpen(true)
  }

  const startEdit = (s: ServerTarget) => {
    setEditingId(s.id)
    setHost(s.host)
    setPort(String(s.port))
    setScheme(s.scheme)
    setError(null)
    setFormOpen(true)
  }

  const submit = () => {
    const parsed = parseTargetInput(host, port, scheme)
    if ('error' in parsed) {
      setError(t('servers.invalid'))
      return
    }
    if (editingId) onEdit(editingId, parsed.target)
    else onAdd(parsed.target)
    resetForm()
  }

  // 整行（地址 + 操作按钮）共用背景/hover，视觉上是一块整体。
  const rowClass = (selected: boolean) =>
    cn(
      'flex items-center rounded-lg transition-colors',
      selected ? 'bg-primary/15' : 'hover:bg-accent',
    )

  // 每行一个「连通性检测」图标按钮（放在垃圾桶左边；内置项无垃圾桶，就它一个）。
  const probeButton = (id: string, header: string) => {
    const s = status[id]
    const label =
      s === 'online'
        ? t('servers.online')
        : s === 'offline'
          ? t('servers.offline')
          : t('servers.checking')
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0"
        aria-label={`${t('servers.probe')}: ${label}`}
        title={`${t('servers.probe')}: ${label}`}
        onClick={() => void probe(id, header)}
      >
        {s === 'online' ? (
          <Wifi className="text-success" data-icon="inline-start" />
        ) : s === 'offline' ? (
          <WifiOff className="text-destructive" data-icon="inline-start" />
        ) : (
          <LoaderCircle className="animate-spin" data-icon="inline-start" />
        )}
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg overflow-x-hidden"
        // 点击框外 / 遮罩不关闭：仅允许右上角关闭或 Esc。
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('servers.title')}</DialogTitle>
          <DialogDescription>{t('servers.note')}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-64 flex flex-col gap-1 overflow-x-hidden overflow-y-auto">
          <li className={rowClass(activeId === BUILTIN_ID)}>
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-l-lg px-3 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => {
                onSelect(BUILTIN_ID)
                handleOpenChange(false)
              }}
            >
              <Check
                className={cn('shrink-0', activeId === BUILTIN_ID ? 'opacity-100' : 'opacity-0')}
                data-icon="inline-start"
              />
              <span className="min-w-0 flex-1 truncate font-pixel">
                {info.default
                  ? formatTargetUrl(info.default.scheme, info.default.host, info.default.port)
                  : '—'}
              </span>
            </button>
            {probeButton(BUILTIN_ID, '')}
          </li>
          {servers.map((s) => (
            <li key={s.id} className={rowClass(activeId === s.id)}>
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-l-lg px-3 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={() => {
                  onSelect(s.id)
                  handleOpenChange(false)
                }}
              >
                <Check
                  className={cn('shrink-0', activeId === s.id ? 'opacity-100' : 'opacity-0')}
                  data-icon="inline-start"
                />
                <span className="min-w-0 flex-1 truncate font-pixel">{targetUrl(s)}</span>
              </button>
              {probeButton(s.id, targetHeader(s) ?? '')}
              {info.allowCustom && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0"
                  aria-label={t('servers.edit')}
                  title={t('servers.edit')}
                  onClick={() => startEdit(s)}
                >
                  <Pencil data-icon="inline-start" />
                </Button>
              )}
              <ConfirmButton
                size="icon-sm"
                variant="ghost"
                className="mr-1 shrink-0"
                aria-label={t('servers.remove')}
                title={t('servers.remove')}
                onConfirm={() => onRemove(s.id)}
                confirmLabel={t('action.deleteConfirm')}
                icon={<Trash2 data-icon="inline-start" />}
              />
            </li>
          ))}
        </ul>

        {!formOpen ? (
          info.allowCustom ? (
            <Button variant="outline" className="w-full" onClick={startAdd}>
              <Plus data-icon="inline-start" />
              {t('servers.addServer')}
            </Button>
          ) : (
            <p className="text-2xs text-muted-foreground">{t('servers.customDisabled')}</p>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <Separator />
            {/* 地址一行：协议（只读展示，随下方 HTTPS 勾选切换） + 主机 + 端口。 */}
            <div className="flex items-center gap-2">
              <Input
                value={scheme}
                readOnly
                disabled
                tabIndex={-1}
                aria-label={t('servers.scheme')}
                className="w-[4.5rem] shrink-0 text-center font-pixel text-xs"
              />
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor="server-host" className="sr-only">
                  {t('servers.host')}
                </FieldLabel>
                <Input
                  id="server-host"
                  value={host}
                  autoFocus
                  onChange={(e) => setHost(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                  placeholder={t('servers.hostPlaceholder')}
                />
              </Field>
              <Field className="w-20 shrink-0">
                <FieldLabel htmlFor="server-port" className="sr-only">
                  {t('servers.port')}
                </FieldLabel>
                <Input
                  id="server-port"
                  value={port}
                  inputMode="numeric"
                  onChange={(e) => setPort(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                  placeholder={String(DEFAULT_TSHOCK_PORT)}
                />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="server-https"
                checked={scheme === 'https'}
                onCheckedChange={(v) => setScheme(v === true ? 'https' : 'http')}
              />
              <FieldLabel
                htmlFor="server-https"
                className="cursor-pointer text-xs font-normal text-foreground/80"
              >
                {t('servers.https')}
              </FieldLabel>
            </div>
            {error && <p className="text-2xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={resetForm}>
                {t('action.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={submit}>
                {editingId ? t('servers.save') : t('servers.add')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
