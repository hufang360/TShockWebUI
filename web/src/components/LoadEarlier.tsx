import { Button } from '@/components/ui'
import { useI18n } from '@/lib/i18n'

/**
 * 「加载更早的 N 条」：放在贴底列表的**顶部**，用于展开被渲染窗口隐藏的旧记录。
 * `hidden` 为 0（没有更多旧记录）时不渲染。
 */
export function LoadEarlier({
  hidden,
  step,
  onLoad,
  className,
}: {
  hidden: number
  step: number
  onLoad: () => void
  className?: string
}) {
  const { t } = useI18n()
  if (hidden <= 0) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className ?? 'mx-auto shrink-0 text-muted-foreground'}
      onClick={onLoad}
    >
      {t('common.loadEarlier', { n: Math.min(hidden, step) })}
    </Button>
  )
}
