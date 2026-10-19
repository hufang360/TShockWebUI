import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import { CardManagerSheet, type ManagerCard } from '@/components/CardManagerSheet'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge } from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { sanitizeFavorites } from '@/lib/favorites'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'
import {
  BUILTIN_CARD_META,
  DEFAULT_HOME_CARDS,
  createCustomCard,
  isBuiltinCardId,
  isCustomCardId,
  type HomeCardsPrefs,
} from '@/lib/homeCards'
import type { FavoriteEntry } from '@/types'

interface HomeCardManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefs: HomeCardsPrefs
  onChange: (next: HomeCardsPrefs) => void
  /** 卡片依赖的信使插件未安装时返回 true（首页不展示，此处置灰标记）。 */
  pluginMissing?: (id: string) => boolean
  /** 该卡片是否为「手动执行」（不随自动/刷新全部执行）。 */
  isManual?: (id: string) => boolean
  onToggleManual?: (id: string, manual: boolean) => void
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
}: HomeCardManagerProps) {
  const { t } = useI18n()

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
    const label = meta
      ? t(meta.titleKey)
      : custom?.name?.trim() || custom?.command?.trim() || t('home.manageUntitled')

    return {
      id,
      name: custom ? custom.name : label,
      command: custom ? custom.command : (meta?.command ?? ''),
      custom: custom != null,
      hidden,
      disabled: missing,
      badges: meta ? (
        <>
          <Badge>{t('home.manageBuiltin')}</Badge>
          {missing && <Badge tone="warn">{t('home.managePluginMissing')}</Badge>}
        </>
      ) : undefined,
    }
  })

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
    <CardManagerSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('home.manageTitle')}
      description={t('home.manageDesc')}
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
        hideLabel: t('home.manageHide'),
        showLabel: t('home.manageShow'),
      }}
      add={{
        nameLabel: t('home.manageNamePlaceholder'),
        namePlaceholder: t('home.manageNamePlaceholder'),
        commandLabel: t('home.manageCommand'),
        commandPlaceholder: t('home.manageCommandPlaceholder'),
        createLabel: t('home.manageAdd'),
        onAdd: (name, command) => {
          const card = createCustomCard(name, command)
          onChange({
            ...prefs,
            order: [...prefs.order, card.id],
            custom: [...prefs.custom, card],
          })
        },
      }}
      footerExtra={
        <ConfirmButton
          icon={<RotateCcw data-icon="inline-start" />}
          confirmLabel={t('home.manageResetConfirm')}
          onConfirm={() =>
            onChange({
              order: [...DEFAULT_HOME_CARDS.order],
              hidden: {},
              custom: [],
              layoutVersion: DEFAULT_HOME_CARDS.layoutVersion,
            })
          }
        >
          {t('home.manageReset')}
        </ConfirmButton>
      }
      doneLabel={t('home.manageDone')}
      note={t('home.manageNote')}
    />
  )
}
