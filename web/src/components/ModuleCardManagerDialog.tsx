import { CardManagerSheet, type ManagerCard } from '@/components/CardManagerSheet'
import { Badge } from '@/components/ui'
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
  /** 固定卡片依赖的插件未安装时返回 true（置灰并标「缺少插件」）。 */
  pluginMissing?: (id: string) => boolean
  /**
   * 内置卡片的「显示 / 隐藏」开关（不给则不显示开关，卡片恒显示）。
   *
   * 鱼店用它：鱼罐 / 消费榜 / 鱼篓榜默认不显示，玩家在这里打开才出现。
   */
  visibility?: {
    isHidden: (id: string) => boolean
    onToggle: (id: string) => void
  }
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
  pluginMissing,
  visibility,
}: ModuleCardManagerDialogProps) {
  const { t } = useI18n()
  const byId = new Map(cards.map((c) => [c.id, c]))

  const items: ManagerCard[] = cards.map((card) => {
    const missing = card.custom ? false : pluginMissing?.(card.id) === true
    return {
      id: card.id,
      name: card.name,
      command: card.command,
      custom: card.custom,
      disabled: missing,
      badges: card.custom ? undefined : (
        <>
          <Badge>{t('home.manageBuiltin')}</Badge>
          {missing && <Badge tone="warn">{t('home.managePluginMissing')}</Badge>}
        </>
      ),
    }
  })

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
      visibility={
        visibility
          ? {
              isHidden: (id) => visibility.isHidden(id),
              onToggle: (id) => visibility.onToggle(id),
              hideLabel: t('home.manageHide'),
              showLabel: t('home.manageShow'),
            }
          : undefined
      }
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
