import { useEffect, useMemo, useState } from 'react'
import { GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/ConfirmButton'
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
} from '@/components/ui'
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
  moveCard,
  normalizeCustomCommand,
  type CustomHomeCard,
  type HomeCardsPrefs,
} from '@/lib/homeCards'
import { cn } from '@/lib/cn'
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
 * 首页卡片管理弹框：列出所有卡片，支持隐藏 / 显示、拖拽排序；
 * 内置卡片不可编辑，自定义卡片可改名称与指令、可增删。
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
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  // 仅当从拖拽手柄按下时才允许整行拖动，避免在输入框里选词时误拖。
  const [handleArmed, setHandleArmed] = useState<string | null>(null)
  // 刚添加的自定义卡片：让名称输入框自动聚焦。
  const [justAddedId, setJustAddedId] = useState<string | null>(null)

  // 指令输入框的下拉候选：本机收藏的指令（tswui:favorites）。
  const [rawFavorites] = useLocalState<FavoriteEntry[]>(StorageKeys.favorites, [])
  const favoriteCommands = useMemo(
    () => sanitizeFavorites(rawFavorites).map((f) => f.cmd),
    [rawFavorites],
  )

  useEffect(() => {
    if (!open) setJustAddedId(null)
  }, [open])

  const customById = new Map(prefs.custom.map((c) => [c.id, c]))

  const toggleHidden = (id: string) => {
    onChange({ ...prefs, hidden: { ...prefs.hidden, [id]: !prefs.hidden[id] } })
  }

  const move = (fromId: string, toId: string) => {
    onChange({ ...prefs, order: moveCard(prefs.order, fromId, toId) })
  }

  const addCard = () => {
    const card = createCustomCard()
    onChange({
      ...prefs,
      order: [...prefs.order, card.id],
      custom: [...prefs.custom, card],
    })
    setJustAddedId(card.id)
  }

  const removeCard = (id: string) => {
    const hidden = { ...prefs.hidden }
    delete hidden[id]
    onChange({
      ...prefs,
      order: prefs.order.filter((x) => x !== id),
      hidden,
      custom: prefs.custom.filter((c) => c.id !== id),
    })
  }

  const updateCard = (id: string, patch: Partial<CustomHomeCard>) => {
    onChange({
      ...prefs,
      custom: prefs.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
          <SheetTitle>{t('home.manageTitle')}</SheetTitle>
          <SheetDescription>{t('home.manageDesc')}</SheetDescription>
        </SheetHeader>

        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
          {prefs.order.map((id) => {
            const builtin = isBuiltinCardId(id)
            const meta = builtin ? BUILTIN_CARD_META[id] : null
            const custom = !builtin && isCustomCardId(id) ? customById.get(id) : undefined
            const hidden = prefs.hidden[id] === true
            const missing = pluginMissing?.(id) === true
            const label = meta
              ? t(meta.titleKey)
              : custom?.name?.trim() || custom?.command?.trim() || t('home.manageUntitled')
            const command = meta ? meta.command : custom?.command?.trim() || null

            return (
              <li
                key={id}
                draggable={handleArmed === id}
                onDragStart={(e) => {
                  setDragId(id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', id)
                }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overId !== id) setOverId(id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const source = dragId ?? e.dataTransfer.getData('text/plain')
                  if (source) move(source, id)
                  setDragId(null)
                  setOverId(null)
                  setHandleArmed(null)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                  setHandleArmed(null)
                }}
                className={cn(
                  'flex items-start gap-2 rounded-xl bg-accent/40 p-2.5 transition-shadow',
                  dragId === id && 'opacity-50',
                  dragId && overId === id && dragId !== id && 'ring-2 ring-ring',
                  (hidden || missing) && 'opacity-60',
                )}
                aria-label={label}
              >
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onMouseDown={() => setHandleArmed(id)}
                  onMouseUp={() => setHandleArmed(null)}
                  onMouseLeave={() => setHandleArmed((v) => (v === id ? null : v))}
                  aria-label={t('home.manageDrag')}
                  title={t('home.manageDrag')}
                  className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing"
                >
                  <GripVertical data-icon="inline-start" />
                </Button>

                <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                  {meta ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-foreground">{label}</span>
                        <Badge>{t('home.manageBuiltin')}</Badge>
                        {missing && <Badge tone="warn">{t('home.managePluginMissing')}</Badge>}
                      </div>
                      {command ? (
                        <code className="font-pixel text-[10px] text-muted-foreground">
                          {command}
                        </code>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {t('home.manageNoCommand')}
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Input
                        autoFocus={justAddedId === id}
                        value={custom?.name ?? ''}
                        onChange={(e) => updateCard(id, { name: e.target.value })}
                        placeholder={t('home.manageNamePlaceholder')}
                        aria-label={t('home.manageNamePlaceholder')}
                        className="h-8 text-xs"
                      />
                      <Input
                        list={`fav-${id}`}
                        value={custom?.command ?? ''}
                        onChange={(e) => updateCard(id, { command: e.target.value })}
                        onBlur={(e) =>
                          updateCard(id, { command: normalizeCustomCommand(e.target.value) })
                        }
                        placeholder={t('home.manageCommandPlaceholder')}
                        aria-label={t('home.manageCommandPlaceholder')}
                        className="h-8 font-pixel text-xs"
                      />
                      <datalist id={`fav-${id}`}>
                        {favoriteCommands.map((cmd) => (
                          <option key={cmd} value={cmd} />
                        ))}
                      </datalist>
                    </div>
                  )}
                  {command && onToggleManual && (
                    <label className="flex w-fit cursor-pointer items-center gap-1.5">
                      <Checkbox
                        checked={!(isManual?.(id) ?? false)}
                        onCheckedChange={(v) => onToggleManual(id, v !== true)}
                        aria-label={`${label} ${t('home.autoExec')}`}
                      />
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {t('home.autoExec')}
                      </span>
                    </label>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-center gap-1.5">
                  <Switch
                    checked={!hidden}
                    onCheckedChange={() => toggleHidden(id)}
                    aria-label={hidden ? t('home.manageShow') : t('home.manageHide')}
                  />
                  {custom && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('home.manageDelete')}
                      title={t('home.manageDelete')}
                      onClick={() => removeCard(id)}
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={addCard}>
              <Plus data-icon="inline-start" />
              {t('home.manageAdd')}
            </Button>
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
          </div>
          <Button size="sm" variant="primary" onClick={() => onOpenChange(false)}>
            {t('home.manageDone')}
          </Button>
        </div>

        <p className="shrink-0 px-5 pb-4 text-[10px] text-muted-foreground">
          {t('home.manageNote')}
        </p>
      </SheetContent>
    </Sheet>
  )
}
