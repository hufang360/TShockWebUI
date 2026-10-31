import { NotebookPen } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, Textarea } from '@/components/ui'
import { useLocalState } from '@/hooks/useLocalState'
import { useI18n } from '@/lib/i18n'
import { StorageKeys } from '@/lib/storage'

/**
 * 鱼店「记事本」：贴在 `/fish info` 卡片下面的一张小卡片，随手记（今天的鱼价、想买的东西…）。
 *
 * - 内容按**服务器**分开存本机（`tswui:fishNote` = `{ [serverId]: string }`），不发服务器、不进 token；
 * - 边打边存，没有「保存」按钮；刷新 / 切页面回来还在；
 * - 只占一行高度起步（`min-h-20`，可往下拖大），不挤占卡片列的可视区。
 */
export function FishNotepad({ serverId }: { serverId: string }) {
  const { t } = useI18n()
  const [notes, setNotes] = useLocalState<Record<string, string>>(StorageKeys.fishNote, {})
  const note = typeof notes?.[serverId] === 'string' ? notes[serverId] : ''

  return (
    <Card data-testid="fish-notepad">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-1.5">
          <NotebookPen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{t('fish.notepad')}</span>
        </CardTitle>
        <span className="shrink-0 text-2xs text-muted-foreground">{t('fish.notepadHint')}</span>
      </CardHeader>
      <CardBody>
        <Textarea
          value={note}
          onChange={(event) =>
            setNotes((prev) => ({
              ...(prev && typeof prev === 'object' ? prev : {}),
              [serverId]: event.target.value,
            }))
          }
          placeholder={t('fish.notepadPlaceholder')}
          aria-label={t('fish.notepad')}
          className="min-h-20 text-xs"
        />
      </CardBody>
    </Card>
  )
}
