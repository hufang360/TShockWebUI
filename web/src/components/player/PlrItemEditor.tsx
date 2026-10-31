import { useMemo, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { SearchInput } from '@/components/SearchInput'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import type { ItemLimits } from '@/lib/itemLimits'
import { searchItems } from '@/lib/items'
import type { PlrItemEdit } from '@/lib/save/plrWrite'
import type { Dataset } from '@/types'

interface PlrItemEditorProps {
  open: boolean
  /**
   * `inventory` = 背包格（要数量 + 词缀）；`equipment` = 装备区格
   * （`.plr` 里这几组只存 id + prefix，**没有 stack**，所以数量输入禁用、写回时按 0 处理）。
   */
  mode?: 'inventory' | 'equipment'
  /** 槽位下标（仅在标题里出现时用；标题正文由 `title` 给）。 */
  slot: number
  /** 标题正文（背包是「背包第 N 格」，装备区是「装备 N」之类）。 */
  title?: string
  /** 当前槽位内容（空槽 id = 0）。 */
  item: PlrItemEdit
  dataset: Dataset
  limits: ItemLimits | null
  onConfirm: (item: PlrItemEdit) => void
  onClose: () => void
}

/**
 * 背包单格的编辑器：搜索物品 → 数量（≤ 游戏 `maxStack`）→ 词缀（只能选该物品可滚的词缀）。
 *
 * 校验口径与游戏加载存档时的 `Item.FixAgainstExploit()` 一致：超堆叠会被截断、非法词缀会被清零，
 * 所以这里直接拦，省得「改完进游戏没变化」。数据来源见 `docs/计划-plr编辑.md` §2.3 / §2.4。
 */
export function PlrItemEditor({
  open,
  mode = 'inventory',
  slot,
  title,
  item,
  dataset,
  limits,
  onConfirm,
  onClose,
}: PlrItemEditorProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number>(item.id)
  const [stack, setStack] = useState<number>(item.stack > 0 ? item.stack : 1)
  const [prefix, setPrefix] = useState<number>(item.prefix)

  const results = useMemo(
    () => (query.trim() ? searchItems(dataset.items, query, 40) : []),
    [dataset.items, query],
  )
  const item_ = picked > 0 ? dataset.itemsById.get(picked) : undefined
  const maxStack = limits?.maxStackById.get(picked) ?? 9999
  const blocked = limits?.noInventory.has(picked) ?? false
  const allowedPrefixes = useMemo(() => {
    const ids = dataset.rollablePrefixesById.get(picked)
    if (!ids) return []
    return [...ids].sort((a, b) => a - b)
  }, [dataset.rollablePrefixesById, picked])

  const equipment = mode === 'equipment'
  // 装备区没有 stack 字段：只校验 id 与词缀
  const stackTooBig = !equipment && (stack < 1 || stack > maxStack)
  const canConfirm = !blocked && !stackTooBig && (picked === 0 || Boolean(item_))

  const pick = (id: number) => {
    setPicked(id)
    setStack(1)
    setPrefix(0)
    setQuery('')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {title ?? t('save.edit.item.title', { slot: slot + 1 })}
            {item_ && <span className="ml-2 text-sm font-normal text-muted-foreground">{item_.name}</span>}
          </DialogTitle>
          <DialogDescription>{t('save.edit.item.hint')}</DialogDescription>
        </DialogHeader>

        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('save.edit.item.search')}
          autoFocus
        />

        {query.trim() ? (
          <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto @[420px]:grid-cols-2">
            {results.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => pick(it.id)}
                className="flex min-w-0 items-center gap-2 rounded-control px-2 py-2 text-left hover:bg-accent"
              >
                <ItemIcon item={it} atlas={dataset.atlas} size={24} />
                <span className="truncate text-sm">{it.name}</span>
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
                  #{it.id}
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <p className="col-span-full px-2 py-4 text-center text-sm text-muted-foreground">
                {t('save.edit.item.noMatch')}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-control border border-dashed p-3">
            {item_ ? (
              <>
                <ItemIcon item={item_} atlas={dataset.atlas} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{item_.name}</p>
                  <p className="text-2xs text-muted-foreground tabular-nums">#{item_.id}</p>
                </div>
              </>
            ) : (
              <>
                <Search className="size-5 text-muted-foreground/60" aria-hidden />
                <p className="text-sm text-muted-foreground">{t('save.edit.item.empty')}</p>
              </>
            )}
          </div>
        )}

        <div className="grid gap-3 @[420px]:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="plr-edit-stack">{t('save.edit.item.stack')}</Label>
            <Input
              id="plr-edit-stack"
              type="number"
              min={1}
              max={maxStack}
              value={equipment ? 1 : stack}
              disabled={equipment || picked === 0}
              onChange={(e) => setStack(Number(e.target.value))}
            />
            <p className="text-2xs text-muted-foreground tabular-nums">
              {equipment ? t('save.edit.item.stackNA') : t('save.edit.item.stackMax', { max: maxStack })}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="plr-edit-prefix">{t('save.edit.item.prefix')}</Label>
            <Select
              value={String(prefix)}
              disabled={picked === 0 || allowedPrefixes.length === 0}
              onValueChange={(next) => setPrefix(Number(next))}
            >
              <SelectTrigger id="plr-edit-prefix" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t('save.edit.item.prefixNone')}</SelectItem>
                {allowedPrefixes.map((id) => (
                  <SelectItem key={id} value={String(id)}>
                    {dataset.prefixesById.get(id)?.name ?? `#${id}`}
                  </SelectItem>
                ))}
                {/* 已选词缀不在这件物品的可选列表里（换过物品 / 旧存档）：仍然显示出来，
                    否则 Radix 找不到对应 item 会把触发器显示成空的。 */}
                {prefix !== 0 && !allowedPrefixes.includes(prefix) && (
                  <SelectItem value={String(prefix)}>
                    {dataset.prefixesById.get(prefix)?.name ?? `#${prefix}`}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">
              {picked > 0 && allowedPrefixes.length === 0
                ? t('save.edit.item.prefixNA')
                : t('save.edit.item.prefixHint')}
            </p>
          </div>
        </div>

        {blocked && (
          <p className="text-sm text-destructive">{t('save.edit.err.blockedItem')}</p>
        )}
        {stackTooBig && !blocked && (
          <p className="text-sm text-destructive">
            {t('save.edit.err.stackRange', { max: maxStack })}
          </p>
        )}

        <DialogFooter className="flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={item.id === 0}
            onClick={() => {
              onConfirm({ id: 0, stack: 0, prefix: 0 })
              onClose()
            }}
          >
            <Trash2 data-icon="inline-start" />
            {t('save.edit.item.clear')}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!canConfirm}
              onClick={() => {
                onConfirm({
                  id: picked,
                  stack: picked === 0 || equipment ? 0 : stack,
                  prefix: picked === 0 ? 0 : prefix,
                })
                onClose()
              }}
            >
              <Plus data-icon="inline-start" />
              {t('save.edit.item.confirm')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
