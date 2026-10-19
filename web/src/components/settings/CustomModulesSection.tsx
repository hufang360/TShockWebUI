import { Plus, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, Field, FieldLabel, Input, Switch } from '@/components/ui'
import type { CustomModule } from '@/lib/customModules'
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
  newName,
  newCommand,
  onNewNameChange,
  onNewCommandChange,
  onCreate,
}: CustomModulesSectionProps) {
  const { t } = useI18n()
  return (
    <>
      <p className="text-2xs text-muted-foreground">{t('modules.custom.hint')}</p>
      <div className="flex flex-col gap-2">
        {customModules.length > 0 && (
          <ul className="flex flex-col gap-2">
            {customModules.map((mod) => (
              <li key={mod.id} className="flex flex-col gap-2 rounded-xl bg-accent/40 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* 名称可直接改：创建后仍能重命名。 */}
                  <Input
                    value={mod.name}
                    onChange={(e) => onUpdate(mod.id, { name: e.target.value })}
                    placeholder={t('modules.custom.namePlaceholder')}
                    aria-label={t('modules.custom.name')}
                    className="h-8 min-w-0 flex-1 text-xs"
                  />
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
          <Button size="sm" variant="primary" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {t('modules.custom.create')}
          </Button>
        </div>
      </div>
    </>
  )
}
