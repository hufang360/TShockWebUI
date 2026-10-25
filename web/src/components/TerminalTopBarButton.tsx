import { Terminal } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { useI18n } from '@/lib/i18n'
import { useTerminal } from '@/lib/terminalContext'

/**
 * 浮动终端（「指令」）的入口：顶栏右侧的图标按钮。
 *
 * 只有「指令」「设置」两页不显示（由调用方通过 `visible` 控制），未登录也不显示。
 * 打开状态与顶栏按钮联动（`aria-pressed`）。
 */
export function TerminalTopBarButton({ visible }: { visible: boolean }) {
  const { t } = useI18n()
  const { isOpen, toggle } = useTerminal()
  if (!visible) return null
  return (
    <IconAction
      label={t('terminal.fab')}
      icon={Terminal}
      pressed={isOpen}
      onClick={toggle}
      testId="terminal-topbar"
    />
  )
}
