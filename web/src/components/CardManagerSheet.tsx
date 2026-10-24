import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import {
  Button,
  Checkbox,
  Field,
  FieldGroup,
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
import { cn } from '@/lib/cn'

/** 统一的「管理卡片」条目：首页与模块 / 鱼店共用。 */
export interface ManagerCard {
  id: string
  /** 展示名（内置卡片已翻译；自定义卡片取原始值，可直接编辑）。 */
  name: string
  /** 主指令（自定义卡片取原始值，可直接编辑；内置卡片只读）。 */
  command: string
  /** 用户添加的卡片：名称 / 指令可内联编辑，可删除。 */
  custom: boolean
  /** 置灰（如依赖的插件缺失）。 */
  disabled?: boolean
  /** 隐藏态（首页用），置灰。 */
  hidden?: boolean
  /** 行内额外徽标（首页「内置」「缺少插件」）。 */
  badges?: ReactNode
}

export interface CardManagerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  cards: ManagerCard[]
  /** 删除按钮的无障碍文案。 */
  removeLabel: string
  /** 自定义卡片内联编辑回调。 */
  onUpdate?: (id: string, patch: { name?: string; command?: string }) => void
  onRemove?: (id: string) => void
  /** 自动执行开关（不给则整行不显示）。 */
  autoExec?: {
    isManual: (id: string) => boolean
    onToggle: (id: string, manual: boolean) => void
    label: string
  }
  /** 排序能力：拖拽 + 上移 / 下移按钮（不给则不显示）。 */
  ordering?: {
    onMove: (id: string, delta: number) => void
    dragLabel: string
    moveUpLabel: string
    moveDownLabel: string
  }
  /** 可见性开关（首页用）。 */
  visibility?: {
    isHidden: (id: string) => boolean
    onToggle: (id: string) => void
    hideLabel: string
    showLabel: string
  }
  /** 底部「添加卡片」表单（不给则不显示）。 */
  add?: {
    nameLabel: string
    namePlaceholder: string
    commandLabel: string
    commandPlaceholder: string
    createLabel: string
    onAdd: (name: string, command: string) => void
  }
  /** 卡片名称 / 指令输入框的无障碍文案（自定义卡片内联编辑用）。 */
  nameLabel?: string
  commandLabel?: string
  /** 自定义卡片指令输入框的下拉候选（如本机收藏的指令）。 */
  commandSuggestions?: string[]
  /** 底部左侧额外按钮（如首页「恢复默认」）。 */
  footerExtra?: ReactNode
  /** 底部右侧关闭按钮文案（不给则不显示）。 */
  doneLabel?: string
  /** 底部说明。 */
  note?: string
}

/**
 * 统一的「管理卡片」Sheet（首页 `HomeCardManager` 与模块 / 鱼店 `ModuleCardManagerDialog` 共用）。
 *
 * 约定（见 `docs/审查-UI一致性与体验.md` §4 U1）：
 * - 添加卡片 = 顶部按钮按需展开表单（名称 + 指令 + 添加）；
 * - 自动执行 = `Checkbox`；显示 / 隐藏（若启用）= `Switch`；
 * - 删除走 `ConfirmButton` 二次确认；
 * - 排序（拖拽 + 上移 / 下移）与可见性作为可选能力注入。
 */
export function CardManagerSheet({
  open,
  onOpenChange,
  title,
  description,
  cards,
  removeLabel,
  onUpdate,
  onRemove,
  autoExec,
  ordering,
  visibility,
  add,
  nameLabel,
  commandLabel,
  commandSuggestions,
  footerExtra,
  doneLabel,
  note,
}: CardManagerSheetProps) {
  const { t } = useI18n()
  const nameInputId = useId()
  const commandInputId = useId()
  const suggestionBaseId = useId()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  // 仅当从拖拽手柄按下时才允许整行拖动，避免在输入框里选词时误拖。
  const [handleArmed, setHandleArmed] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setDragId(null)
    setOverId(null)
    setHandleArmed(null)
    setName('')
    setCommand('')
    setShowAddForm(false)
    setEditingId(null)
  }, [open])

  const canAdd = Boolean(add && name.trim() && normalizeCustomCommand(command))

  const submitAdd = () => {
    if (!add || !canAdd) return
    const cmd = normalizeCustomCommand(command)
    add.onAdd(name.trim(), cmd)
    setName('')
    setCommand('')
    setShowAddForm(false)
  }

  /** 拖拽落到目标行：把源卡片移动到目标索引。 */
  const dropAt = (sourceId: string, targetIndex: number) => {
    if (!ordering) return
    const from = cards.findIndex((c) => c.id === sourceId)
    if (from < 0 || from === targetIndex) return
    ordering.onMove(sourceId, targetIndex - from)
  }

  const resetDrag = () => {
    setDragId(null)
    setOverId(null)
    setHandleArmed(null)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </div>
            {add && (
              <Button
                size="sm"
                variant={showAddForm ? 'secondary' : 'primary'}
                className="shrink-0"
                onClick={() => setShowAddForm((v) => !v)}
                aria-expanded={showAddForm}
              >
                <Plus data-icon="inline-start" />
                {t('home.manageAddCard')}
              </Button>
            )}
          </div>
        </SheetHeader>

        {add && showAddForm && (
          <div className="shrink-0 border-b bg-accent/20 px-5 py-3">
            <FieldGroup className="gap-2 sm:flex-row sm:items-end">
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor={nameInputId}>{add.nameLabel}</FieldLabel>
                <Input
                  id={nameInputId}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={add.namePlaceholder}
                  className="h-8 text-xs"
                />
              </Field>
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor={commandInputId}>{add.commandLabel}</FieldLabel>
                <Input
                  id={commandInputId}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAdd()
                  }}
                  placeholder={add.commandPlaceholder}
                  className="h-8 font-pixel text-xs"
                />
              </Field>
              <Button size="sm" variant="primary" onClick={submitAdd} disabled={!canAdd}>
                <Plus data-icon="inline-start" />
                {add.createLabel}
              </Button>
            </FieldGroup>
          </div>
        )}

        <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-4">
          {cards.map((card, index) => {
            const label = card.name || card.command
            const suggestionListId = `${suggestionBaseId}-${index}`
            return (
              <li
                key={card.id}
                draggable={Boolean(ordering) && handleArmed === card.id}
                onDragStart={
                  ordering
                    ? (e) => {
                        setDragId(card.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', card.id)
                      }
                    : undefined
                }
                onDragOver={
                  ordering
                    ? (e) => {
                        if (!dragId) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (overId !== card.id) setOverId(card.id)
                      }
                    : undefined
                }
                onDrop={
                  ordering
                    ? (e) => {
                        e.preventDefault()
                        const source = dragId ?? e.dataTransfer.getData('text/plain')
                        if (source) dropAt(source, index)
                        resetDrag()
                      }
                    : undefined
                }
                onDragEnd={ordering ? resetDrag : undefined}
                className={cn(
                  'flex flex-col gap-2.5 rounded-xl bg-accent/40 p-3 transition-shadow',
                  dragId === card.id && 'opacity-50',
                  dragId && overId === card.id && dragId !== card.id && 'ring-2 ring-ring',
                  (card.hidden || card.disabled) && 'opacity-60',
                )}
                aria-label={label}
              >
                <div className="flex min-w-0 items-start gap-1.5">
                  {ordering ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onMouseDown={() => setHandleArmed(card.id)}
                      onMouseUp={() => setHandleArmed(null)}
                      onMouseLeave={() => setHandleArmed((v) => (v === card.id ? null : v))}
                      aria-label={ordering.dragLabel}
                      title={ordering.dragLabel}
                      className="shrink-0 cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical data-icon="inline-start" />
                    </Button>
                  ) : null}

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {card.custom && editingId === card.id ? (
                      <>
                        <Input
                          value={card.name}
                          onChange={(e) => onUpdate?.(card.id, { name: e.target.value })}
                          placeholder={nameLabel}
                          aria-label={nameLabel}
                          className="h-8 text-xs"
                        />
                        <Input
                          value={card.command}
                          onChange={(e) => onUpdate?.(card.id, { command: e.target.value })}
                          onBlur={(e) =>
                            onUpdate?.(card.id, { command: normalizeCustomCommand(e.target.value) })
                          }
                          list={commandSuggestions?.length ? suggestionListId : undefined}
                          placeholder={commandLabel}
                          aria-label={commandLabel}
                          className="h-8 font-pixel text-xs"
                        />
                        {commandSuggestions?.length ? (
                          <datalist id={suggestionListId}>
                            {commandSuggestions.map((cmd) => (
                              <option key={cmd} value={cmd} />
                            ))}
                          </datalist>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{label}</span>
                          {card.badges}
                        </div>
                        {card.command ? (
                          <code className="truncate font-pixel text-2xs text-muted-foreground">
                            {card.command}
                          </code>
                        ) : (
                          <span className="text-2xs text-muted-foreground">
                            {t('home.manageNoCommand')}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {card.custom && (
                      <Button
                        size="icon-sm"
                        variant={editingId === card.id ? 'secondary' : 'ghost'}
                        aria-label={editingId === card.id ? t('action.done') : t('action.edit')}
                        title={editingId === card.id ? t('action.done') : t('action.edit')}
                        onClick={() => setEditingId((id) => (id === card.id ? null : card.id))}
                      >
                        <Pencil data-icon="inline-start" />
                      </Button>
                    )}
                    {card.custom && (
                      <ConfirmButton
                        size="icon-sm"
                        variant="ghost"
                        aria-label={removeLabel}
                        title={removeLabel}
                        onConfirm={() => onRemove?.(card.id)}
                        confirmLabel={t('action.deleteConfirm')}
                        icon={<Trash2 data-icon="inline-start" />}
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {autoExec && card.command.trim().length > 0 && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`auto-exec-${card.id}`}
                          checked={!autoExec.isManual(card.id)}
                          onCheckedChange={(v) => autoExec.onToggle(card.id, v !== true)}
                          aria-label={`${label} ${autoExec.label}`}
                        />
                        <label
                          htmlFor={`auto-exec-${card.id}`}
                          className="cursor-pointer text-xs text-muted-foreground"
                        >
                          {autoExec.label}
                        </label>
                      </div>
                    )}
                    {visibility && (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!visibility.isHidden(card.id)}
                          onCheckedChange={() => visibility.onToggle(card.id)}
                          aria-label={
                            visibility.isHidden(card.id) ? visibility.showLabel : visibility.hideLabel
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {visibility.isHidden(card.id) ? visibility.showLabel : visibility.hideLabel}
                        </span>
                      </div>
                    )}
                  </div>

                  {ordering && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={index === 0}
                        aria-label={ordering.moveUpLabel}
                        title={ordering.moveUpLabel}
                        onClick={() => ordering.onMove(card.id, -1)}
                      >
                        <ChevronUp data-icon="inline-start" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={index === cards.length - 1}
                        aria-label={ordering.moveDownLabel}
                        title={ordering.moveDownLabel}
                        onClick={() => ordering.onMove(card.id, 1)}
                      >
                        <ChevronDown data-icon="inline-start" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="flex shrink-0 flex-col gap-2 border-t px-5 py-3">
          {(footerExtra || doneLabel) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">{footerExtra}</div>
              {doneLabel && (
                <Button size="sm" variant="primary" onClick={() => onOpenChange(false)}>
                  {doneLabel}
                </Button>
              )}
            </div>
          )}
        </div>

        {note && <p className="shrink-0 px-5 pb-4 text-xs text-muted-foreground">{note}</p>}
      </SheetContent>
    </Sheet>
  )
}
