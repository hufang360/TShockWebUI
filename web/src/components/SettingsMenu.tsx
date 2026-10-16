import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

interface SettingsMenuProps {
  /** 打开设置（切换到正文里的设置页）。 */
  onOpen: () => void
  /** 当前是否停留在设置页，用于高亮。 */
  active?: boolean
}

/**
 * 侧栏底部：打开设置。设置现在是右侧正文内容（不再是弹框）。
 */
export function SettingsMenu({ onOpen, active = false }: SettingsMenuProps) {
  const { t } = useI18n()
  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn('w-full justify-start', active && 'bg-sidebar-accent text-sidebar-accent-foreground')}
      onClick={onOpen}
      aria-current={active ? 'page' : undefined}
    >
      <SettingsIcon data-icon="inline-start" />
      {t('settings.title')}
    </Button>
  )
}
