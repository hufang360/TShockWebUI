import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
  Switch,
} from '@/components/ui'
import { normalizeCustomCommand } from '@/lib/homeCards'
import { useI18n } from '@/lib/i18n'

export interface ManageableCard {
  id: string
  name: string
  command: string
  /** 用户添加的卡片（可删除）。 */
  custom: boolean
  /** 自动执行偏好的 key（tswui:autoExec）。 */
  manualKey: string
  /** 未设置偏好时的默认值（true = 默认手动）。 */
  defaultManual?: boolean
}

interface ModuleCardManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cards: ManageableCard[]
  isManual: (card: ManageableCard) => boolean
  onToggleManual: (card: ManageableCard, manual: boolean) => void
  onAdd: (name: string, command: string) => void
  onRemove: (id: string) => void
}

/**
 * 模块「管理卡片」弹框：与首页 `HomeCardManager` 同款交互/样式。
 * 列出固定 + 自定义卡片，每张可切「自动执行」，自定义卡片可删；底部添加新卡片。
 */
export function ModuleCardManagerDialog({
  open,
  onOpenChange,
  cards,
  isManual,
  onToggleManual,
  onAdd,
  onRemove,
}: ModuleCardManagerDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')

  const submit = () => {
    const cmd = normalizeCustomCommand(command)
    if (!cmd) return
    onAdd(name.trim(), cmd)
    setName('')
    setCommand('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('modules.cards.manage')}</DialogTitle>
          <DialogDescription>{t('modules.cards.manageDesc')}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-[55vh] flex flex-col gap-2 overflow-y-auto pr-1">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-accent/40 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {card.name || card.command}
                </p>
                <code className="font-pixel text-[10px] text-muted-foreground">{card.command}</code>
              </div>
              <Field orientation="horizontal" className="w-auto flex-nowrap gap-1.5">
                <Switch
                  checked={!isManual(card)}
                  onCheckedChange={(v) => onToggleManual(card, !v)}
                  aria-label={`${card.name || card.command} ${t('home.autoExec')}`}
                />
                <FieldLabel className="text-[10px] font-normal text-muted-foreground">
                  {t('home.autoExec')}
                </FieldLabel>
              </Field>
              {card.custom && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('modules.cards.remove')}
                  title={t('modules.cards.remove')}
                  onClick={() => onRemove(card.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 rounded-xl bg-accent/40 p-3 sm:flex-row sm:items-end">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="mc-name">{t('modules.cards.name')}</FieldLabel>
            <Input
              id="mc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('modules.cards.namePlaceholder')}
              className="h-8 text-xs"
            />
          </Field>
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="mc-command">{t('modules.cards.command')}</FieldLabel>
            <Input
              id="mc-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder={t('modules.cards.commandPlaceholder')}
              className="h-8 font-pixel text-xs"
            />
          </Field>
          <Button size="sm" variant="primary" onClick={submit}>
            <Plus data-icon="inline-start" />
            {t('modules.cards.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
