import { useMemo } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { Badge } from '@/components/ui'
import { useI18n } from '@/lib/i18n'
import { parseItemTags } from '@/lib/items'
import type { Dataset } from '@/types'

/**
 * 展示编辑器中识别到的 [i:...] 标签（设计原则与约束 §2.1）。
 * 合并进指令卡片内；无标签时不渲染任何内容。
 */
export function TagAssist({ dataset, text }: { dataset: Dataset; text: string }) {
  const { t } = useI18n()
  const tags = useMemo(() => parseItemTags(text), [text])
  const prefixName = (id?: number) =>
    id == null ? undefined : dataset.prefixes.find((p) => p.id === id)?.name

  if (tags.length === 0) return null

  return (
    <div className="rounded-xl bg-accent/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-2xs tracking-wide text-muted-foreground uppercase">
          {t('tag.title')}
        </span>
        <span className="text-2xs text-muted-foreground">{t('tag.count', { n: tags.length })}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const item = dataset.itemsById.get(tag.itemId)
          const prefix = prefixName(tag.prefixId)
          return (
            <li
              key={`${tag.start}-${tag.raw}`}
              className="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5"
            >
              <ItemIcon
                item={item}
                atlas={dataset.atlas}
                size={28}
                stack={tag.stack}
                name={item?.name ?? t('tag.unknown', { id: tag.itemId })}
                prefix={prefix}
              />
              <span className="leading-tight">
                <span className="block text-xs text-foreground">
                  {item ? item.name : t('tag.unknown', { id: tag.itemId })}
                </span>
                <span className="block font-pixel text-2xs text-muted-foreground">
                  ID {tag.itemId}
                  {tag.stack != null && ` × ${tag.stack}`}
                  {prefix && ` · ${prefix}`}
                </span>
              </span>
              {!item && <Badge tone="danger">{t('tag.invalidId')}</Badge>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
