import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
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
  shiftCard,
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
  const [confirmReset, setConfirmReset] = useState(false)
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

  const shift = (id: string, delta: number) => {
    onChange({ ...prefs, order: shiftCard(prefs.order, id, delta) })
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('home.manageTitle')}</DialogTitle>
          <DialogDescription>{t('home.manageDesc')}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-[58vh] flex flex-col gap-2 overflow-y-auto pr-1">
          {prefs.order.map((id, index) => {
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-foreground">{label}</span>
                      <Badge>{t('home.manageBuiltin')}</Badge>
                      {missing && <Badge tone="warn">{t('home.managePluginMissing')}</Badge>}
                      {command ? (
                        <code className="font-pixel text-[10px] text-muted-foreground">{command}</code>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {t('home.manageNoCommand')}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 sm:flex-row">
                      <Input
                        autoFocus={justAddedId === id}
                        value={custom?.name ?? ''}
                        onChange={(e) => updateCard(id, { name: e.target.value })}
                        placeholder={t('home.manageNamePlaceholder')}
                        aria-label={t('home.manageNamePlaceholder')}
                        className="h-8 text-xs sm:w-36"
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
                        className="h-8 flex-1 font-pixel text-xs"
                      />
                      <datalist id={`fav-${id}`}>
                        {favoriteCommands.map((cmd) => (
                          <option key={cmd} value={cmd} />
                        ))}
                      </datalist>
                    </div>
                  )}
                  {command && onToggleManual && (
                    <Field orientation="horizontal" className="w-auto flex-nowrap gap-1.5">
                      <Switch
                        checked={!(isManual?.(id) ?? false)}
                        onCheckedChange={(v) => onToggleManual(id, !v)}
                        aria-label={`${label} ${t('home.autoExec')}`}
                      />
                      <FieldLabel className="text-[10px] font-normal text-muted-foreground">
                        {t('home.autoExec')}
                      </FieldLabel>
                    </Field>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('home.manageMoveUp')}
                    title={t('home.manageMoveUp')}
                    disabled={index === 0}
                    onClick={() => shift(id, -1)}
                  >
                    <ChevronUp data-icon="inline-start" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('home.manageMoveDown')}
                    title={t('home.manageMoveDown')}
                    disabled={index === prefs.order.length - 1}
                    onClick={() => shift(id, 1)}
                  >
                    <ChevronDown data-icon="inline-start" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={hidden ? t('home.manageShow') : t('home.manageHide')}
                    title={hidden ? t('home.manageShow') : t('home.manageHide')}
                    onClick={() => toggleHidden(id)}
                  >
                    {hidden ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                  </Button>
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

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={addCard}>
              <Plus data-icon="inline-start" />
              {t('home.manageAdd')}
            </Button>
            {confirmReset ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onChange({
                      order: [...DEFAULT_HOME_CARDS.order],
                      hidden: {},
                      custom: [],
                      layoutVersion: DEFAULT_HOME_CARDS.layoutVersion,
                    })
                    setConfirmReset(false)
                  }}
                >
                  {t('home.manageResetConfirm')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  {t('action.cancel')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
                <RotateCcw data-icon="inline-start" />
                {t('home.manageReset')}
              </Button>
            )}
          </div>
          <Button size="sm" variant="primary" onClick={() => onOpenChange(false)}>
            {t('home.manageDone')}
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground">{t('home.manageNote')}</p>
      </DialogContent>
    </Dialog>
  )
}
