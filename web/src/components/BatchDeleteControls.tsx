import { Button } from '@/components/ui'
import { useI18n } from '@/lib/i18n'

interface BatchDeleteControlsProps {
  /** 是否已进入批量选择状态。 */
  active: boolean
  /** 已选数量。 */
  count: number
  /** 列表为空时禁用入口。 */
  disabled?: boolean
  onEnter: () => void
  onCancel: () => void
  /** 确认删除已选条目。 */
  onConfirm: () => void
}

/**
 * 列表右上角的批量删除控件：
 * - 默认一个「删除」文字按钮（不显示逐行删除图标），点击进入选择状态；
 * - 选择状态显示「删除（N）」+「取消」。
 */
export function BatchDeleteControls({
  active,
  count,
  disabled,
  onEnter,
  onCancel,
  onConfirm,
}: BatchDeleteControlsProps) {
  const { t } = useI18n()

  if (!active) {
    return (
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onEnter}>
        {t('action.delete')}
      </Button>
    )
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <Button size="sm" variant="danger" disabled={count === 0} onClick={onConfirm}>
        {t('action.deleteCount', { n: count })}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t('action.cancel')}
      </Button>
    </span>
  )
}
