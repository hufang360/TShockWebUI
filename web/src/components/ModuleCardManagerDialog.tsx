import { CardManagerSheet, type ManagerCard } from '@/components/CardManagerSheet'
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
 * 模块「管理卡片」弹框：交互壳复用共享 `CardManagerSheet`（与首页 `HomeCardManager` 一致）。
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
  const byId = new Map(cards.map((c) => [c.id, c]))

  const items: ManagerCard[] = cards.map((card) => ({
    id: card.id,
    name: card.name,
    command: card.command,
    custom: card.custom,
  }))

  return (
    <CardManagerSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('modules.cards.manage')}
      description={t('modules.cards.manageDesc')}
      cards={items}
      removeLabel={t('modules.cards.remove')}
      nameLabel={t('modules.cards.namePlaceholder')}
      commandLabel={t('modules.cards.commandPlaceholder')}
      onUpdate={(id, patch) => onUpdate(id, patch)}
      onRemove={onRemove}
      autoExec={{
        isManual: (id) => {
          const card = byId.get(id)
          return card ? isManual(card) : false
        },
        onToggle: (id, manual) => {
          const card = byId.get(id)
          if (card) onToggleManual(card, manual)
        },
        label: t('home.autoExec'),
      }}
      add={{
        nameLabel: t('modules.cards.name'),
        namePlaceholder: t('modules.cards.namePlaceholder'),
        commandLabel: t('modules.cards.command'),
        commandPlaceholder: t('modules.cards.commandPlaceholder'),
        createLabel: t('modules.cards.create'),
        onAdd,
      }}
      doneLabel={t('modules.cards.done')}
    />
  )
}
