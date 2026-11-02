import { Info } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { HelpCard } from '@/components/HelpCard'
import { IconAction } from '@/components/IconAction'
import { usePageHelp } from '@/hooks/usePageHelp'
import { useI18n } from '@/lib/i18n'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui'

interface InfoPopoverProps {
  /** 无障碍名称 / Tooltip 文本，如「页面说明」。 */
  label: string
  /** 弹层标题（默认「使用说明」）。 */
  title?: string
  children: ReactNode
  className?: string
  /**
   * 记忆作用域（如 `panel:world:` / `store` / `tips`）。
   *
   * 给了它就按「使用说明」的行为来：**首次进入自动展开**、点 ✕ 关闭、
   * 关闭过一次后不再自动展开（按 scope 单独记在本机，换页面 / 刷新都记得）。
   */
  scopeId?: string
}

/**
 * 「页面说明」图标按钮：点击弹出 Popover 展示说明。
 *
 * 弹层内容复用 `HelpCard`（`Info` + 标题 + 小字 + ✕），与抽屉底部的「使用说明」同款。
 */
export function InfoPopover({ label, title, children, className, scopeId }: InfoPopoverProps) {
  const { t } = useI18n()
  const { closed, close } = usePageHelp(scopeId)
  // 首次进入（没关过）自动展开；手动点 ⓘ 可随时再开。
  const autoOpened = useRef(Boolean(scopeId) && !closed)
  const [open, setOpen] = useState(autoOpened.current)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    // 只记「关过」，不记「打开过」：之后靠 ⓘ 手动打开，不再自动弹。
    if (!next) close()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconAction label={label} icon={Info} active={open} className={className} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-2"
        // 自动展开时别把焦点丢给里面的 ✕（它的 Tooltip 会跟着弹出来），手动打开时照常聚焦。
        onOpenAutoFocus={(event) => {
          if (autoOpened.current) event.preventDefault()
        }}
      >
        <HelpCard title={title ?? t('cards.helpTitle')} onClose={() => handleOpenChange(false)}>
          {children}
        </HelpCard>
      </PopoverContent>
    </Popover>
  )
}
