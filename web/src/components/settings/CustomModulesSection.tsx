import { useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, Field, FieldLabel, Input, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { CustomModule } from '@/lib/customModules'
import { normalizeCustomCommand } from '@/lib/homeCards'
import { useI18n } from '@/lib/i18n'
import { isModuleEnabled, type ModuleId, type ModulesPrefs } from '@/lib/modules'

interface CustomModulesSectionProps {
  customModules: CustomModule[]
  modules: ModulesPrefs
  serverId: string
  authenticated: boolean
  onToggle: (id: ModuleId, on: boolean) => void
  onUpdate: (id: string, patch: { name?: string; command?: string; desc?: string }) => void
  onRemove: (id: string) => void
  /** 按 delta 移动自定义模块（-1 上移 / +1 下移）。 */
  onMove: (id: string, delta: number) => void
  /** 新建表单（状态由 `SettingsPage` 持有）。 */
  newName: string
  newCommand: string
  onNewNameChange: (v: string) => void
  onNewCommandChange: (v: string) => void
  onCreate: () => void
}

/**
 * 「激活模块 → 自定义」分组内容（从 `SettingsPage` 抽出，见 docs/TODO.md U6）：
 * 已添加模块可改名 / 改主指令 / 改顶部说明 / 启用 / 删除；底部新建表单。
 */
export function CustomModulesSection({
  customModules,
  modules,
  serverId,
  authenticated,
  onToggle,
  onUpdate,
  onRemove,
  onMove,
  newName,
  newCommand,
  onNewNameChange,
  onNewCommandChange,
  onCreate,
}: CustomModulesSectionProps) {
  const { t } = useI18n()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [handleArmed, setHandleArmed] = useState<string | null>(null)

  const resetDrag = () => {
    setDragId(null)
    setOverId(null)
    setHandleArmed(null)
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">{t('modules.custom.hint')}</p>
      <div className="flex flex-col gap-2">
        {customModules.length > 0 && (
          <ul className="flex flex-col gap-2">
            {customModules.map((mod, index) => (
              <li
                key={mod.id}
                draggable={handleArmed === mod.id}
                onDragStart={(e) => {
                  setDragId(mod.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', mod.id)
                }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overId !== mod.id) setOverId(mod.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const source = dragId ?? e.dataTransfer.getData('text/plain')
                  const from = customModules.findIndex((m) => m.id === source)
                  if (from >= 0 && from !== index) onMove(source, index - from)
                  resetDrag()
                }}
                onDragEnd={resetDrag}
                className={cn(
                  'flex flex-col gap-2 rounded-xl bg-accent/40 p-3 transition-shadow',
                  dragId === mod.id && 'opacity-50',
                  dragId && overId === mod.id && dragId !== mod.id && 'ring-2 ring-ring',
                )}
                aria-label={mod.name || t('modules.custom.untitled')}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onMouseDown={() => setHandleArmed(mod.id)}
                      onMouseUp={() => setHandleArmed(null)}
                      onMouseLeave={() => setHandleArmed((v) => (v === mod.id ? null : v))}
                      aria-label={t('modules.custom.drag')}
                      title={t('modules.custom.drag')}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => onMove(mod.id, -1)}
                      aria-label={t('modules.custom.moveUp')}
                      title={t('modules.custom.moveUp')}
                    >
                      <ChevronUp aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={index === customModules.length - 1}
                      onClick={() => onMove(mod.id, 1)}
                      aria-label={t('modules.custom.moveDown')}
                      title={t('modules.custom.moveDown')}
                    >
                      <ChevronDown aria-hidden />
                    </Button>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={isModuleEnabled(modules, serverId, mod.id)}
                      disabled={!authenticated}
                      onCheckedChange={(v) => onToggle(mod.id, v)}
                      aria-label={mod.name || t('modules.custom.untitled')}
                    />
                    <ConfirmButton
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('modules.custom.remove')}
                      title={t('modules.custom.remove')}
                      onConfirm={() => onRemove(mod.id)}
                      confirmLabel={t('action.deleteConfirm')}
                      icon={<Trash2 aria-hidden />}
                    />
                  </div>
                </div>
                {/* 名称可直接改：创建后仍能重命名。 */}
                <Input
                  value={mod.name}
                  onChange={(e) => onUpdate(mod.id, { name: e.target.value })}
                  placeholder={t('modules.custom.namePlaceholder')}
                  aria-label={t('modules.custom.name')}
                  className="h-8 min-w-0 text-xs"
                />
                {/* 主指令可直接改：改时会同步更新自动生成的「帮助」卡片。 */}
                <Input
                  value={mod.command}
                  onChange={(e) => onUpdate(mod.id, { command: e.target.value })}
                  placeholder={t('modules.custom.commandPlaceholder')}
                  aria-label={t('modules.custom.command')}
                  className="h-8 font-pixel text-xs"
                />
                {/* 模块页顶部说明：可留空（留空时回退为默认提示）。 */}
                <Input
                  value={mod.desc}
                  onChange={(e) => onUpdate(mod.id, { desc: e.target.value })}
                  placeholder={t('modules.custom.descPlaceholder')}
                  aria-label={t('modules.custom.desc')}
                  className="h-8 text-xs"
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 rounded-xl bg-accent/40 p-3 sm:flex-row sm:items-end">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="custom-module-name">{t('modules.custom.name')}</FieldLabel>
            <Input
              id="custom-module-name"
              value={newName}
              onChange={(e) => onNewNameChange(e.target.value)}
              placeholder={t('modules.custom.namePlaceholder')}
              className="h-8 text-xs"
            />
          </Field>
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="custom-module-command">{t('modules.custom.command')}</FieldLabel>
            <Input
              id="custom-module-command"
              value={newCommand}
              onChange={(e) => onNewCommandChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreate()
              }}
              placeholder={t('modules.custom.commandPlaceholder')}
              className="h-8 font-pixel text-xs"
            />
          </Field>
          <Button
            size="sm"
            variant="primary"
            onClick={onCreate}
            disabled={!newName.trim() || !normalizeCustomCommand(newCommand)}
          >
            <Plus data-icon="inline-start" />
            {t('modules.custom.create')}
          </Button>
        </div>
      </div>
    </>
  )
}
