/**
 * 「世界存档 → 编辑」里的**箱子与招牌**卡片（W4）。
 *
 * 只改内容、不改结构：箱子数量 / 坐标、招牌数量 / 坐标都不变；改的是
 * 箱子名（≤20 字符，游戏加载时会 `TrimUserString(name, 20)`）、箱子里的物品、招牌文本。
 *
 * 写回时这两段是变长的（字符串），所以会整段重建并**重排段指针**——
 * 这部分在 `lib/save/worldWrite.ts`，已有「原样重建 == 逐字节相同」的真实存档断言兜底。
 */
import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { ItemIcon } from '@/components/ItemIcon'
import { PlrItemEditor } from '@/components/player/PlrItemEditor'
import {
  Button,
  Card,
  CardBody,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  Input,
  Label,
  Textarea,
} from '@/components/ui'
import { useDataset } from '@/lib/datasetContext'
import { useI18n } from '@/lib/i18n'
import type { ItemLimits } from '@/lib/itemLimits'
import type { ChestEdit, ContentIssue, SignEdit } from '@/lib/save/worldContent'
import { CHEST_NAME_MAX, SIGN_TEXT_MAX } from '@/lib/save/worldContent'

interface WorldContentEditorProps {
  chests: ChestEdit[]
  signs: SignEdit[]
  issues: ContentIssue[]
  limits: ItemLimits | null
  onChange: (next: { chests: ChestEdit[]; signs: SignEdit[] }) => void
}

/** 箱子 / 招牌内容编辑器：列表 → 弹窗编辑。 */
export function WorldContentEditor({ chests, signs, issues, limits, onChange }: WorldContentEditorProps) {
  const { t } = useI18n()
  const dataset = useDataset()
  const [openChest, setOpenChest] = useState<number | null>(null)
  const [openSign, setOpenSign] = useState<number | null>(null)
  const [editingSlot, setEditingSlot] = useState<number | null>(null)

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)

  const chestSummary = useMemo(
    () => chests.map((chest) => ({ items: chest.items.filter((it) => it != null).length })),
    [chests],
  )

  const setChest = (index: number, next: ChestEdit) => {
    const updated = chests.slice()
    updated[index] = next
    onChange({ chests: updated, signs })
  }

  const setSign = (index: number, text: string) => {
    const updated = signs.slice()
    updated[index] = { ...signs[index], text }
    onChange({ chests, signs: updated })
  }

  if (chests.length === 0 && signs.length === 0) {
    return (
      <Card>
        <CardBody className="pt-4">
          <Empty size="sm">
            <EmptyDescription>{t('wld.content.empty')}</EmptyDescription>
          </Empty>
        </CardBody>
      </Card>
    )
  }

  const chest = openChest != null ? chests[openChest] : null
  const chestIssue = (field: string) => issueFor(`chests.${openChest}.${field}`)

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-sm font-medium">{t('wld.content.title')}</h3>
          <span className="text-2xs text-muted-foreground">{t('wld.content.hint')}</span>
        </div>

        {/* 箱子列表 */}
        {chests.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-2xs text-muted-foreground">{t('wld.content.chests', { n: chests.length })}</span>
            <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto" data-testid="wld-content-chests">
              {chests.map((item, index) => (
                <li key={`${item.x},${item.y}`}>
                  <button
                    type="button"
                    onClick={() => setOpenChest(index)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  >
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      [{item.x}, {item.y}]
                    </span>
                    <span className="min-w-0 truncate">{item.name || t('wld.content.chestTitle', { x: item.x, y: item.y })}</span>
                    <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
                      {chestSummary[index].items}
                    </span>
                    <Pencil className="size-3 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 招牌列表 */}
        {signs.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-2xs text-muted-foreground">{t('wld.content.signs', { n: signs.length })}</span>
            <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto" data-testid="wld-content-signs">
              {signs.map((sign, index) => (
                <li key={`${sign.x},${sign.y},${index}`}>
                  <button
                    type="button"
                    onClick={() => setOpenSign(index)}
                    className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  >
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      [{sign.x}, {sign.y}]
                    </span>
                    <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                      {sign.text.split('\n')[0]}
                    </span>
                    <Pencil className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 箱子弹窗：名字 + 内容网格 */}
        <Dialog open={chest != null} onOpenChange={(next) => !next && setOpenChest(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{t('wld.content.chestTitle', { x: chest?.x ?? 0, y: chest?.y ?? 0 })}</DialogTitle>
              <DialogDescription>{t('wld.content.chestItems')}</DialogDescription>
            </DialogHeader>
            {chest && openChest != null && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wld-chest-name">{t('wld.content.chestName')}</Label>
                  <Input
                    id="wld-chest-name"
                    value={chest.name}
                    maxLength={CHEST_NAME_MAX}
                    onChange={(e) => setChest(openChest, { ...chest, name: e.target.value })}
                  />
                  {chestIssue('name') && (
                    <p className="text-2xs text-destructive">
                      {t(chestIssue('name')!.messageKey, chestIssue('name')!.vars)}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-10 gap-1" style={{ maxWidth: 420 }}>
                  {chest.items.map((slotItem, slot) => {
                    const def = slotItem && slotItem.id > 0 ? dataset?.itemsById.get(slotItem.id) : undefined
                    const bad = Boolean(chestIssue(`items.${slot}`))
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setEditingSlot(slot)}
                        aria-label={`${t('wld.content.chestItems')} ${slot + 1}`}
                        data-testid={`wld-content-chest-slot-${slot}`}
                        className={
                          'relative flex size-9 items-center justify-center rounded border transition-colors ' +
                          (bad
                            ? 'border-destructive'
                            : 'border-muted-foreground/40 bg-muted/20 hover:border-foreground/60 hover:bg-muted/50')
                        }
                      >
                        {def ? (
                          <>
                            <ItemIcon item={def} atlas={dataset?.atlas} size={30} />
                            {slotItem && slotItem.stack > 1 && (
                              <span className="absolute right-0.5 bottom-0 text-2xs font-bold text-white tabular-nums [text-shadow:0_0_2px_#000]">
                                {slotItem.stack}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground tabular-nums">{slot + 1}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* 招牌弹窗：文本 */}
        <Dialog open={openSign != null} onOpenChange={(next) => !next && setOpenSign(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {t('wld.content.signTitle', { x: signs[openSign ?? 0]?.x ?? 0, y: signs[openSign ?? 0]?.y ?? 0 })}
              </DialogTitle>
              <DialogDescription>{t('wld.content.signText')}</DialogDescription>
            </DialogHeader>
            {openSign != null && signs[openSign] && (
              <div className="flex flex-col gap-2">
                <Textarea
                  value={signs[openSign].text}
                  rows={8}
                  onChange={(e) => setSign(openSign, e.target.value)}
                  aria-label={t('wld.content.signText')}
                />
                <p className="text-2xs text-muted-foreground tabular-nums">
                  {Array.from(signs[openSign].text).length} / {SIGN_TEXT_MAX}
                </p>
                {issueFor(`signs.${openSign}`) && (
                  <p className="text-2xs text-destructive">
                    {t(issueFor(`signs.${openSign}`)!.messageKey, issueFor(`signs.${openSign}`)!.vars)}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => setOpenSign(null)}>
                    {t('wld.content.save')}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* 单个格子：复用角色编辑器（背包模式，有数量） */}
        {chest && openChest != null && editingSlot != null && (
          <PlrItemEditor
            open
            slot={editingSlot}
            item={
              chest.items[editingSlot]
                ? {
                    id: chest.items[editingSlot]!.id,
                    stack: chest.items[editingSlot]!.stack,
                    prefix: chest.items[editingSlot]!.prefix,
                  }
                : { id: 0, stack: 0, prefix: 0 }
            }
            dataset={dataset!}
            limits={limits}
            onClose={() => setEditingSlot(null)}
            onConfirm={(next) => {
              const items = chest.items.slice()
              items[editingSlot] = next.id > 0 ? { id: next.id, stack: next.stack, prefix: next.prefix } : null
              setChest(openChest, { ...chest, items })
            }}
          />
        )}
      </CardBody>
    </Card>
  )
}
