import { RotateCcw } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { useI18n } from '@/lib/i18n'

/** 页面设置 Popover 的标题栏：左标题、右「恢复默认」（图标按钮）。三处页面设置共用。 */
export function SettingsPopoverHeader({
  title,
  onReset,
  resetTestId,
}: {
  title: string
  onReset: () => void
  resetTestId?: string
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between gap-2 border-b py-2 pr-2 pl-4">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <IconAction
        label={t('action.resetDefaults')}
        icon={RotateCcw}
        size="icon-xs"
        onClick={onReset}
        testId={resetTestId}
      />
    </div>
  )
}
