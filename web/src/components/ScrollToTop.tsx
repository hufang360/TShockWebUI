import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

/** 滚过这么多像素才出现：短列表不需要它，早出现只会挡内容。 */
export const SCROLL_TOP_THRESHOLD = 480

/**
 * 「回到顶部」浮动按钮：列表很长时贴在右下角，点一下滚回列表顶部。
 *
 * 不常驻（`visible=false` 时整个不渲染）：它是滚动时才需要的操作，
 * 静置时留在角落只会跟内容抢注意力。
 */
export function ScrollToTop({
  visible,
  onClick,
  className,
}: {
  visible: boolean
  onClick: () => void
  className?: string
}) {
  const { t } = useI18n()
  if (!visible) return null
  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label={t('action.scrollTop')}
      onClick={onClick}
      className={cn('fixed right-3 bottom-3 z-30 rounded-full shadow-lg sm:right-4 sm:bottom-4', className)}
    >
      <ArrowUp />
    </Button>
  )
}
