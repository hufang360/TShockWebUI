import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { CardManagerSheet, type ManagerCard } from '@/components/CardManagerSheet'
import type { CardDraft } from '@/components/card/CardTemplateDialog'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge } from '@/components/ui'
import { cardRunState, needsUserInput } from '@/lib/cardParams'
import type { IngamePolicy } from '@/lib/ingame'
import { useLocalState } from '@/hooks/useLocalState'
import { sanitizeFavorites } from '@/lib/favorites'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import {
  BUILTIN_CARD_META,
  DEFAULT_HOME_CARDS,
  cardWidth,
  createCustomCard,
  isBuiltinCardId,
  isCustomCardId,
  type CardWidth,
  type HomeCardsPrefs,
} from '@/lib/homeCards'
import type { Dataset, FavoriteEntry } from '@/types'

// 只在点「添加 / 编辑」时才需要：不占首屏兜底。
const CardTemplateDialog = lazy(() =>
  import('@/components/card/CardTemplateDialog').then((m) => ({ default: m.CardTemplateDialog })),
)

interface HomeCardManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefs: HomeCardsPrefs
  onChange: (next: HomeCardsPrefs) => void
  /** 卡片依赖的信使插件未安装时返回 true（首页不展示，此处置灰标记）。 */
  pluginMissing?: (id: string) => boolean
  /** 该卡片是否为「手动执行」（不随自动/刷新全部执行）。 */
  isManual?: (id: string) => boolean
  /** 卡片图标（与页面上那张卡一致）。 */
  cardIcon?: (id: string) => ReactNode
  onToggleManual?: (id: string, manual: boolean) => void
  dataset: Dataset
  /** 哪些 `allowServer=false` 的指令能在网页执行（添加卡片时判断「仅游戏内」）。 */
  ingame: IngamePolicy
  players?: string[]
  runtimeValues?: { regions?: string[]; warps?: string[] }
}

/**
 * 首页卡片管理弹框：列出所有卡片，支持隐藏 / 显示、拖拽 + 上移 / 下移排序；
 * 内置卡片不可编辑，自定义卡片可改名称与指令、可增删。
 * 交互壳复用共享 `CardManagerSheet`（对齐模块 / 鱼店的管理弹框）。
 */
export function HomeCardManager({
  open,
  onOpenChange,
  prefs,
  onChange,
  pluginMissing,
  isManual,
  onToggleManual,
  cardIcon,
  dataset,
  ingame,
  players,
  runtimeValues,
}: HomeCardManagerProps) {
  const { t } = useI18n()
  /** 添加 / 编辑卡片的弹框：`null` 关闭；`{ id }` = 编辑那张参数卡片。 */
  const [dialog, setDialog] = useState<{ id: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // 指令输入框的下拉候选：本机收藏的指令（tswui:favorites）。
  const [rawFavorites] = useLocalState<FavoriteEntry[]>(StorageKeys.favorites, [])
  const favoriteCommands = useMemo(
    () => sanitizeFavorites(rawFavorites).map((f) => f.cmd),
    [rawFavorites],
  )

  const customById = useMemo(() => new Map(prefs.custom.map((c) => [c.id, c])), [prefs.custom])

  const cards: ManagerCard[] = prefs.order.map((id) => {
    const builtin = isBuiltinCardId(id)
    const meta = builtin ? BUILTIN_CARD_META[id] : null
    const custom = !builtin && isCustomCardId(id) ? customById.get(id) : undefined
    const hidden = prefs.hidden[id] === true
    const missing = pluginMissing?.(id) === true
    const run = custom ? cardRunState(dataset, custom) : null
    const label = meta
      ? t(meta.titleKey)
      : custom?.name?.trim() || run?.preview || custom?.command?.trim() || t('home.manageUntitled')

    return {
      id,
      icon: cardIcon?.(id),
      name: custom ? custom.name : label,
      // 参数卡片显示拼好的指令（复制出去的也是它），而不是 `give` 这种半截指令。
      command: custom ? run?.preview || custom.command : (meta?.command ?? ''),
      custom: custom != null,
      template: Boolean(custom?.template),
      manualLocked: custom != null && needsUserInput(custom),
      hidden,
      disabled: missing,
      // 自定义卡片有「笔」图标（能编辑），所以内置卡片不再挂「内置」徽标；只留缺插件警告。
      badges: missing ? (
        <Badge tone="warn">{t('home.managePluginMissing')}</Badge>
      ) : custom?.template ? (
        <Badge tone="neutral">{t('card.paramsChip')}</Badge>
      ) : undefined,
    }
  })

  const editingCard = dialog ? customById.get(dialog.id) : undefined

  /** 添加 / 编辑提交：带模板 = 参数卡片，命令以模板为准。 */
  const saveDraft = (draft: CardDraft) => {
    if (dialog) {
      onChange({
        ...prefs,
        custom: prefs.custom.map((c) =>
          c.id === dialog.id
            ? { ...c, name: draft.name, command: draft.command, template: draft.template }
            : c,
        ),
      })
      setDialog(null)
      return
    }
    const card = createCustomCard(draft.name, draft.command, draft.template)
    onChange({
      ...prefs,
      order: [...prefs.order, card.id],
      custom: [...prefs.custom, card],
    })
    setAddOpen(false)
  }

  const moveBy = (id: string, delta: number) => {
    const from = prefs.order.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= prefs.order.length) return
    const next = [...prefs.order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange({ ...prefs, order: next })
  }

  return (
    <>
    <CardManagerSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('home.manageTitle')}
      cards={cards}
      removeLabel={t('home.manageDelete')}
      nameLabel={t('home.manageNamePlaceholder')}
      commandLabel={t('home.manageCommandPlaceholder')}
      commandSuggestions={favoriteCommands}
      onUpdate={(id, patch) =>
        onChange({
          ...prefs,
          custom: prefs.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })
      }
      onRemove={(id) => {
        const hidden = { ...prefs.hidden }
        delete hidden[id]
        onChange({
          ...prefs,
          order: prefs.order.filter((x) => x !== id),
          hidden,
          custom: prefs.custom.filter((c) => c.id !== id),
        })
      }}
      autoExec={
        onToggleManual
          ? {
              isManual: (id) => isManual?.(id) ?? false,
              onToggle: onToggleManual,
              label: t('home.autoExec'),
            }
          : undefined
      }
      ordering={{
        onMove: moveBy,
        dragLabel: t('home.manageDrag'),
        moveUpLabel: t('home.manageMoveUp'),
        moveDownLabel: t('home.manageMoveDown'),
      }}
      visibility={{
        isHidden: (id) => prefs.hidden[id] === true,
        onToggle: (id) =>
          onChange({ ...prefs, hidden: { ...prefs.hidden, [id]: !prefs.hidden[id] } }),
      }}
      width={{
        get: (id) => cardWidth(prefs, id),
        set: (id: string, width: CardWidth) =>
          onChange({ ...prefs, width: { ...prefs.width, [id]: width } }),
      }}
      add={{ label: t('home.manageAddCard'), onClick: () => setAddOpen(true) }}
      onEditTemplate={(id) => setDialog({ id })}
      footerExtra={
        // 只留图标（悬停出「恢复默认」提示），点一下就地二次确认。
        <ConfirmButton
          size="icon-sm"
          variant="ghost"
          icon={<RotateCcw data-icon="inline-start" />}
          aria-label={t('home.manageReset')}
          confirmLabel={t('home.manageResetConfirm')}
          onConfirm={() =>
            onChange({
              order: [...DEFAULT_HOME_CARDS.order],
              hidden: {},
              width: {},
              custom: [],
              layoutVersion: DEFAULT_HOME_CARDS.layoutVersion,
            })
          }
        />
      }
      doneLabel={t('home.manageDone')}
    />

      <Suspense fallback={null}>
      <CardTemplateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        dataset={dataset}
        ingame={ingame}
        players={players}
        runtimeValues={runtimeValues}
        onSubmit={saveDraft}
        submitLabel={t('home.manageAdd')}
      />

      <CardTemplateDialog
        open={dialog != null}
        onOpenChange={(next) => {
          if (!next) setDialog(null)
        }}
        dataset={dataset}
        ingame={ingame}
        players={players}
        runtimeValues={runtimeValues}
        initial={
          editingCard
            ? {
                name: editingCard.name,
                command: editingCard.command,
                template: editingCard.template,
              }
            : undefined
        }
        onSubmit={saveDraft}
        submitLabel={t('action.save')}
      />
      </Suspense>
    </>
  )
}
