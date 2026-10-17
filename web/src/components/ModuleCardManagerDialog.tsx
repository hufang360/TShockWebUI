import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
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
  /** 编辑自定义卡片的名称 / 指令（内置卡片不可编辑）。 */
  onUpdate: (id: string, patch: { name?: string; command?: string }) => void
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
  onUpdate,
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
          <SheetTitle>{t('modules.cards.manage')}</SheetTitle>
          <SheetDescription>{t('modules.cards.manageDesc')}</SheetDescription>
        </SheetHeader>

        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-accent/40 p-3"
            >
              {card.custom ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row">
                  <Input
                    value={card.name}
                    onChange={(e) => onUpdate(card.id, { name: e.target.value })}
                    placeholder={t('modules.cards.namePlaceholder')}
                    aria-label={t('modules.cards.name')}
                    className="h-8 text-xs sm:w-32"
                  />
                  <Input
                    value={card.command}
                    onChange={(e) => onUpdate(card.id, { command: e.target.value })}
                    onBlur={(e) => onUpdate(card.id, { command: normalizeCustomCommand(e.target.value) })}
                    placeholder={t('modules.cards.commandPlaceholder')}
                    aria-label={t('modules.cards.command')}
                    className="h-8 flex-1 font-pixel text-xs"
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{card.name || card.command}</p>
                  <code className="font-pixel text-[10px] text-muted-foreground">
                    {card.command}
                  </code>
                </div>
              )}
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

        <div className="flex shrink-0 flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-end">
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
      </SheetContent>
    </Sheet>
  )
}
