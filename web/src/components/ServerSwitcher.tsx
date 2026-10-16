import { useEffect, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Separator,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import {
  BUILTIN_ID,
  DEFAULT_TSHOCK_PORT,
  parseTargetInput,
  targetLabel,
  type ServerTarget,
  type TargetScheme,
} from '@/lib/servers'
import type { ServerInfo } from '@/lib/tshock'

export interface ServerSwitcherDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  servers: ServerTarget[]
  activeId: string
  info: ServerInfo
  onSelect: (id: string) => void
  onAdd: (target: ServerTarget) => void
  onRemove: (id: string) => void
}

/**
 * 切换 / 新增 / 删除 TShock 上游的**受控弹框**（host 与 port 分开）。
 * 触发器在侧栏底部账号卡片里（「切换服务器」菜单项）。
 * 弹框采用模态对话框；点击框外不关闭，需用右上角关闭或 Esc。
 * 列表里显示**完整**地址，便于管理。
 */
export function ServerSwitcherDialog({
  open,
  onOpenChange,
  servers,
  activeId,
  info,
  onSelect,
  onAdd,
  onRemove,
}: ServerSwitcherDialogProps) {
  const { t } = useI18n()
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_TSHOCK_PORT))
  const [scheme, setScheme] = useState<TargetScheme>('http')
  const [error, setError] = useState<string | null>(null)

  // 关闭时清空新增表单，下次打开是干净状态。
  useEffect(() => {
    if (open) return
    setHost('')
    setPort(String(DEFAULT_TSHOCK_PORT))
    setScheme('http')
    setError(null)
  }, [open])

  const submit = () => {
    const parsed = parseTargetInput(host, port, scheme)
    if ('error' in parsed) {
      setError(t('servers.invalid'))
      return
    }
    onAdd(parsed.target)
    setHost('')
    setPort(String(DEFAULT_TSHOCK_PORT))
    setScheme('http')
    setError(null)
  }

  const rowClass = (selected: boolean) =>
    cn(
      'h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left text-xs font-normal',
      selected ? 'bg-primary/15 text-foreground' : 'text-foreground/80',
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        // 点击框外 / 遮罩不关闭：仅允许右上角关闭或 Esc。
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('servers.title')}</DialogTitle>
          <DialogDescription>{t('servers.note')}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-64 flex flex-col gap-1 overflow-y-auto">
          <li className="flex items-center gap-1">
            <Button
              variant="ghost"
              className={rowClass(activeId === BUILTIN_ID)}
              onClick={() => {
                onSelect(BUILTIN_ID)
                onOpenChange(false)
              }}
            >
              <Check
                className={cn('shrink-0', activeId === BUILTIN_ID ? 'opacity-100' : 'opacity-0')}
                data-icon="inline-start"
              />
              <span className="min-w-0 flex-1 truncate">
                {info.default ? `${info.default.host}:${info.default.port}` : '—'}
              </span>
            </Button>
          </li>
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <Button
                variant="ghost"
                className={rowClass(activeId === s.id)}
                onClick={() => {
                  onSelect(s.id)
                  onOpenChange(false)
                }}
              >
                <Check
                  className={cn('shrink-0', activeId === s.id ? 'opacity-100' : 'opacity-0')}
                  data-icon="inline-start"
                />
                <span className="min-w-0 flex-1 truncate font-pixel">{targetLabel(s)}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{s.scheme}</span>
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('servers.remove')}
                title={t('servers.remove')}
                onClick={() => onRemove(s.id)}
              >
                <Trash2 data-icon="inline-start" />
              </Button>
            </li>
          ))}
        </ul>

        {info.allowCustom ? (
          <div className="flex flex-col gap-2 pt-3">
            <Separator />
            <ToggleGroup
              size="sm"
              value={scheme}
              onValueChange={(v) => v && setScheme(v as TargetScheme)}
              aria-label="scheme"
            >
              <ToggleGroupItem value="http">http</ToggleGroupItem>
              <ToggleGroupItem value="https">https</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-start gap-2">
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor="server-host" className="sr-only">
                  {t('servers.host')}
                </FieldLabel>
                <Input
                  id="server-host"
                  value={host}
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
            {error && <p className="text-[10px] text-destructive">{error}</p>}
            <Button size="sm" variant="primary" className="w-full" onClick={submit}>
              <Plus data-icon="inline-start" />
              {t('servers.add')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 pt-3">
            <Separator />
            <p className="text-[10px] text-muted-foreground">{t('servers.customDisabled')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
