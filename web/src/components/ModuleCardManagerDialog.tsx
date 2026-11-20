import { useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { CardManagerSheet, type ManagerCard } from '@/components/CardManagerSheet'
import { LazyCardEditorPanel } from '@/components/card/LazyCardEditorPanel'
import type { CardEditorDraft } from '@/components/card/CardEditorPanel'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge } from '@/components/ui'
import type { CardTemplate } from '@/lib/cardParams'
import { CARD_WIDTHS, type CardWidth } from '@/lib/cardLayout'
import type { IngamePolicy } from '@/lib/ingame'
import { useI18n } from '@/lib/i18n'
import type { Dataset } from '@/types'

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
  /** 卡片当前是否隐藏（隐藏的卡片不渲染，但仍列在这里）。 */
  hidden?: boolean
  /** 卡片图标（与页面上那张卡一致）。 */
  icon?: ReactNode
  /** 参数卡片模板（有则编辑走「参数设置」）。 */
  template?: CardTemplate
  /** 必须手动执行（参数卡片要现场填值）。 */
  manualLocked?: boolean
}

interface ModuleCardManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cards: ManageableCard[]
  isManual: (card: ManageableCard) => boolean
  onToggleManual: (card: ManageableCard, manual: boolean) => void
  /** 新增卡片，返回新卡片 id（用来立刻写入尺寸 / 自动执行 / 显示）。 */
  onAdd: (name: string, command: string, template?: CardTemplate) => string | void
  /** 新增后写入行级设置（页面持有布局与自动执行偏好）。 */
  applyNewCard?: (id: string, preset: { width: CardWidth; manual: boolean; hidden: boolean }) => void
  /** 编辑自定义卡片的名称 / 指令（内置卡片不可编辑）。 */
  onUpdate: (id: string, patch: { name?: string; command?: string; template?: CardTemplate }) => void
  onRemove: (id: string) => void
  /** 排序（拖拽 + 上移 / 下移）。 */
  ordering?: {
    onMove: (id: string, delta: number) => void
  }
  /** 宽度（小 / 大 / 右）。鱼店只有右栏，`disabled` 传 `['half', 'full']`。 */
  width?: {
    get: (id: string) => CardWidth
    set: (id: string, width: CardWidth) => void
    disabled?: CardWidth[]
  }
  /** 固定卡片依赖的插件未安装时返回 true（置灰并标「缺少插件」）。 */
  pluginMissing?: (id: string) => boolean
  /**
   * 内置卡片的「显示 / 隐藏」开关（不给则不显示该项，卡片恒显示）。
   *
   * 鱼店用它：鱼罐 / 消费榜 / 鱼篓榜默认不显示，玩家在这里打开才出现。
   */
  visibility?: {
    isHidden: (id: string) => boolean
    onToggle: (id: string) => void
  }
  /**
   * 底部左下角「恢复默认」（不给则不显示）：
   * 清掉本页的排序 / 宽度 / 隐藏，并清空用户添加的卡片，回到刚装上时的样子。
   */
  onReset?: () => void
  dataset: Dataset
  /** 哪些 `allowServer=false` 的指令能在网页执行（添加卡片时判断「仅游戏内」）。 */
  ingame: IngamePolicy
  players?: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
}

/**
 * 模块「管理卡片」弹框：交互壳复用共享 `CardManagerSheet`（与首页 `HomeCardManager` 一致）。
 * 列出固定 + 自定义卡片，每张可切「自动执行」/ 宽度 / 顺序，自定义卡片可删；底部添加新卡片。
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
  ordering,
  width,
  pluginMissing,
  visibility,
  onReset,
  applyNewCard,
  dataset,
  ingame,
  players,
  runtimeValues,
}: ModuleCardManagerDialogProps) {
  const { t } = useI18n()
  const byId = new Map(cards.map((c) => [c.id, c]))
  /** 添加 / 编辑卡片的面板：`null` 收起；`add` 新增；`{ id }` 编辑。 */
  const [editor, setEditor] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null)
  const editingCard = editor?.mode === 'edit' ? byId.get(editor.id) : undefined

  const saveDraft = (draft: CardEditorDraft) => {
    if (editor?.mode === 'edit') {
      const card = byId.get(editor.id)
      onUpdate(editor.id, {
        name: draft.name,
        command: draft.command,
        template: draft.template,
      })
      width?.set(editor.id, draft.width)
      if (card && visibility && visibility.isHidden(editor.id) !== draft.hidden) {
        visibility.onToggle(editor.id)
      }
      if (card) onToggleManual(card, draft.manual)
      setEditor(null)
      return
    }
    const id = onAdd(draft.name, draft.command, draft.template)
    if (typeof id === 'string') {
      applyNewCard?.(id, { width: draft.width, manual: draft.manual, hidden: draft.hidden })
    }
    setEditor(null)
  }

  const items: ManagerCard[] = cards.map((card) => {
    const missing = card.custom ? false : pluginMissing?.(card.id) === true
    return {
      id: card.id,
      icon: card.icon,
      name: card.name,
      command: card.command,
      custom: card.custom,
      template: Boolean(card.template),
      manualLocked: card.manualLocked === true,
      disabled: missing,
      hidden: card.hidden === true || visibility?.isHidden(card.id) === true,
      // 自定义卡片有「笔」图标，能编辑 = 自己加的，所以不再需要「内置」徽标。
      badges: missing ? <Badge tone="warn">{t('home.managePluginMissing')}</Badge> : undefined,
    }
  })

  return (
    <>
    <CardManagerSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('modules.cards.manage')}
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
            }
          : undefined
      }
      ordering={
        ordering
          ? {
              onMove: ordering.onMove,
              dragLabel: t('home.manageDrag'),
              moveUpLabel: t('home.manageMoveUp'),
              moveDownLabel: t('home.manageMoveDown'),
            }
          : undefined
      }
      width={width}
      footerExtra={
        onReset ? (
          // 只留图标（悬停出「恢复默认」提示），点一下就地二次确认。
          <ConfirmButton
            size="icon-sm"
            variant="ghost"
            icon={<RotateCcw data-icon="inline-start" />}
            aria-label={t('home.manageReset')}
            confirmLabel={t('home.manageResetConfirm')}
            onConfirm={onReset}
          />
        ) : undefined
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
      add={
        editor
          ? undefined
          : { label: t('home.manageAddCard'), onClick: () => setEditor({ mode: 'add' }) }
      }
      onEditTemplate={(id) => setEditor({ mode: 'edit', id })}
      editor={
        editor ? (
          <LazyCardEditorPanel
            dataset={dataset}
            ingame={ingame}
            players={players}
            runtimeValues={runtimeValues}
            widthOptions={width?.disabled ? CARD_WIDTHS.filter((w) => !width.disabled?.includes(w)) : undefined}
            initial={
              editingCard
                ? {
                    name: editingCard.name,
                    command: editingCard.command,
                    template: editingCard.template,
                    width: width?.get(editingCard.id) ?? 'full',
                    manual: isManual(editingCard),
                    hidden: editingCard.hidden === true || visibility?.isHidden(editingCard.id) === true,
                  }
                : { name: '', command: '', width: 'half', manual: true, hidden: false }
            }
            submitLabel={editor.mode === 'edit' ? t('action.save') : t('home.manageAdd')}
            onSubmit={saveDraft}
            onCancel={() => setEditor(null)}
          />
        ) : undefined
      }
      doneLabel={t('modules.cards.done')}
      helpExtra={t('cards.manageDescRail')}
      />

    </>
  )
}
