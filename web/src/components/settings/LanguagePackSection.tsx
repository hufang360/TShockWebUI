import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Trash2, Upload } from 'lucide-react'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import { ConfirmButton } from '@/components/ConfirmButton'
import { IconAction } from '@/components/IconAction'
import { Badge, Button, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'
import type { LanguagePackSummary, LanguagePacksController } from '@/lib/languagePack/useLanguagePacks'

/**
 * 设置 → 语言材质包：上传 / 勾选 / 排序 / 删除。
 * 纯本地显示偏好（登录前也能用），排序靠上的包优先，见 docs/功能-语言材质包.md。
 */
export function LanguagePackSection({ controller }: { controller: LanguagePacksController }) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const { packs } = controller

  const resetDrag = () => {
    setDragId(null)
    setOverId(null)
    setArmedId(null)
  }

  return (
    <CollapsibleCard title={t('langpack.title')} bodyClassName="flex flex-col gap-3 pt-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('langpack.hint')}</p>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          disabled={controller.busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload data-icon />
          {controller.busy ? t('langpack.uploading') : t('langpack.upload')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void controller.importFile(file)
          }}
        />
      </div>

      {!controller.storageAvailable && (
        <p className="text-xs leading-5 text-warning">{t('langpack.storageUnavailable')}</p>
      )}

      <ul className="flex flex-col gap-2">
        {packs.map((pack, index) => (
          <PackRow
            key={pack.id}
            pack={pack}
            index={index}
            total={packs.length}
            dragId={dragId}
            overId={overId}
            armed={armedId === pack.id}
            onArm={() => setArmedId(pack.id)}
            onDisarm={() => setArmedId((v) => (v === pack.id ? null : v))}
            onDragStart={() => setDragId(pack.id)}
            onDragOver={() => {
              if (dragId && overId !== pack.id) setOverId(pack.id)
            }}
            onDrop={() => {
              const from = packs.findIndex((p) => p.id === dragId)
              if (from >= 0 && from !== index) controller.move(pack.id, index - from)
              resetDrag()
            }}
            onDragEnd={resetDrag}
            onMove={(delta) => controller.move(pack.id, delta)}
            onToggle={(on) => controller.setEnabled(pack.id, on)}
            onRemove={() => controller.remove(pack.id)}
          />
        ))}
      </ul>
    </CollapsibleCard>
  )
}

function PackRow({
  pack,
  index,
  total,
  dragId,
  overId,
  armed,
  onArm,
  onDisarm,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onToggle,
  onRemove,
}: {
  pack: LanguagePackSummary
  index: number
  total: number
  dragId: string | null
  overId: string | null
  armed: boolean
  onArm: () => void
  onDisarm: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onMove: (delta: number) => void
  onToggle: (on: boolean) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const meta = [
    pack.author,
    pack.version ? `v${pack.version}` : null,
    pack.hasCulture && pack.counts.total > 0
      ? t('langpack.counts', {
          items: pack.counts.itemName,
          tips: pack.counts.itemTooltip,
          npcs: pack.counts.npcName,
        })
      : null,
  ].filter(Boolean)

  return (
    <li
      draggable={armed}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (!dragId) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      aria-label={pack.name}
      className={cn(
        'flex items-start gap-2 rounded-control bg-accent/40 p-2.5 transition-shadow',
        dragId === pack.id && 'opacity-50',
        dragId && overId === pack.id && dragId !== pack.id && 'ring-2 ring-ring',
      )}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <IconAction
          label={t('langpack.drag')}
          icon={GripVertical}
          onMouseDown={onArm}
          onMouseUp={onDisarm}
          onMouseLeave={onDisarm}
          className="cursor-grab active:cursor-grabbing"
        />
        <IconAction
          label={t('langpack.moveUp')}
          icon={ChevronUp}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        />
        <IconAction
          label={t('langpack.moveDown')}
          icon={ChevronDown}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{pack.name}</span>
          {pack.builtin && <Badge>{t('langpack.builtin')}</Badge>}
          {pack.format === 'csv' && <Badge tone="warn">{t('langpack.legacy')}</Badge>}
          {!pack.hasCulture && <Badge tone="warn">{t('langpack.noCulture')}</Badge>}
        </div>
        {meta.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Switch
          checked={pack.enabled}
          onCheckedChange={onToggle}
          aria-label={t('langpack.enable', { name: pack.name })}
        />
        {!pack.builtin && (
          <ConfirmButton
            icon={<Trash2 />}
            confirmLabel={t('action.delete')}
            variant="ghost"
            size="icon-xs"
            aria-label={t('langpack.remove', { name: pack.name })}
            title={t('langpack.remove', { name: pack.name })}
            onConfirm={onRemove}
          />
        )}
      </div>
    </li>
  )
}
